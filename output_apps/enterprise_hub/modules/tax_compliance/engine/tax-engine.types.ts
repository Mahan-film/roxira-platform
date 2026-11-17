export type TaxDocumentKind = 'INVOICE' | 'CREDIT_NOTE' | 'BILL';
export type WithholdingTiming = 'INVOICE' | 'PAYMENT';
export type WithholdingEvent = 'BILL' | 'PAYMENT';

/** Effective-dated tax rate rule; rates are integer basis points (19% = 1900, 10% = 1000). */
export interface TaxRateRule {
  code: string;
  rateBps: number;
  /** Inclusive ISO date (YYYY-MM-DD). */
  effectiveFrom: string;
  /** Inclusive ISO date (YYYY-MM-DD), or null/undefined if open-ended. */
  effectiveTo?: string | null;
  reverseCharge?: boolean;
  inputBox?: string | null;
  outputBox?: string | null;
  label?: string;
}

/** Withholding tax rule; rates are integer basis points (5% = 500). */
export interface WithholdingRule {
  code: string;
  rateBps: number;
  timing: WithholdingTiming;
  certificatePrefix: string;
}

export interface TaxPostingAccounts {
  expenseOrRevenueAccount?: string;
  apOrArAccount?: string;
  inputVatAccount?: string;
  outputVatAccount?: string;
  outputRcVatAccount?: string;
  bankAccount?: string;
  whtPayableAccount?: string;
}

export interface TaxCalculationInput {
  country: string;
  taxCode: string;
  netMinor: bigint;
  /** Tax point date (YYYY-MM-DD). */
  taxPointDate: string;
  /** Accounting posting date (YYYY-MM-DD); defaults to `taxPointDate`. */
  postingDate?: string;
  /** VAT deductibility date (YYYY-MM-DD), separate from `postingDate`; defaults to `postingDate`. */
  deductibleDate?: string | null;
  documentKind?: TaxDocumentKind;
  /** For credit notes: the original invoice's tax point date (YYYY-MM-DD). */
  originalInvoiceTaxPointDate?: string | null;
  /** Explicit rate override in bps from the original invoice, if already resolved. */
  originalInvoiceRateBps?: number | null;
  reverseCharge?: boolean;
  withholdingCode?: string | null;
  withholdingEvent?: WithholdingEvent;
  accounts?: TaxPostingAccounts;
}

export interface TaxPostingLine {
  accountCode: string;
  debitMinor: bigint;
  creditMinor: bigint;
  taxBox?: string | null;
  deductibleDate?: string | null;
}

export interface TaxCalculationResult {
  effectiveTaxPointDate: string;
  postingDate: string;
  deductibleDate: string;
  rateBps: number;
  taxMinor: bigint;
  netTaxImpactMinor: bigint;
  reverseCharge: boolean;
  returnBoxes: {
    inputBox: string | null;
    outputBox: string | null;
    inputMinor: bigint;
    outputMinor: bigint;
  };
  withholding: {
    applied: boolean;
    timing: WithholdingTiming | null;
    withheldMinor: bigint;
    netPayableMinor: bigint;
    certificateNumber: string | null;
  };
  journalLines: TaxPostingLine[];
}

export interface TaxEngine {
  resolveRate(taxCode: string, taxPointDate: string, originalInvoiceTaxPointDate?: string | null): TaxRateRule;
  calculate(input: TaxCalculationInput): TaxCalculationResult;
}
