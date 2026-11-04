/**
 * قراردادهای تایپ‌سیف اتصال مودیان و گزارش‌های فصلی؛ منطبق بر DTOهای
 * `modules/tax_compliance/` (Rule #4 - AGENTS.md).
 */

export interface MoadianStatusResponse {
  enabled: boolean;
  configured: boolean;
}

export type MoadianSubmissionStatus =
  | "QUEUED"
  | "SENT"
  | "SUCCESS"
  | "FAILED"
  | "ERROR";

export const MOADIAN_STATUS_LABELS: Record<MoadianSubmissionStatus, string> = {
  QUEUED: "در صف ارسال",
  SENT: "ارسال شد؛ در انتظار نتیجه استعلام",
  SUCCESS: "استعلام موفق (طبق پاسخ سامانه)",
  FAILED: "رد شد؛ خطاها را اصلاح و دوباره ارسال کنید",
  ERROR: "خطای انتقال یا پیکربندی",
};

export interface MoadianMessage {
  code: string;
  message: string;
}

export interface MoadianSubmissionResponse {
  id: string;
  invoiceId: string;
  uid: string;
  taxId: string;
  referenceNumber: string | null;
  status: MoadianSubmissionStatus;
  errors: MoadianMessage[];
  warnings: MoadianMessage[];
  pollCount: number;
  sentAt: string | null;
  lastPolledAt: string | null;
  updatedAt: string;
}

export interface SeasonalPeriod {
  year: number;
  quarter: number;
  label: string;
  from: string;
  to: string;
}

export interface SeasonalVatRateRow {
  rate: number;
  invoiceLines: number;
  /** Exact rial amount: a number, or a decimal string when a number would lose precision. */
  taxableBase: number | string;
  vat: number | string;
}

export interface SeasonalVatReport {
  period: SeasonalPeriod;
  currency: "IRR";
  sales: {
    invoiceCount: number;
    taxableBase: number | string;
    vat: number | string;
    byRate: SeasonalVatRateRow[];
  };
  purchases: {
    available: true;
    documentCount: number;
    invoiceCount: number;
    captureCount: number;
    taxableBase: number | string;
    inputVat: number | string;
    unreadableCaptures: number;
  };
  notes: string[];
}

export interface SeasonalTransactionRow {
  taxInvoiceNumber: string;
  issuedAtJalali: string;
  buyerName: string;
  buyerNationalId: string;
  buyerEconomicCode: string;
  /** Exact rial amount: a number, or a decimal string when a number would lose precision. */
  taxableBase: number | string;
  vat: number | string;
  total: number | string;
  status: string;
}

export interface SeasonalTransactionsResponse {
  period: SeasonalPeriod;
  rows: SeasonalTransactionRow[];
  notes: string[];
}

export interface VatReturnDraft {
  status: "draft";
  period: { year: number; quarter: number; label: string };
  output: { invoiceCount: number; taxableBase: number | string; vat: number | string };
  input: { documentCount: number; taxableBase: number | string; vat: number | string };
  levies: { amount: number | string; status: "unclear" };
  netVat: number | string;
  carriedCreditIn: number | string;
  payable: number | string;
  creditCarriedForward: number | string;
  ledger: {
    outputAccount: string | null;
    inputAccount: string | null;
    netPayable: number | string;
    difference: number | string;
    reconciled: boolean;
  };
  notes: string[];
}
