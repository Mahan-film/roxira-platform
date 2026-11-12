const PERSIAN_ZERO = 0x06f0;
const ARABIC_ZERO = 0x0660;

/**
 * Parses a rial amount typed in the barcode builder into an integer digit string.
 * Persian/Arabic digits are converted, grouping separators (, ٬ space and a dot
 * followed by exactly 3 digits groups) are stripped. A fractional part is rejected
 * (rials are whole numbers) instead of being truncated. Returns undefined for blank
 * input and null for input that is not a valid whole-rial amount.
 */
export function parseRialsInput(raw: string): string | undefined | null {
  const text = raw
    .trim()
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - PERSIAN_ZERO))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - ARABIC_ZERO))
    .replace(/[,٬،\s ]/g, "");
  if (text === "") return undefined;
  // "12.500" is grouping; "12.5" / "12.50" is a fraction and is refused.
  const grouped = text.replace(/\.(?=\d{3}(\D|$))/g, "");
  if (!/^\d+$/.test(grouped)) return null;
  const digits = grouped.replace(/^0+(?!$)/, "");
  return digits.length > 18 ? null : digits;
}
