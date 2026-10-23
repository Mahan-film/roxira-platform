/**
 * شماره منحصربه‌فرد مالیاتی (taxid) صورتحساب در سامانه مودیان — ۲۲ کاراکتر.
 *
 * ساختار (docs/research/MOADIAN_REQUIREMENTS_2026-10-14.md §8.6):
 *   memoryId (6) + hex(daysSinceEpoch) (5) + hex(serial) (10) + Verhoeff (1)
 *
 * رقم کنترلی Verhoeff روی رشتهٔ «دهدهی» محاسبه می‌شود:
 *   memoryIdDigits + pad(daysSinceEpoch, 6) + pad(serial, 12)
 * که در آن هر حرف شناسه حافظه با کد ASCII خودش جایگزین می‌شود.
 *
 * daysSinceEpoch = floor(indatim / 86_400_000) — روز UTC از 1970-01-01.
 */

const VERHOEFF_D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const VERHOEFF_INV: readonly number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

const MS_PER_DAY = 86_400_000;
const MEMORY_ID_PATTERN = /^[A-Z0-9]{6}$/;
/** بیشینهٔ سریال داخلی که در ۱۰ رقم هگز جا می‌شود. */
export const MOADIAN_MAX_SERIAL = 0xff_ffff_ffff;

function assertDigits(text: string): void {
  if (!/^\d+$/.test(text)) {
    throw new Error('Verhoeff input must contain only decimal digits');
  }
}

/** رقم کنترلی Verhoeff برای یک رشتهٔ دهدهی. */
export function verhoeffCheckDigit(numeric: string): number {
  assertDigits(numeric);
  let c = 0;
  const len = numeric.length;
  for (let i = 0; i < len; i++) {
    const digit = numeric.charCodeAt(len - i - 1) - 48;
    c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][digit]];
  }
  return VERHOEFF_INV[c];
}

/** اعتبارسنجی رشته‌ای که آخرین رقمش رقم کنترلی Verhoeff است. */
export function verhoeffValidate(numericWithCheck: string): boolean {
  assertDigits(numericWithCheck);
  let c = 0;
  const len = numericWithCheck.length;
  for (let i = 0; i < len; i++) {
    const digit = numericWithCheck.charCodeAt(len - i - 1) - 48;
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digit]];
  }
  return c === 0;
}

/** جایگزینی هر حرف شناسه حافظه با کد ASCII دهدهی آن. */
export function memoryIdToDecimal(memoryId: string): string {
  let out = '';
  for (const ch of memoryId) {
    out += /\d/.test(ch) ? ch : String(ch.charCodeAt(0));
  }
  return out;
}

export function normalizeMemoryId(memoryId: string): string {
  const normalized = (memoryId ?? '').trim().toUpperCase();
  if (!MEMORY_ID_PATTERN.test(normalized)) {
    throw new Error('Moadian memory id must be exactly 6 letters/digits');
  }
  return normalized;
}

/**
 * تولید شماره منحصربه‌فرد مالیاتی ۲۲ کاراکتری.
 *
 * @param memoryId شناسه یکتای حافظه مالیاتی (۶ کاراکتر، از کارپوشه)
 * @param indatim زمان صدور صورتحساب (میلی‌ثانیه از epoch)
 * @param serial سریال داخلی صورتحساب (عدد صحیح نامنفی ≤ 0xFFFFFFFFFF)
 */
export function generateMoadianTaxId(
  memoryId: string,
  indatim: number,
  serial: number,
): string {
  const id = normalizeMemoryId(memoryId);
  if (!Number.isFinite(indatim) || indatim < 0) {
    throw new Error('indatim must be a non-negative epoch millisecond value');
  }
  if (!Number.isSafeInteger(serial) || serial < 0 || serial > MOADIAN_MAX_SERIAL) {
    throw new Error('Moadian serial must be an integer in [0, 0xFFFFFFFFFF]');
  }
  const days = Math.floor(indatim / MS_PER_DAY);
  const control =
    memoryIdToDecimal(id) +
    String(days).padStart(6, '0') +
    String(serial).padStart(12, '0');
  const check = verhoeffCheckDigit(control);
  return (
    id +
    days.toString(16).padStart(5, '0') +
    serial.toString(16).padStart(10, '0') +
    String(check)
  ).toUpperCase();
}

/** بررسی ساختار و رقم کنترلی یک taxid. */
export function isValidMoadianTaxId(taxId: string): boolean {
  if (!/^[A-Z0-9]{6}[0-9A-F]{15}\d$/.test(taxId)) {
    return false;
  }
  const memoryId = taxId.slice(0, 6);
  const days = parseInt(taxId.slice(6, 11), 16);
  const serial = parseInt(taxId.slice(11, 21), 16);
  const control =
    memoryIdToDecimal(memoryId) +
    String(days).padStart(6, '0') +
    String(serial).padStart(12, '0');
  return verhoeffCheckDigit(control) === Number(taxId[21]);
}
