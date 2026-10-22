/**
 * Persian display helpers for the logged-in suite (/app).
 * Dates are Jalali via Intl (no extra dependency), numbers use Persian digits.
 */

const DATE_FMT = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const DATE_TIME_FMT = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const NUMBER_FMT = new Intl.NumberFormat("fa-IR");

function toDate(value?: string | number | Date | null): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Jalali date, e.g. «۱۴ آبان ۱۴۰۵». */
export function formatJalaliDate(value?: string | number | Date | null): string {
  const date = toDate(value);
  return date ? DATE_FMT.format(date) : "—";
}

/** Jalali date and time. */
export function formatJalaliDateTime(
  value?: string | number | Date | null,
): string {
  const date = toDate(value);
  return date ? DATE_TIME_FMT.format(date) : "—";
}

/** Plain number with Persian digits and thousand separators. */
export function formatNumber(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? NUMBER_FMT.format(value)
    : "—";
}

/** Money in rials with thousand separators. */
export function formatMoneyRial(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${NUMBER_FMT.format(value)} ریال`
    : "—";
}
