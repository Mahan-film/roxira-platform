import { Inject, Injectable, Optional } from '@nestjs/common';
import { roundMinorHalfUp } from '../../accounting/money';
import {
  TaxCalculationInput,
  TaxCalculationResult,
  TaxEngine,
  TaxPostingAccounts,
  TaxPostingLine,
  TaxRateRule,
  WhtCertificateSequenceStore,
  WithholdingEvent,
  WithholdingRule,
} from './tax-engine.types';

export const WHT_SEQUENCE_STORE = Symbol('WHT_SEQUENCE_STORE');
export const TAX_DEFAULT_ACCOUNTS = Symbol('TAX_DEFAULT_ACCOUNTS');
export const TAX_INITIAL_RULES = Symbol('TAX_INITIAL_RULES');

const FALLBACK_ACCOUNTS: Required<TaxPostingAccounts> = {
  expenseOrRevenueAccount: '5010',
  apOrArAccount: '2010',
  inputVatAccount: '1410',
  outputVatAccount: '2410',
  outputRcVatAccount: '2415',
  bankAccount: '1010',
  whtPayableAccount: '2420',
  whtReceivableAccount: '1420',
};

/** Built-in Iran tax codes preserved for golden compatibility. */
export const IRAN_DEFAULT_TAX_RULES: readonly TaxRateRule[] = [
  { code: 'IR_VAT_9', country: 'IR', rateBps: 900, effectiveFrom: '2015-03-21', effectiveTo: '2024-03-19', outputBox: 'IR_VAT_STD', inputBox: 'IR_VAT_IN' },
  { code: 'IR_VAT_10', country: 'IR', rateBps: 1000, effectiveFrom: '2024-03-20', effectiveTo: null, outputBox: 'IR_VAT_STD', inputBox: 'IR_VAT_IN' },
  { code: 'IR_EXEMPT', country: 'IR', rateBps: 0, effectiveFrom: '2000-01-01', effectiveTo: null, outputBox: 'IR_VAT_EXEMPT', inputBox: null },
];

/**
 * In-memory fallback sequence store for unit tests and stateless evaluation.
 * Production callers must inject a DB-backed `WhtCertificateSequenceStore` via `WHT_SEQUENCE_STORE`
 * or pass a pre-allocated `input.certificateNumber`.
 */
export class InMemoryWhtCertificateSequenceStore implements WhtCertificateSequenceStore {
  private readonly counters = new Map<string, number>();

  next(prefix: string, year: number): number {
    const key = `${prefix}:${year}`;
    const nextSeq = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, nextSeq);
    return nextSeq;
  }
}

/** Sequential certificate allocator (`PREFIX-YYYY-NNNN`) scoped by prefix and calendar year. */
export class WhtCertificateSequencer {
  constructor(
    private readonly store: WhtCertificateSequenceStore = new InMemoryWhtCertificateSequenceStore(),
  ) {}

  next(prefix: string, dateStr: string): string {
    const year = Number(dateStr.slice(0, 4)) || new Date().getUTCFullYear();
    const nextSeq = this.store.next(prefix, year);
    return `${prefix}-${year}-${String(nextSeq).padStart(4, '0')}`;
  }
}

/**
 * Country-neutral tax engine (T180). Evaluates effective-dated VAT rules by tax point (credit
 * notes inherit the original invoice's tax point), reverse charge (input + output RC VAT),
 * withholding at invoice or payment time with sequential certificates, and separate deductible dates.
 */
@Injectable()
export class TaxEngineService implements TaxEngine {
  private readonly taxRules: TaxRateRule[];
  private readonly whtRules = new Map<string, WithholdingRule>();
  private readonly certificates: WhtCertificateSequencer;
  private readonly defaultAccounts: Required<TaxPostingAccounts>;

  constructor(
    @Optional() @Inject(WHT_SEQUENCE_STORE) sequenceStore?: WhtCertificateSequenceStore,
    @Optional() @Inject(TAX_DEFAULT_ACCOUNTS) defaultAccounts?: Partial<TaxPostingAccounts>,
    @Optional() @Inject(TAX_INITIAL_RULES) initialRules?: readonly TaxRateRule[],
  ) {
    this.taxRules = [...(initialRules ?? IRAN_DEFAULT_TAX_RULES)];
    this.certificates = new WhtCertificateSequencer(sequenceStore ?? new InMemoryWhtCertificateSequenceStore());
    this.defaultAccounts = { ...FALLBACK_ACCOUNTS, ...defaultAccounts };
  }

