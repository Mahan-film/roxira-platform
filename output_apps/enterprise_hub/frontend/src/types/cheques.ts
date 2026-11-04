/** Types for the cheque API (`/enterprise-hub/cheques`, NestJS ChequesModule). */

export type SayadRegistrationStatus = "unknown" | "registered" | "unregistered";

export const SAYAD_REGISTRATION_LABELS: Record<SayadRegistrationStatus, string> = {
  unknown: "نامشخص",
  registered: "ثبت‌شده در صیاد (اعلام کاربر)",
  unregistered: "ثبت‌نشده در صیاد (اعلام کاربر)",
};

export type ChequeDirection = "received" | "issued";

export type ChequeStatus =
  | "registered"
  | "delivered"
  | "deposited"
  | "cleared"
  | "bounced"
  | "returned"
  | "spent";

export const DIRECTION_LABELS: Record<ChequeDirection, string> = {
  received: "دریافتی",
  issued: "صادرشده",
};

export const STATUS_LABELS: Record<ChequeDirection, Record<ChequeStatus, string>> = {
  received: {
    registered: "نزد صندوق",
    delivered: "—",
    deposited: "در جریان وصول",
    cleared: "وصول‌شده",
    bounced: "برگشتی",
    returned: "عودت‌شده",
    spent: "خرج‌شده",
  },
  issued: {
    registered: "صادرشده (پرداخت‌نشده)",
    delivered: "تحویل‌شده به ذی‌نفع",
    deposited: "—",
    cleared: "پاس‌شده",
    bounced: "برگشتی",
    returned: "ابطال/عودت",
    spent: "—",
  },
};

/** Button text for moving a cheque to a state. */
export const ACTION_LABELS: Record<ChequeDirection, Partial<Record<ChequeStatus, string>>> = {
  received: {
    deposited: "واگذاری به بانک",
    cleared: "وصول شد",
    bounced: "برگشت خورد",
    spent: "خرج چک",
    returned: "عودت به صادرکننده",
  },
  issued: {
    delivered: "تحویل به ذی‌نفع",
    cleared: "پاس شد",
    bounced: "برگشت خورد",
    returned: "ابطال/عودت",
  },
};

export interface Cheque {
  id: number;
  direction: ChequeDirection;
  sayadNumber: string | null;
  sayadVerified: boolean;
  /** Declared by the user; never read from Sayad. */
  sayadRegistrationStatus: SayadRegistrationStatus;
  sayadVerifiedBy: string | null;
  sayadVerifiedAt: string | null;
  receiverNationalId: string | null;
  chequeNumber: string;
  bankName: string | null;
  /** Exact: a number when safe, otherwise a decimal string. */
  amount: number | string;
  issueDate: string;
  dueDate: string;
  partyName: string;
  partyCode: string | null;
  spentToName: string | null;
  spentToCode: string | null;
  spentToNationalId: string | null;
  /** Part already paid by the bank / what is left. */
  settledAmount: number | string;
  remainingAmount: number | string;
  status: ChequeStatus;
  allowedNext: ChequeStatus[];
  description: string | null;
}

export interface DueCheque extends Cheque {
  daysUntilDue: number;
  overdue: boolean;
}

export interface DueCheques {
  asOf: string;
  until: string;
  items: DueCheque[];
  receivedTotal: number | string;
  issuedTotal: number | string;
}

export interface CreateChequeDto {
  direction: ChequeDirection;
  sayadNumber?: string;
  sayadVerified?: boolean;
  sayadRegistrationStatus?: SayadRegistrationStatus;
  receiverNationalId?: string;
  chequeNumber: string;
  bankName?: string;
  /** Decimal string with at most 2 decimals, e.g. "50000000" or "50000000.50" (the API also accepts a number). */
  amount: string | number;
  issueDate: string;
  dueDate: string;
  partyName: string;
  partyCode?: string;
  description?: string;
}

export interface TransitionChequeDto {
  status: ChequeStatus;
  eventDate?: string;
  spentToName?: string;
  spentToCode?: string;
  spentToNationalId?: string;
  note?: string;
}

export interface PartialPaymentDto {
  amount: string | number;
  eventDate?: string;
  note?: string;
}

export interface VerifySayadDto {
  verified: boolean;
  sayadRegistrationStatus?: SayadRegistrationStatus;
  note?: string;
}

export type BouncedBucketKey = "0-30" | "31-60" | "61-90" | "90+";

export interface BouncedCheque extends Cheque {
  bouncedOn: string;
  ageDays: number;
  bucket: BouncedBucketKey;
}

export interface BouncedBucket {
  bucket: BouncedBucketKey;
  count: number;
  receivedTotal: number | string;
  issuedTotal: number | string;
}

export interface BouncedCheques {
  asOf: string;
  items: BouncedCheque[];
  buckets: BouncedBucket[];
  receivedTotal: number | string;
  issuedTotal: number | string;
}

export type ReconState = "reconciled" | "suggested" | "unmatched" | "no_bank_line";

export interface ReconCandidate {
  statementLineId: number;
  txnDate: string;
  description: string | null;
  reference: string | null;
}

export interface ReconItem {
  eventId: number;
  chequeId: number;
  direction: ChequeDirection;
  chequeNumber: string;
  sayadNumber: string | null;
  partyName: string;
  eventDate: string;
  amount: number | string;
  journalEntryId: number;
  state: ReconState;
  matchedStatementLineId: number | null;
  candidates: ReconCandidate[];
}

export interface ChequeRecon {
  items: ReconItem[];
  counts: Record<ReconState, number>;
}

export interface ReconApplyResult {
  matched: number;
  skippedAmbiguous: number;
  failed: number;
}
