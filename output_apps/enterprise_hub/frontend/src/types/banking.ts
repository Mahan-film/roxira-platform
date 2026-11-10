/** Types for the bank reconciliation API (`/enterprise-hub/banking`, NestJS BankingModule). */

export type BankCode =
  | "mellat"
  | "melli"
  | "saderat"
  | "tejarat"
  | "pasargad"
  | "saman"
  | "other";

export const BANK_LABELS: Record<BankCode, string> = {
  mellat: "ملت",
  melli: "ملی",
  saderat: "صادرات",
  tejarat: "تجارت",
  pasargad: "پاسارگاد",
  saman: "سامان",
  other: "سایر",
};

export type MatchMethod = "auto" | "manual" | "created";

export const MATCH_METHOD_LABELS: Record<MatchMethod, string> = {
  auto: "خودکار",
  manual: "دستی",
  created: "سند جدید",
};

export interface BankAccount {
  id: number;
  name: string;
  bankCode: BankCode;
  accountNumber: string;
  iban: string | null;
  ledgerAccountId: number;
  ledgerAccountCode: string;
  ledgerAccountName: string;
  currency: string;
  openingBalance: number;
}

export interface CreateBankAccountDto {
  name: string;
  bankCode?: BankCode;
  accountNumber: string;
  iban?: string;
  ledgerAccountId: number;
  openingBalance?: number;
}

export interface StatementLine {
  id: number;
  bankAccountId: number;
  txnDate: string;
  description: string | null;
  withdrawal: number;
  deposit: number;
  balance: number | null;
  reference: string | null;
  matchedJournalLineId: number | null;
  matchMethod: MatchMethod | null;
  createdJournalEntryId: number | null;
}

export interface BookLine {
  id: number;
  journalEntryId: number;
  entryNumber: string;
  date: string;
  description: string | null;
  debit: number;
  credit: number;
  matchedStatementLineId: number | null;
}

export interface AutoMatchResult {
  matched: number;
  ambiguous: number;
  stillUnmatched: number;
}

export interface ReconciliationSummary {
  bankAccountId: number;
  asOf: string;
  bookBalance: number;
  bankBalance: number;
  unmatchedBankDeposits: number;
  unmatchedBankWithdrawals: number;
  unmatchedBookDebits: number;
  unmatchedBookCredits: number;
  adjustedBankBalance: number;
  adjustedBookBalance: number;
  difference: number;
  matchedCount: number;
  unmatchedStatementCount: number;
  unmatchedBookCount: number;
}

export interface CashBox {
  id: number;
  tenantId: string;
  name: string;
  code: string;
  ledgerAccountId: number;
  currency: string;
  openingBalance: number | string;
  currentBalance?: number | string;
  active?: boolean;
  status?: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCashBoxDto {
  name: string;
  code: string;
  ledgerAccountId: number;
  currency?: string;
  openingBalance?: number | string;
  description?: string;
}

export interface CashBankTransferDto {
  cashBoxId: number;
  bankAccountId: number;
  amount: number | string;
  date: string;
  direction: "TO_BANK" | "TO_CASH" | "CASH_TO_BANK" | "BANK_TO_CASH";
  description?: string;
}

export interface PosSettlementDto {
  bankAccountId: number;
  terminalNumber: string;
  date: string;
  grossAmount: number | string;
  feeAmount: number | string;
  referenceNumber?: string;
  description?: string;
}

export interface PosSettlementResult {
  settlement: {
    id: number;
    terminalNumber: string;
    grossAmount: number;
    feeAmount: number;
    netAmount: number;
    date: string;
    status: string;
  };
  voucher: {
    entryId: number;
    entryNumber: string;
  };
}
