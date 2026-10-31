/** Types for the cheque API (`/enterprise-hub/cheques`, NestJS ChequesModule). */

export type ChequeDirection = "received" | "issued";

export type ChequeStatus =
  | "registered"
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
    deposited: "در جریان وصول",
    cleared: "وصول‌شده",
    bounced: "برگشتی",
    returned: "عودت‌شده",
    spent: "خرج‌شده",
  },
  issued: {
    registered: "صادرشده (پرداخت‌نشده)",
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
  chequeNumber: string;
  bankName: string | null;
  /** Exact: a number when safe, otherwise a decimal string. */
  amount: number | string;
  issueDate: string;
  dueDate: string;
  partyName: string;
  partyCode: string | null;
  spentToName: string | null;
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
  chequeNumber: string;
  bankName?: string;
  /** Decimal string with at most 2 decimals, e.g. "50000000" or "50000000.50". */
  amount: string;
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
  note?: string;
}
