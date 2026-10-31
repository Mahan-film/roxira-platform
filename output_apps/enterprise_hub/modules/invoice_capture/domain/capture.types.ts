/** Normalised invoice fields. Money fields are exact decimal strings (scale <= 2). */
export type CaptureKind = 'purchase' | 'sales';

export interface DraftItem {
  description: string;
  /** Decimal string, up to 3 decimals. */
  quantity: string;
  unitPrice: string;
  total: string;
  /** Chart code chosen server-side or edited by the user; never taken from document text. */
  accountCode: string | null;
}

export interface DraftInvoice {
  kind: CaptureKind;
  sellerName: string;
  sellerTaxId: string;
  buyerName: string;
  buyerTaxId: string;
  invoiceNumber: string;
  /** ISO `YYYY-MM-DD` (Gregorian) or null when unreadable. */
  date: string | null;
  /** ISO 4217 code; `IRR` for rials (toman amounts are converted at extraction). */
  currency: string;
  /** Rate to IRR, required to post a non-IRR invoice. */
  fxRate: string | null;
  items: DraftItem[];
  subtotal: string;
  tax: string;
  total: string;
  paid: boolean;
  notes: string;
}

export type FieldConfidence = Record<string, number>;

export interface ExtractionResult {
  draft: DraftInvoice;
  fieldConfidence: FieldConfidence;
  /** Findings of the parser (dropped keys, suspected injection, toman conversion ...). */
  notes: string[];
}

export type FindingSeverity = 'error' | 'warning';

export interface Finding {
  code: string;
  severity: FindingSeverity;
  field?: string;
  message: string;
}

export interface VoucherLine {
  accountCode: string;
  debit: string;
  credit: string;
  description: string;
  partyCode?: string;
}

export interface Voucher {
  description: string;
  date: string;
  lines: VoucherLine[];
}
