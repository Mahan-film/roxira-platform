import { Inject, Injectable, Optional } from '@nestjs/common';
import { roundMinorHalfUp } from '../../accounting/money';
import { DEFAULT_PACK_TAX_RULES } from './default-tax-rules';
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string, label: string): void {
  if (!ISO_DATE.test(value)) throw new Error(`${label} must be an ISO date (YYYY-MM-DD), got "${value}"`);
}

/**
 * Sequential certificate allocator (`PREFIX-YYYY-NNNN`) scoped by prefix and calendar year.
 * The store is mandatory and async so a DB-backed implementation can persist the counter.
 */
export class WhtCertificateSequencer {
  constructor(private readonly store: WhtCertificateSequenceStore) {}

  async next(prefix: string, dateStr: string): Promise<string> {
    const year = Number(dateStr.slice(0, 4));
    if (!year) throw new Error(`Cannot derive certificate year from "${dateStr}"`);
    const nextSeq = await this.store.next(prefix, year);
    return `${prefix}-${year}-${String(nextSeq).padStart(4, '0')}`;
  }
}

/**
 * Country-neutral tax engine (T180). Evaluates effective-dated VAT rules by tax point (credit
 * notes inherit the original invoice's tax point), reverse charge (input + output RC VAT),
 * withholding at invoice or payment time with sequential certificates, and separate deductible dates.
 *
 * Rounding rule: tax and withholding are rounded half-up ONCE on the document total, in bigint
 * minor units (`net * rateBps / 10_000`). Per-line rounding is NOT used; callers pass the document net.
 */
@Injectable()
export class TaxEngineService implements TaxEngine {
  private readonly taxRules: TaxRateRule[] = [];
  private readonly whtRules = new Map<string, WithholdingRule>();
  private readonly certificates: WhtCertificateSequencer | null;
  private readonly defaultAccounts: Required<TaxPostingAccounts>;

  constructor(
    @Optional() @Inject(WHT_SEQUENCE_STORE) sequenceStore?: WhtCertificateSequenceStore,
    @Optional() @Inject(TAX_DEFAULT_ACCOUNTS) defaultAccounts?: Partial<TaxPostingAccounts>,
    @Optional() @Inject(TAX_INITIAL_RULES) initialRules?: readonly TaxRateRule[],
  ) {
    // No in-memory fallback: a missing store only fails when a certificate is actually needed,
    // so the app can still boot and compute VAT without withholding.
    this.certificates = sequenceStore ? new WhtCertificateSequencer(sequenceStore) : null;
    this.defaultAccounts = { ...FALLBACK_ACCOUNTS, ...defaultAccounts };
    this.registerTaxRules(initialRules ?? DEFAULT_PACK_TAX_RULES);
  }

  registerTaxRules(rules: readonly TaxRateRule[]): void {
    for (const rule of rules) {
      this.assertValidRule(rule);
      const clash = this.taxRules.find(
        (r) =>
          r.country.toUpperCase() === rule.country.toUpperCase() &&
          r.code === rule.code &&
          r.effectiveFrom <= (rule.effectiveTo ?? '9999-12-31') &&
          rule.effectiveFrom <= (r.effectiveTo ?? '9999-12-31'),
      );
      if (clash) {
        throw new Error(
          `Overlapping tax rule for ${rule.country}/${rule.code}: ${rule.effectiveFrom}..${rule.effectiveTo ?? 'open'} ` +
            `overlaps ${clash.effectiveFrom}..${clash.effectiveTo ?? 'open'}`,
        );
      }
      this.taxRules.push({ ...rule, country: rule.country.trim().toUpperCase() });
    }
  }

  private assertValidRule(rule: TaxRateRule): void {
    const id = `${rule.country}/${rule.code}`;
    if (!rule.country?.trim()) throw new Error(`Tax rule "${rule.code}" requires a country`);
    if (!rule.source?.trim()) throw new Error(`Tax rule ${id} requires a source (URL or citation)`);
    assertIsoDate(rule.effectiveFrom, `Tax rule ${id} effectiveFrom`);
    if (rule.effectiveTo != null) {
      assertIsoDate(rule.effectiveTo, `Tax rule ${id} effectiveTo`);
      if (rule.effectiveTo < rule.effectiveFrom) throw new Error(`Tax rule ${id} ends before it starts`);
    }
    if (!Number.isInteger(rule.rateBps) || rule.rateBps < 0) throw new Error(`Tax rule ${id} rateBps must be a non-negative integer`);
    if (rule.treatment !== 'STANDARD' && rule.rateBps !== 0) {
      throw new Error(`Tax rule ${id} treatment ${rule.treatment} requires rateBps 0`);
    }
    if (rule.treatment !== 'STANDARD' && rule.reverseCharge) {
      throw new Error(`Tax rule ${id}: reverse charge requires STANDARD treatment`);
    }
  }

  registerWithholdingRules(rules: readonly WithholdingRule[]): void {
    for (const rule of rules) {
      this.whtRules.set(rule.code, rule);
    }
  }

  /** Resolves the single rule for country + code on `effectiveDate`; throws when none matches. */
  resolveRate(country: string, taxCode: string, effectiveDate: string): TaxRateRule {
    assertIsoDate(effectiveDate, 'effectiveDate');
    const normalizedCountry = country?.trim().toUpperCase();
    if (!normalizedCountry) throw new Error('country is required to resolve a tax rate');
    const rule = this.taxRules.find(
      (r) =>
        r.code === taxCode &&
        r.country === normalizedCountry &&
        r.effectiveFrom <= effectiveDate &&
        (r.effectiveTo == null || r.effectiveTo >= effectiveDate),
    );
    if (!rule) {
      throw new Error(`No tax rate rule found for ${normalizedCountry}/"${taxCode}" on ${effectiveDate}`);
    }
    return rule; // overlaps are rejected at registration, so at most one rule matches
  }

