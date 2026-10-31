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

const GREGORIAN_DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const LATIN_NUMBER_FMT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

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

/**
 * Gregorian date in Latin digits, e.g. «22/10/2026» — for international invoices.
 */
export function formatGregorianDate(
  value?: string | number | Date | null,
): string {
  const date = toDate(value);
  return date ? GREGORIAN_DATE_FMT.format(date) : "—";
}

/**
 * Foreign-currency money with Latin digits and the ISO code, e.g. «1,250.00 EUR».
 */
export function formatLatinMoney(
  value: number | null | undefined,
  currency: string,
): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${LATIN_NUMBER_FMT.format(value)} ${currency}`
    : "—";
}

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/**
 * Report amount, exact for the decimal strings the API sends above the safe number range.
 * Accounting style: negatives in brackets. Works on text, so nothing passes through a float.
 */
export function formatReportMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const text = String(value);
  const negative = text.startsWith("-");
  const [integer, fraction] = text.replace("-", "").split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
  const kept = fraction && !/^0+$/.test(fraction) ? `${grouped}٫${fraction.padEnd(2, "0")}` : grouped;
  const persian = kept.replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
  return negative ? `(${persian})` : persian;
}
