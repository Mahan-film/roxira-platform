/**
 * تایپ‌های مشترک ماژول حسابداری دوطرفه (Double-Entry General Ledger).
 * این تایپ‌ها دقیقاً منطبق بر DTOهای Swagger بک‌اند NestJS در
 * `modules/accounting/dto` هستند (Contract-First Synchronization — Rule #4).
 */

import { Currency } from "@/types/currency";

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
  TEMPORARY = "TEMPORARY",
  VOID = "VOID",
}

export const JOURNAL_ENTRY_STATUS_LABELS: Record<JournalEntryStatus, string> = {
  [JournalEntryStatus.POSTED]: "قطعی",
  [JournalEntryStatus.DRAFT]: "پیش‌نویس",
  [JournalEntryStatus.TEMPORARY]: "موقت",
  [JournalEntryStatus.VOID]: "ابطال‌شده",
};

export interface ChartOfAccount {
  id: number;
  code: string;
  name: string;
  accountType: AccountType;
  currency: Currency;
  balance: number;
}

export interface CreateAccountDto {
  code: string;
  name: string;
  accountType: AccountType;
  currency?: Currency;
}

export interface JournalEntryLine {
  id: number;
  accountId: number;
  accountCode: string;
  accountName: string;
  currency: Currency;
  debit: number;
  credit: number;
  partyCode?: string | null;
  description: string | null;
}

export interface JournalEntryResponse {
  id: number;
  entryNumber: string;
  /** «شمارهٔ قطعی» (bigint as string); null until the voucher is POSTED. */
  permanentNumber?: string | null;
  permanentFiscalYearId?: number | null;
  date: string;
  description: string;
  status: JournalEntryStatus;
  /** Optimistic edit lock: the version the UI must send back when it saves an edit. */
  version: number;
  currency: Currency;
  totalDebit: number;
  totalCredit: number;
  baseCurrency: Currency;
  baseTotalDebit: number;
  baseTotalCredit: number;
  lines: JournalEntryLine[];
}

export interface CreateJournalLineDto {
  accountCode: string;
  debit?: number;
  credit?: number;
  description?: string;
}

export interface CreateJournalEntryDto {
  /** Optional; when omitted the server generates `JV-<date>-<8 random hex>`. */
  entryNumber?: string;
  date?: string;
  description: string;
  lines: CreateJournalLineDto[];
}

/** Body of `PUT /journal-entries/:id`; `expectedVersion` is the version the form loaded. */
export interface UpdateJournalEntryDto {
  /** Optional; when omitted the server keeps the voucher's current working number. */
  entryNumber?: string;
  date?: string;
  description: string;
  lines: CreateJournalLineDto[];
  expectedVersion?: number;
}

/** Body of `POST /journal-entries/:id/copy`; the date defaults to today on the server. */
export interface CopyJournalEntryDto {
  date?: string;
}

export interface QueryJournalEntryDto {
  page?: number;
  limit?: number;
  status?: JournalEntryStatus;
  entryNumber?: string;
  fromDate?: string; // YYYY-MM-DD
  toDate?: string; // YYYY-MM-DD
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
  currency: Currency;
  totalDebit: number;
  totalCredit: number;
  balance: number;
}

export interface TrialBalanceResponse {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  baseCurrency: Currency;
  baseTotalDebit: number;
  baseTotalCredit: number;
  baseBalanced: boolean;
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
  baseCurrency: Currency;
  baseClosingBalance: number;
  entries: AccountLedgerLine[];
}

export interface QueryAccountLedgerDto {
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

/** یک پیوست سند حسابداری — منطبق بر `VoucherAttachmentResponseDto` در بک‌اند. */
export interface VoucherAttachment {
  id: number;
  journalEntryId: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
}