  async calculate(input: TaxCalculationInput): Promise<TaxCalculationResult> {
    const country = input.country.trim().toUpperCase();
    const docKind = input.documentKind ?? 'INVOICE';
    if (docKind === 'CREDIT_NOTE' && !input.originalInvoiceTaxPointDate) {
      throw new Error('CREDIT_NOTE requires originalInvoiceTaxPointDate');
    }
    const effectiveTaxPointDate =
      docKind === 'CREDIT_NOTE' ? (input.originalInvoiceTaxPointDate as string) : input.taxPointDate;
    const postingDate = input.postingDate ?? input.taxPointDate;
    const deductibleDate = input.deductibleDate ?? postingDate;

    const rule = this.resolveRate(country, input.taxCode, effectiveTaxPointDate);
    const rateBps =
      docKind === 'CREDIT_NOTE' && input.originalInvoiceRateBps != null && rule.treatment === 'STANDARD'
        ? input.originalInvoiceRateBps
        : rule.rateBps;
    const reverseCharge = Boolean(rule.reverseCharge);
    if (input.reverseCharge != null && input.reverseCharge !== reverseCharge) {
      throw new Error(`reverseCharge input conflicts with rule ${rule.country}/${rule.code}; the rule decides`);
    }
    const taxMinor =
      rule.treatment === 'STANDARD' ? roundMinorHalfUp(input.netMinor * BigInt(rateBps), 10_000n) : 0n;
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
    let certificateNumber: string | null = null;
    if (shouldWithholdNow && whtRule) {
      if (input.certificateNumber) {
        certificateNumber = input.certificateNumber;
      } else if (!this.certificates) {
        throw new Error('WHT certificate sequence store is not configured: inject WHT_SEQUENCE_STORE or pass certificateNumber');
      } else {
        certificateNumber = await this.certificates.next(whtRule.certificatePrefix, postingDate);
      }
    }

    const journalLines: TaxPostingLine[] = [];
    let inputMinor = 0n;
    let outputMinor = 0n;
    const withholding = {
      applied: shouldWithholdNow,
      timing: whtRule?.timing ?? null,
      withheldMinor,
      netPayableMinor,
      certificateNumber,
    };

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
        treatment: rule.treatment,
        taxMinor: 0n,
        netTaxImpactMinor: 0n,
        reverseCharge: false,
        returnBoxes: { inputBox: null, outputBox: null, inputMinor: 0n, outputMinor: 0n },
        withholding,
        journalLines,
      };
    }

    if (reverseCharge) {
      const inputBox = rule.inputBox ?? 'RC_INPUT';
      const outputBox = rule.outputBox ?? 'RC_OUTPUT';
      if (docKind === 'BILL') {
        // Purchase: the buyer self-assesses (Dr input VAT / Cr output RC VAT), net VAT impact 0.
        journalLines.push({ accountCode: accounts.expenseOrRevenueAccount, debitMinor: input.netMinor, creditMinor: 0n });
        journalLines.push({ accountCode: accounts.apOrArAccount, debitMinor: 0n, creditMinor: input.netMinor - withheldMinor });
        if (withheldMinor > 0n) {
          journalLines.push({ accountCode: accounts.whtPayableAccount, debitMinor: 0n, creditMinor: withheldMinor });
        }
        if (taxMinor > 0n) {
          journalLines.push({ accountCode: accounts.inputVatAccount, debitMinor: taxMinor, creditMinor: 0n, taxBox: inputBox, deductibleDate });
          journalLines.push({ accountCode: accounts.outputRcVatAccount, debitMinor: 0n, creditMinor: taxMinor, taxBox: outputBox });
          inputMinor = taxMinor;
          outputMinor = taxMinor;
        }
      } else {
        // Sales side (INVOICE / CREDIT_NOTE): the customer self-assesses, so the seller posts net only
        // and reports the net turnover; the credit note mirrors the invoice with the sign flipped.
        const isCredit = docKind === 'CREDIT_NOTE';
        // `debitOnInvoice` is the side the line takes on an invoice; a credit note takes the opposite side.
        const side = (amount: bigint, debitOnInvoice: boolean): Pick<TaxPostingLine, 'debitMinor' | 'creditMinor'> =>
          debitOnInvoice !== isCredit ? { debitMinor: amount, creditMinor: 0n } : { debitMinor: 0n, creditMinor: amount };
        journalLines.push({ accountCode: accounts.apOrArAccount, ...side(input.netMinor - withheldMinor, true) });
        if (withheldMinor > 0n) {
          journalLines.push({ accountCode: accounts.whtReceivableAccount, ...side(withheldMinor, true) });
        }
        journalLines.push({ accountCode: accounts.expenseOrRevenueAccount, ...side(input.netMinor, false) });
      }
      return {
        effectiveTaxPointDate,
        postingDate,
        deductibleDate,
        rateBps,
        treatment: rule.treatment,
        taxMinor: docKind === 'BILL' ? taxMinor : 0n,
        netTaxImpactMinor: 0n,
        reverseCharge: true,
        returnBoxes: { inputBox, outputBox, inputMinor, outputMinor },
        withholding,
        journalLines,
      };
    }

    // Non-reverse-charge, non-payment: credit note (sales, reverses invoice), bill (purchase), invoice (sales).
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
      treatment: rule.treatment,
      taxMinor,
      netTaxImpactMinor: taxMinor,
      reverseCharge: false,
      returnBoxes: {
        inputBox: rule.inputBox ?? null,
        outputBox: rule.outputBox ?? null,
        inputMinor,
        outputMinor,
      },
      withholding,
      journalLines,
    };
  }
}