  registerTaxRules(rules: readonly TaxRateRule[]): void {
    this.taxRules.push(...rules);
  }

  registerWithholdingRules(rules: readonly WithholdingRule[]): void {
    for (const rule of rules) {
      this.whtRules.set(rule.code, rule);
    }
  }

  resolveRate(
    taxCode: string,
    taxPointDate: string,
    originalInvoiceTaxPointDate?: string | null,
    country?: string,
  ): TaxRateRule {
    const effectiveDate = originalInvoiceTaxPointDate ?? taxPointDate;
    const normalizedCountry = country?.trim().toUpperCase();
    const matches = this.taxRules.filter(
      (r) =>
        r.code === taxCode &&
        (!normalizedCountry || !r.country || r.country.toUpperCase() === normalizedCountry) &&
        r.effectiveFrom <= effectiveDate &&
        (r.effectiveTo == null || r.effectiveTo >= effectiveDate),
    );
    if (matches.length === 0) {
      throw new Error(`No tax rate rule found for code "${taxCode}" on ${effectiveDate}`);
    }
    // Most recent effectiveFrom wins if rules overlap.
    matches.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    return matches[0];
  }

  calculate(input: TaxCalculationInput): TaxCalculationResult {
    const country = input.country.trim().toUpperCase();
    const docKind = input.documentKind ?? 'INVOICE';
    const effectiveTaxPointDate =
      docKind === 'CREDIT_NOTE' && input.originalInvoiceTaxPointDate
        ? input.originalInvoiceTaxPointDate
        : input.taxPointDate;
    const postingDate = input.postingDate ?? input.taxPointDate;
    const deductibleDate = input.deductibleDate ?? postingDate;

    const rule = this.resolveRate(input.taxCode, effectiveTaxPointDate, null, country);
    const rateBps =
      docKind === 'CREDIT_NOTE' && input.originalInvoiceRateBps != null
        ? input.originalInvoiceRateBps
        : rule.rateBps;
    const reverseCharge = Boolean(input.reverseCharge ?? rule.reverseCharge);
    const taxMinor = roundMinorHalfUp(input.netMinor * BigInt(rateBps), 10_000n);
    const accounts: Required<TaxPostingAccounts> = { ...this.defaultAccounts, ...input.accounts };

    const whtRule = input.withholdingCode ? this.whtRules.get(input.withholdingCode) : undefined;
    if (input.withholdingCode && !whtRule) {
      throw new Error(`Unknown withholding rule "${input.withholdingCode}"`);
    }
    const event: WithholdingEvent = input.withholdingEvent ?? (docKind === 'BILL' ? 'BILL' : 'INVOICE');
    const isDocumentEvent = event === 'BILL' || event === 'INVOICE';
    const shouldWithholdNow = Boolean(
      whtRule &&
        ((whtRule.timing === 'INVOICE' && isDocumentEvent) || (whtRule.timing === 'PAYMENT' && event === 'PAYMENT')),
    );

    const withheldMinor =
      shouldWithholdNow && whtRule ? roundMinorHalfUp(input.netMinor * BigInt(whtRule.rateBps), 10_000n) : 0n;
    const netPayableMinor = input.netMinor - withheldMinor;
    const certificateNumber = shouldWithholdNow && whtRule
      ? (input.certificateNumber ?? this.certificates.next(whtRule.certificatePrefix, postingDate))
      : null;

    const journalLines: TaxPostingLine[] = [];
    let inputMinor = 0n;
    let outputMinor = 0n;

    if (event === 'PAYMENT') {
      journalLines.push({ accountCode: accounts.apOrArAccount, debitMinor: input.netMinor, creditMinor: 0n });
      journalLines.push({ accountCode: accounts.bankAccount, debitMinor: 0n, creditMinor: netPayableMinor });
      if (withheldMinor > 0n) {
        journalLines.push({ accountCode: accounts.whtPayableAccount, debitMinor: 0n, creditMinor: withheldMinor });
      }
      return {
        effectiveTaxPointDate,
        postingDate,
        deductibleDate,
        rateBps: 0,
        taxMinor: 0n,
        netTaxImpactMinor: 0n,
        reverseCharge: false,
        returnBoxes: { inputBox: null, outputBox: null, inputMinor: 0n, outputMinor: 0n },
        withholding: {
          applied: shouldWithholdNow,
          timing: whtRule?.timing ?? null,
          withheldMinor,
          netPayableMinor,
          certificateNumber,
        },
        journalLines,
      };
    }

    if (reverseCharge) {
      journalLines.push({ accountCode: accounts.expenseOrRevenueAccount, debitMinor: input.netMinor, creditMinor: 0n });
      journalLines.push({
        accountCode: accounts.apOrArAccount,
        debitMinor: 0n,
        creditMinor: input.netMinor - withheldMinor,
      });
      if (withheldMinor > 0n) {
        journalLines.push({ accountCode: accounts.whtPayableAccount, debitMinor: 0n, creditMinor: withheldMinor });
      }
      if (taxMinor > 0n) {
        journalLines.push({
          accountCode: accounts.inputVatAccount,
          debitMinor: taxMinor,
          creditMinor: 0n,
          taxBox: rule.inputBox ?? 'RC_INPUT',
          deductibleDate,
        });
        journalLines.push({
          accountCode: accounts.outputRcVatAccount,
          debitMinor: 0n,
          creditMinor: taxMinor,
          taxBox: rule.outputBox ?? 'RC_OUTPUT',
        });
        inputMinor = taxMinor;
        outputMinor = taxMinor;
      }
      return {
        effectiveTaxPointDate,
        postingDate,
        deductibleDate,
        rateBps,
        taxMinor,
        netTaxImpactMinor: 0n,
        reverseCharge: true,
        returnBoxes: {
          inputBox: rule.inputBox ?? 'RC_INPUT',
          outputBox: rule.outputBox ?? 'RC_OUTPUT',
          inputMinor,
          outputMinor,
        },
        withholding: {
          applied: shouldWithholdNow,
          timing: whtRule?.timing ?? null,
          withheldMinor,
          netPayableMinor,
          certificateNumber,
        },
        journalLines,
      };
    }

    // Standard invoice / bill / credit note
    const gross = input.netMinor + taxMinor;
    if (docKind === 'CREDIT_NOTE') {
      journalLines.push({ accountCode: accounts.expenseOrRevenueAccount, debitMinor: input.netMinor, creditMinor: 0n });
      if (taxMinor > 0n) {
        journalLines.push({
          accountCode: accounts.outputVatAccount,
          debitMinor: taxMinor,
          creditMinor: 0n,
          taxBox: rule.outputBox ?? null,
        });
        outputMinor = taxMinor;
      }
      journalLines.push({ accountCode: accounts.apOrArAccount, debitMinor: 0n, creditMinor: gross });
    } else if (docKind === 'BILL') {
      journalLines.push({ accountCode: accounts.expenseOrRevenueAccount, debitMinor: input.netMinor, creditMinor: 0n });
      if (taxMinor > 0n) {
        journalLines.push({
          accountCode: accounts.inputVatAccount,
          debitMinor: taxMinor,
          creditMinor: 0n,
          taxBox: rule.inputBox ?? null,
          deductibleDate,
        });
        inputMinor = taxMinor;
      }
      journalLines.push({ accountCode: accounts.apOrArAccount, debitMinor: 0n, creditMinor: gross - withheldMinor });
      if (withheldMinor > 0n) {
        journalLines.push({ accountCode: accounts.whtPayableAccount, debitMinor: 0n, creditMinor: withheldMinor });
      }
    } else {
      journalLines.push({ accountCode: accounts.apOrArAccount, debitMinor: gross - withheldMinor, creditMinor: 0n });
      if (withheldMinor > 0n) {
        journalLines.push({ accountCode: accounts.whtReceivableAccount, debitMinor: withheldMinor, creditMinor: 0n });
      }
      journalLines.push({ accountCode: accounts.expenseOrRevenueAccount, debitMinor: 0n, creditMinor: input.netMinor });
      if (taxMinor > 0n) {
        journalLines.push({
          accountCode: accounts.outputVatAccount,
          debitMinor: 0n,
          creditMinor: taxMinor,
          taxBox: rule.outputBox ?? null,
        });
        outputMinor = taxMinor;
      }
    }

    return {
      effectiveTaxPointDate,
      postingDate,
      deductibleDate,
      rateBps,
      taxMinor,
      netTaxImpactMinor: taxMinor,
      reverseCharge: false,
      returnBoxes: {
        inputBox: rule.inputBox ?? null,
        outputBox: rule.outputBox ?? null,
        inputMinor,
        outputMinor,
      },
      withholding: {
        applied: shouldWithholdNow,
        timing: whtRule?.timing ?? null,
        withheldMinor,
        netPayableMinor,
        certificateNumber,
      },
      journalLines,
    };
  }
}
