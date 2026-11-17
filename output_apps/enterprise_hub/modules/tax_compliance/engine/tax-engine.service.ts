import { Injectable } from '@nestjs/common';
import { roundMinorHalfUp } from '../../accounting/money';
import {
  TaxCalculationInput,
  TaxCalculationResult,
  TaxEngine,
  TaxPostingLine,
  TaxRateRule,
  WithholdingRule,
} from './tax-engine.types';

const DEFAULT_ACCOUNTS = {
  expenseOrRevenueAccount: '5010',
  apOrArAccount: '2010',
  inputVatAccount: '1410',
  outputVatAccount: '2410',
  outputRcVatAccount: '2415',
  bankAccount: '1010',
  whtPayableAccount: '2420',
} as const;

/** Built-in Iran tax codes preserved for golden compatibility. */
export const IRAN_DEFAULT_TAX_RULES: readonly TaxRateRule[] = [
  { code: 'IR_VAT_9', rateBps: 900, effectiveFrom: '2015-03-21', effectiveTo: '2024-03-19', outputBox: 'IR_VAT_STD', inputBox: 'IR_VAT_IN' },
  { code: 'IR_VAT_10', rateBps: 1000, effectiveFrom: '2024-03-20', effectiveTo: null, outputBox: 'IR_VAT_STD', inputBox: 'IR_VAT_IN' },
  { code: 'IR_EXEMPT', rateBps: 0, effectiveFrom: '2000-01-01', effectiveTo: null, outputBox: 'IR_VAT_EXEMPT', inputBox: null },
];

/** Sequential certificate allocator (`PREFIX-YYYY-NNNN`) scoped by prefix and calendar year. */
export class WhtCertificateSequencer {
  private readonly counters = new Map<string, number>();

  next(prefix: string, dateStr: string): string {
    const year = Number(dateStr.slice(0, 4)) || new Date().getUTCFullYear();
    const key = `${prefix}:${year}`;
    const nextSeq = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, nextSeq);
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
  private readonly taxRules: TaxRateRule[] = [...IRAN_DEFAULT_TAX_RULES];
  private readonly whtRules = new Map<string, WithholdingRule>();
  private readonly certificates = new WhtCertificateSequencer();

  registerTaxRules(rules: readonly TaxRateRule[]): void {
    this.taxRules.push(...rules);
  }

  registerWithholdingRules(rules: readonly WithholdingRule[]): void {
    for (const rule of rules) {
      this.whtRules.set(rule.code, rule);
    }
  }

  resolveRate(taxCode: string, taxPointDate: string, originalInvoiceTaxPointDate?: string | null): TaxRateRule {
    const effectiveDate = originalInvoiceTaxPointDate ?? taxPointDate;
    const matches = this.taxRules.filter(
      (r) =>
        r.code === taxCode &&
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
    const docKind = input.documentKind ?? 'INVOICE';
    const effectiveTaxPointDate =
      docKind === 'CREDIT_NOTE' && input.originalInvoiceTaxPointDate
        ? input.originalInvoiceTaxPointDate
        : input.taxPointDate;
    const postingDate = input.postingDate ?? input.taxPointDate;
    const deductibleDate = input.deductibleDate ?? postingDate;

    const rule = this.resolveRate(input.taxCode, effectiveTaxPointDate);
    const rateBps =
      docKind === 'CREDIT_NOTE' && input.originalInvoiceRateBps != null
        ? input.originalInvoiceRateBps
        : rule.rateBps;
    const reverseCharge = Boolean(input.reverseCharge ?? rule.reverseCharge);
    const taxMinor = roundMinorHalfUp(input.netMinor * BigInt(rateBps), 10_000n);
    const accounts = { ...DEFAULT_ACCOUNTS, ...input.accounts };

    const whtRule = input.withholdingCode ? this.whtRules.get(input.withholdingCode) : undefined;
    if (input.withholdingCode && !whtRule) {
      throw new Error(`Unknown withholding rule "${input.withholdingCode}"`);
    }
    const event = input.withholdingEvent ?? (docKind === 'BILL' ? 'BILL' : 'BILL');
    const shouldWithholdNow = Boolean(
      whtRule &&
        ((whtRule.timing === 'INVOICE' && event === 'BILL') || (whtRule.timing === 'PAYMENT' && event === 'PAYMENT')),
    );

    const withheldMinor = shouldWithholdNow && whtRule ? roundMinorHalfUp(input.netMinor * BigInt(whtRule.rateBps), 10_000n) : 0n;
    const netPayableMinor = input.netMinor - withheldMinor;
    const certificateNumber = shouldWithholdNow && whtRule ? this.certificates.next(whtRule.certificatePrefix, postingDate) : null;

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
      journalLines.push({ accountCode: accounts.apOrArAccount, debitMinor: 0n, creditMinor: input.netMinor });
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

    // Standard invoice / credit note
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
    } else {
      journalLines.push({ accountCode: accounts.apOrArAccount, debitMinor: gross - withheldMinor, creditMinor: 0n });
      if (withheldMinor > 0n) {
        journalLines.push({ accountCode: accounts.whtPayableAccount, debitMinor: withheldMinor, creditMinor: 0n });
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
