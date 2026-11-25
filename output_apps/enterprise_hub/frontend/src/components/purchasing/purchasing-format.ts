import { formatMoneyRial } from "../../lib/fa-format.ts";

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

function toPersianDigits(ascii: string): string {
  return ascii.replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

function normalizeAsciiDigits(raw: string): string {
  return raw
    .trim()
    .replace(/[۰-۹]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/٫/g, ".")
    .replace(/,/g, "");
}

/**
 * Parse a decimal string into a scaled non-negative bigint (e.g. scaleDecimals=2 for hundredths or rials->minor).
 * Returns null if the input is empty or invalid.
 */
export function parseDecimalToScaledBigInt(raw: string, scaleDecimals: number): bigint | null {
  const normalized = normalizeAsciiDigits(raw);
  if (!normalized) return null;
  const match = /^(\d+)(?:\.(\d*))?$/.exec(normalized);
  if (!match) return null;
  const whole = match[1];
  const frac = (match[2] ?? "").slice(0, scaleDecimals).padEnd(scaleDecimals, "0");
  return BigInt(whole + frac);
}

/**
 * Convert a scaled bigint into an ASCII decimal string suitable for form inputs.
 */
export function scaledBigIntToDecimalString(val: bigint, scaleDecimals: number): string {
  const neg = val < 0n ? "-" : "";
  const abs = val < 0n ? -val : val;
  const scale = 10n ** BigInt(scaleDecimals);
  const whole = abs / scale;
  const frac = abs % scale;
  if (frac === 0n || scaleDecimals === 0) return `${neg}${whole}`;
  const fracTrimmed = frac.toString().padStart(scaleDecimals, "0").replace(/0+$/, "");
  return `${neg}${whole}.${fracTrimmed}`;
}

/**
 * Format a scaled bigint (e.g. hundredths or thousandths) into Persian numerals without Number() precision loss.
 */
export function formatScaledBigInt(
  raw: string | number | bigint | null | undefined,
  scaleDecimals: number,
): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  try {
    const val = BigInt(raw);
    const neg = val < 0n ? "−" : "";
    const abs = val < 0n ? -val : val;
    const scale = 10n ** BigInt(scaleDecimals);
    const whole = abs / scale;
    const frac = abs % scale;
    const wholeFa = whole.toLocaleString("fa-IR");
    if (frac === 0n || scaleDecimals === 0) return `${neg}${wholeFa}`;
    const fracTrimmed = frac.toString().padStart(scaleDecimals, "0").replace(/0+$/, "");
    return `${neg}${wholeFa}٫${toPersianDigits(fracTrimmed)}`;
  } catch {
    return "—";
  }
}

/**
 * Format bigint minor units (rials x 100) using the shared money formatter.
 */
export function formatMinorMoney(minor?: string | number | bigint | null): string {
  if (minor === null || minor === undefined || minor === "") return "—";
  try {
    return formatMoneyRial(BigInt(minor));
  } catch {
    return "—";
  }
}

/**
 * Format quantity in hundredths ("1000" = 10.00).
 */
export function formatQuantity(hundredths?: string | number | bigint | null): string {
  return formatScaledBigInt(hundredths, 2);
}

/**
 * Format weight in thousandths of kg ("500" = 0.500 kg).
 */
export function formatWeight(weightThousandths?: string | number | bigint | null): string {
  const formatted = formatScaledBigInt(weightThousandths, 3);
  return formatted === "—" ? "—" : `${formatted} کیلوگرم`;
}
