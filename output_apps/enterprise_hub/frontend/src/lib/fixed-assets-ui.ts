import type {
  DepreciationRunResult,
  FixedAssetMethod,
  FixedAssetStatus,
} from "./api/fixed-assets-client.ts";
import { formatJalaliDate, formatMoneyRial, formatNumber } from "./fa-format.ts";

export const FIXED_ASSET_STATUS_LABELS: Record<FixedAssetStatus, string> = {
  ACTIVE: "فعال",
  FULLY_DEPRECIATED: "کاملاً مستهلک",
  DISPOSED: "فروش‌رفته",
};

export const FIXED_ASSET_METHOD_LABELS: Record<FixedAssetMethod, string> = {
  STRAIGHT_LINE: "خط مستقیم",
  DECLINING_BALANCE: "نزولی",
};

export const JALALI_MONTH_NAMES: ReadonlyArray<{ month: number; label: string }> = [
  { month: 1, label: "فروردین" },
  { month: 2, label: "اردیبهشت" },
  { month: 3, label: "خرداد" },
  { month: 4, label: "تیر" },
  { month: 5, label: "مرداد" },
  { month: 6, label: "شهریور" },
  { month: 7, label: "مهر" },
  { month: 8, label: "آبان" },
  { month: 9, label: "آذر" },
  { month: 10, label: "دی" },
  { month: 11, label: "بهمن" },
  { month: 12, label: "اسفند" },
];

export const SKIPPED_REASON_LABELS: Record<
  DepreciationRunResult["skipped"][number]["reason"],
  string
> = {
  ALREADY_DONE: "قبلاً ثبت شده",
  NOT_ACQUIRED_YET: "پیش از تاریخ خرید",
  PREVIOUS_MONTH_MISSING: "ماه قبل ثبت نشده",
};

export function jalaliMonthLabel(month: number): string {
  return JALALI_MONTH_NAMES.find((item) => item.month === month)?.label ?? formatNumber(month);
}

export function formatAssetDate(isoDate?: string | null): string {
  return formatJalaliDate(isoDate);
}

export function formatAssetMoney(amount?: string | number | null): string {
  return formatMoneyRial(amount);
}

export function formatDepreciationRunSummary(result: DepreciationRunResult): string {
  const monthName = jalaliMonthLabel(result.month);
  const yearText = formatNumber(result.year);
  if (result.charged.length === 0) {
    return `برای ${monthName} ${yearText} استهلاکی ثبت نشد.`;
  }
  const vouchers = result.entryNumbers.length > 0 ? result.entryNumbers.join("، ") : "—";
  return `استهلاک ${monthName} ${yearText} برای ${formatNumber(result.charged.length)} دارایی به مبلغ ${formatMoneyRial(result.totalCharged)} ثبت شد (سند: ${vouchers}).`;
}

export function isValidJalaliPeriod(yearText: string, month: number): boolean {
  if (!/^\d{4}$/.test(yearText.trim())) return false;
  const year = Number(yearText);
  return Number.isInteger(year) && year >= 1300 && year <= 1600 && month >= 1 && month <= 12;
}
