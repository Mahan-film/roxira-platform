/**
 * تایپ‌های مشترک ماژول حسابداری دوطرفه (Double-Entry General Ledger).
 * این تایپ‌ها دقیقاً منطبق بر DTOهای Swagger بک‌اند NestJS در
 * `modules/accounting/dto` هستند (Contract-First Synchronization — Rule #4).
 */

export enum AccountType {
  ASSET = "ASSET",
  LIABILITY = "LIABILITY",
  EQUITY = "EQUITY",
  REVENUE = "REVENUE",
  EXPENSE = "EXPENSE",
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  [AccountType.ASSET]: "دارایی",
  [AccountType.LIABILITY]: "بدهی",
  [AccountType.EQUITY]: "سرمایه",
  [AccountType.REVENUE]: "درآمد",
  [AccountType.EXPENSE]: "هزینه",
};

export enum JournalEntryStatus {
  POSTED = "POSTED",
  DRAFT = "DRAFT",
  VOID = "VOID",
}

export const JOURNAL_ENTRY_STATUS_LABELS: Record<JournalEntryStatus, string> = {
  [JournalEntryStatus.POSTED]: "ثبت‌شده",
  [JournalEntryStatus.DRAFT]: "پیش‌نویس",
  [JournalEntryStatus.VOID]: "ابطال‌شده",
};

export interface ChartOfAccount {
  id: number;
  code: string;
  name: string;
  accountType: AccountType;
  currency: string;
  balance: number;
}

export interface CreateAccountDto {
  code: string;
  name: string;
  accountType: AccountType;
  currency?: string;
}

export interface JournalEntryLine {
  id: number;
  accountId: number;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string | null;
}

export interface JournalEntryResponse {
  id: number;
  entryNumber: string;
  date: string;
  description: string;
  status: JournalEntryStatus;
  totalDebit: number;
  totalCredit: number;
  lines: JournalEntryLine[];
}

export interface CreateJournalLineDto {
  accountCode: string;
  debit?: number;
  credit?: number;
  description?: string;
}

export interface CreateJournalEntryDto {
  entryNumber: string;
  date?: string;
  description: string;
  lines: CreateJournalLineDto[];
}

export interface QueryJournalEntryDto {
  page?: number;
  limit?: number;
  status?: JournalEntryStatus;
  entryNumber?: string;
}

export interface PaginatedJournalEntryResponse {
  data: JournalEntryResponse[];
  total: number;
  page: number;
  limit: number;
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  accountType: AccountType;
  totalDebit: number;
  totalCredit: number;
  balance: number;
}

export interface TrialBalanceResponse {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export interface AccountLedgerLine {
  id: number;
  journalEntryId: number;
  entryNumber: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface AccountLedgerResponse {
  account: ChartOfAccount;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  entries: AccountLedgerLine[];
}

export interface QueryAccountLedgerDto {
  fromDate?: string;
  toDate?: string;
  limit?: number;
}