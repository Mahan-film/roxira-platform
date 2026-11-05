import { integerToPersianWords } from "./persian-words.ts";

export const MAX_MONEY_DIGITS = 18;

const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

function toAsciiDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function toPersianDigits(value: string): string {
  return value.replace(/\d/g, (d) => PERSIAN[Number(d)]);
}

export function normalizeMoneyDigits(raw: string): string {
  const digits = toAsciiDigits(raw).replace(/[^\d]/g, "");
  const trimmed = digits.replace(/^0+(?!$)/, "");
  return trimmed.length > MAX_MONEY_DIGITS ? trimmed.slice(0, MAX_MONEY_DIGITS) : trimmed;
}

export function appendZeros(digits: string, count: 3 | 4): string {
  if (digits === "" || digits === "0") return digits;
  const result = digits + "0".repeat(count);
  return result.length <= MAX_MONEY_DIGITS ? result : digits;
}

export function formatGroupedRials(digits: string): string {
  if (digits === "") return "";
  return toPersianDigits(digits.replace(/\B(?=(\d{3})+$)/g, "٬"));
}

export function rialsToToman(digits: string): string {
  if (digits === "") return "";
  const amount = BigInt(digits);
  const toman = amount / BigInt(10);
  const remainder = amount % BigInt(10);
  const tomanText = formatGroupedRials(toman.toString());
  return remainder === BigInt(0) ? tomanText : `${tomanText}٫${toPersianDigits(remainder.toString())}`;
}

export function describeRials(digits: string): { toman: string; words: string } | null {
  if (digits === "") return null;
  const toman = rialsToToman(digits);
  const words = integerToPersianWords(digits);
  return {
    toman: `${toman} تومان`,
    words: `${words} ریال`,
  };
}

export function applyMoneyEdit(
  rawText: string,
  caret: number,
): { digits: string; text: string; caret: number } {
  const digits = normalizeMoneyDigits(rawText);
  const text = formatGroupedRials(digits);
  // Count the digits left of the caret in the raw text (leading zeros included), clamp to what survived.
  const leftDigits = Math.min(toAsciiDigits(rawText.slice(0, caret)).replace(/\D/g, "").length, digits.length);
  if (leftDigits <= 0) return { digits, text, caret: 0 };
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (PERSIAN.includes(text[i])) seen += 1;
    if (seen === leftDigits) return { digits, text, caret: i + 1 };
  }
  return { digits, text, caret: text.length };
}
