const LATIN_DIGITS = '0123456789';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * Digits-only key for matching a phone number exactly: Persian/Arabic digits become Latin, every
 * other character is dropped. For Iran (`IR`) the country prefix is folded too, so +98 912 123
 * 4567, 0098 912 123 4567 and 0912 123 4567 are the same customer. Returns null when no digit is
 * left. Another country adds its own folding here without touching the callers.
 */
export function normalizePhone(raw: string | null | undefined, countryCode = 'IR'): string | null {
  if (!raw) {
    return null;
  }
  let digits = '';
  for (const char of raw) {
    const latin = LATIN_DIGITS.indexOf(char);
    const persian = PERSIAN_DIGITS.indexOf(char);
    const arabic = ARABIC_DIGITS.indexOf(char);
    if (latin >= 0) digits += char;
    else if (persian >= 0) digits += String(persian);
    else if (arabic >= 0) digits += String(arabic);
  }
  if (!digits) {
    return null;
  }
  if (countryCode.toUpperCase() === 'IR') {
    if (/^0098\d{10}$/.test(digits)) {
      digits = `0${digits.slice(4)}`;
    } else if (/^98\d{10}$/.test(digits)) {
      digits = `0${digits.slice(2)}`;
    }
  }
  return digits.slice(0, 24);
}
