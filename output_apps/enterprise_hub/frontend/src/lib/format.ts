/**
 * Legacy names kept for existing imports. Everything delegates to `fa-format`,
 * the single place that decides how numbers, money and Jalali dates look.
 */
import { formatJalaliNumericDate, formatMoneyRial } from "@/lib/fa-format";

export function formatRial(amount: number): string {
  return formatMoneyRial(amount);
}

export function formatPersianDate(isoDate?: string | null): string {
  return formatJalaliNumericDate(isoDate);
}
