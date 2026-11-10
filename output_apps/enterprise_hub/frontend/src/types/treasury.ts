/** Frontend types for Treasury module (receipts, payments, and invoice allocations). */

export const TreasuryDocKind = {
  RECEIPT: "receipt",
  PAYMENT: "payment",
} as const;
export type TreasuryDocKind = (typeof TreasuryDocKind)[keyof typeof TreasuryDocKind];

export const TreasuryPartyType = {
  CUSTOMER: "customer",
  SUPPLIER: "supplier",
} as const;
export type TreasuryPartyType = (typeof TreasuryPartyType)[keyof typeof TreasuryPartyType];

export const TreasuryMethod = {
  CASH: "cash",
  BANK_TRANSFER: "bank_transfer",
  CARD: "card",
  CHEQUE: "cheque",
} as const;
export type TreasuryMethod = (typeof TreasuryMethod)[keyof typeof TreasuryMethod];

export const TreasuryDocStatus = {
  POSTED: "posted",
  REVERSED: "reversed",
  DRAFT: "draft",
} as const;
export type TreasuryDocStatus = (typeof TreasuryDocStatus)[keyof typeof TreasuryDocStatus];

export const TREASURY_METHOD_LABELS: Record<TreasuryMethod, string> = {
  cash: "نقد (صندوق)",
  bank_transfer: "واریز بانکی / حواله",
  card: "کارتخوان / پوز",
  cheque: "چک",
};

export const TREASURY_KIND_LABELS: Record<TreasuryDocKind, string> = {
  receipt: "رسید دریافت",
  payment: "رسید پرداخت",
};

export const TREASURY_PARTY_LABELS: Record<TreasuryDocKind, string> = {
  receipt: "دریافت از",
  payment: "پرداخت به",
};

export interface TreasuryLine {
  id: number;
  method: TreasuryMethod;
  amount: number | string;
  bankAccountId?: number | null;
  cashBoxId?: number | null;
  chequeId?: number | null;
  reference?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  chequeNumber?: string | null;
  dueDate?: string | null;
}

export interface TreasuryAllocation {
  id: number;
  invoiceId: string;
  invoiceNumber: string | null;
  amount: number | string;
  writeoff: number | string;
  allocatedDate: string;
  journalEntryId: number | null;
}

export interface TreasuryDocument {
  id: number;
  kind: TreasuryDocKind;
  docNumber: string;
  docDate: string;
  partyType: TreasuryPartyType;
  partyCode: string;
  partyName: string;
  total: number | string;
  writeoffTotal: number | string;
  advanceRemaining: number | string;
  description: string | null;
  status: string;
  journalEntryId: number | null;
}

export interface TreasuryDocumentDetail extends TreasuryDocument {
  methods: TreasuryLine[];
  allocations: TreasuryAllocation[];
}

export interface QueryTreasuryDocuments {
  kind?: TreasuryDocKind;
  partyCode?: string;
  from?: string;
  to?: string;
}
