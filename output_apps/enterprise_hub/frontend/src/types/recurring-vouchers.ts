/**
 * تایپ‌های اسناد دوره‌ای (Recurring Vouchers) — منطبق بر DTOهای
 * `modules/accounting/dto/recurring-voucher.dto.ts` (Contract-First — Rule #4).
 */

export type RecurringVoucherFrequency = "MONTHLY" | "QUARTERLY" | "YEARLY";

export const FREQUENCY_LABELS: Record<RecurringVoucherFrequency, string> = {
  MONTHLY: "ماهانه",
  QUARTERLY: "فصلی",
  YEARLY: "سالانه",
};

export interface RecurringVoucherLine {
  accountCode: string;
  debit?: number | string;
  credit?: number | string;
  description?: string;
}

export interface RecurringVoucher {
  id: number;
  name: string;
  description: string;
  lines: RecurringVoucherLine[];
  frequency: RecurringVoucherFrequency;
  nextRunDate: string;
  endDate: string | null;
  autoReverse: boolean;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringVoucherSkipped {
  id: number;
  date: string;
  reason: string;
}

export interface RunRecurringVouchersResult {
  created: number;
  reversed: number;
  skipped: RecurringVoucherSkipped[];
}
