/** Contract of /enterprise-hub/assistant/capture/* (modules/invoice_capture CaptureView). */

export type CaptureStatus =
  | "draft"
  | "needs_review"
  | "posted"
  | "auto_posted"
  | "rejected"
  | "reversed";

export interface CaptureItem {
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
  accountCode: string | null;
}

export interface CaptureDraft {
  kind: "purchase" | "sales";
  sellerName: string;
  sellerTaxId: string;
  buyerName: string;
  buyerTaxId: string;
  invoiceNumber: string;
  date: string | null;
  currency: string;
  fxRate: string | null;
  items: CaptureItem[];
  subtotal: string;
  tax: string;
  total: string;
  paid: boolean;
  notes: string;
}

export interface CaptureFinding {
  code: string;
  severity: "error" | "warning";
  field?: string;
  message: string;
}

export interface CaptureVoucherLine {
  accountCode: string;
  debit: string;
  credit: string;
  description: string;
}

export interface CaptureView {
  id: string;
  status: CaptureStatus;
  sourceKind: "image" | "pdf" | "voice" | "text";
  confidence: number;
  fieldConfidence: Record<string, number>;
  draft: CaptureDraft;
  findings: CaptureFinding[];
  voucher: { description: string; date: string; lines: CaptureVoucherLine[] } | null;
  vendor: { id: string | null; name: string; isNew: boolean; autoPost: boolean };
  model: string | null;
  costUsd: number;
  entryNumber: string | null;
  journalEntryId: number | null;
  postedBy: string | null;
  autoReasons: string[];
  sourceUrl: string;
  transcript: string | null;
  createdAt: string;
}

export interface CaptureSettings {
  autoEnabled: boolean;
  minConfidence: number;
  dailyCostCapUsd: number;
  dailyDocCap: number;
}
