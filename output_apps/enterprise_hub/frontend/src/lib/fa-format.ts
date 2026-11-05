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

/** Money in rials, or in the unit the viewer chose (see `formatAmount`). */
export function formatMoneyRial(value?: number | null, unit: MoneyUnit = "rial"): string {
  return formatAmount(value, unit);
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

/** How a rial amount is shown: in rials, in tomans (÷ 10) or in millions of rials. */
export type MoneyUnit = "rial" | "toman" | "million";

export const MONEY_UNITS: ReadonlyArray<{ unit: MoneyUnit; label: string }> = [
  { unit: "rial", label: "ریال" },
  { unit: "toman", label: "تومان" },
  { unit: "million", label: "میلیون ریال" },
];

export const UNIT_SUFFIX: Record<MoneyUnit, string> = { rial: "ریال", toman: "تومان", million: "میلیون ریال" };

/** Rials per display unit, and how many decimals of that unit are kept. */
const UNIT_STEP: Record<MoneyUnit, { divisor: bigint; decimals: number }> = {
  rial: { divisor: 1n, decimals: 0 },
  toman: { divisor: 10n, decimals: 1 },
  million: { divisor: 1_000_000n, decimals: 1 },
};

/** Tile abbreviations, largest first. */
const SCALES: ReadonlyArray<{ size: bigint; word: string }> = [
  { size: 1_000_000_000_000n, word: "هزار میلیارد" },
  { size: 1_000_000_000n, word: "میلیارد" },
  { size: 1_000_000n, word: "میلیون" },
];

function toPersianDigits(text: string): string {
  return text.replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

/**
 * Hundredths of a rial of a number or a decimal string, exact for strings beyond the safe number range.
 * Returns null for anything that is not a finite amount.
 */
function toCents(value: number | string | null | undefined): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return BigInt(Math.round(value * 100));
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const [, sign, integer, fraction = ""] = match;
  const cents = BigInt(integer) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, "0"));
  return sign === "-" ? -cents : cents;
}

/** `cents / divisor` rounded half away from zero to `decimals` places, as grouped Persian text. */
function scaled(abs: bigint, divisor: bigint, decimals: number, trim = true): string {
  const factor = 10n ** BigInt(decimals);
  const denominator = divisor * 100n;
  const units = (abs * factor * 2n + denominator) / (denominator * 2n);
  const integer = (units / factor).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
  const fraction = decimals > 0 ? (units % factor).toString().padStart(decimals, "0") : "";
  const shown = trim ? fraction.replace(/0+$/, "") : fraction;
  return toPersianDigits(shown ? `${integer}٫${shown}` : integer);
}

export interface AmountOptions {
  /** Short form for tiles, e.g. «۵۱٫۲ میلیارد ریال». Tables keep the full value. */
  abbreviate?: boolean;
  /** Append the unit word (default true). */
  suffix?: boolean;
  /** Accounting style: negatives in brackets instead of a minus sign. */
  brackets?: boolean;
}

/**
 * The one money formatter of the app. `value` is in rials (number or exact decimal string);
 * `unit` is the display unit the viewer chose. Missing or invalid values show «—».
 */
export function formatAmount(
  value: number | string | null | undefined,
  unit: MoneyUnit = "rial",
  options: AmountOptions = {},
): string {
  const cents = toCents(value);
  if (cents === null) return "—";
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const { suffix = true, brackets = false } = options;
  let text: string;
  let word = UNIT_SUFFIX[unit];
  if (options.abbreviate) {
    // Abbreviate in the base unit (rial or toman); «میلیون ریال» abbreviates like rials.
    const base = unit === "toman" ? 10n : 1n;
    word = unit === "toman" ? "تومان" : "ریال";
    const scale = SCALES.find((entry) => abs >= entry.size * base * 100n);
    text = scale ? `${scaled(abs, scale.size * base, 1)} ${scale.word}` : scaled(abs, base, 0);
  } else {
    const step = UNIT_STEP[unit];
    // Rials keep a real fraction (API decimals); other units round to their own step.
    text = unit === "rial" && abs % 100n !== 0n ? scaled(abs, 1n, 2, false) : scaled(abs, step.divisor, step.decimals);
  }
  const signed = negative ? (brackets ? `(${text})` : `−${text}`) : text;
  return suffix ? `${signed} ${word}` : signed;
}

/**
 * Report amount, exact for the decimal strings the API sends above the safe number range.
 * Accounting style: negatives in brackets, no unit word (the report header names the unit).
 */
export function formatReportMoney(
  value: number | string | null | undefined,
  unit: MoneyUnit = "rial",
): string {
  return formatAmount(value, unit, { suffix: false, brackets: true });
}

const NUMERIC_DATE_FMT = new Intl.DateTimeFormat("fa-IR-u-ca-persian");

/** Jalali date in numbers only, e.g. «۱۴۰۵/۸/۱۰». */
export function formatJalaliNumericDate(value?: string | number | Date | null): string {
  const date = toDate(value);
  return date ? NUMERIC_DATE_FMT.format(date) : "—";
}

/**
 * One money formatter for the whole app: rials and tomans with Persian digits,
 * any other ISO code in Latin digits. Missing or non-finite values show «—».
 */
export function formatMoney(
  value: number | null | undefined,
  currency = "IRR",
  unit: MoneyUnit = "rial",
): string {
  if (currency === "IRR") return formatAmount(value, unit);
  if (currency === "IRT") {
    // A toman document stays in tomans: the amount is converted to rials only to reuse the formatter.
    return formatAmount(typeof value === "number" ? value * 10 : value, "toman");
  }
  return formatLatinMoney(value, currency);
}
