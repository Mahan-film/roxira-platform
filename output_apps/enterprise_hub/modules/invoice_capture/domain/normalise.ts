import {
  fixPersianChars,
  parseJalaliDate,
  toAsciiDigits,
} from '../../data_import/normaliser/normalise';
import { minorToDecimal, parseMinor } from '../../accounting/money';
import { CAPTURE_MAX_FIELD_CHARS } from '../constants/capture.constants';

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g;

/** Bounded single-line text without control or bidi-override characters. */
export function cleanText(value: unknown, max = CAPTURE_MAX_FIELD_CHARS): string {
  if (value === null || value === undefined) {
    return '';
  }
  return fixPersianChars(String(value))
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Currency names used on Iranian documents -> ISO-ish code. `IRT` means toman. */
export function normaliseCurrencyCode(raw: unknown): string {
  const text = cleanText(raw, 40).toLowerCase();
  if (!text) {
    return 'IRR';
  }
  if (/(irt|toman|تومان|تومن)/.test(text)) {
    return 'IRT';
  }
  if (/(irr|rial|ریال|ریالی)/.test(text)) {
    return 'IRR';
  }
  if (/(usd|\$|dollar|دلار)/.test(text)) {
    return 'USD';
  }
  if (/(eur|€|euro|یورو)/.test(text)) {
    return 'EUR';
  }
  if (/(aed|درهم)/.test(text)) {
    return 'AED';
  }
  const iso = text.toUpperCase().replace(/[^A-Z]/g, '');
  return /^[A-Z]{3}$/.test(iso) ? iso : 'IRR';
}

/**
 * Exact minor units (scale 2) of an amount written in Persian/Arabic/Latin digits with any of the
 * usual thousands separators. Returns null when the text is not a plain non-negative amount.
 */
export function parseAmountMinor(raw: unknown): bigint | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0 || raw > Number.MAX_SAFE_INTEGER / 100) {
      return null;
    }
    return BigInt(Math.round(raw * 100));
  }
  let text = toAsciiDigits(String(raw))
    .replace(/[٬،,\s_']/g, '')
    .replace(/٫/g, '.')
    .replace(/(ریال|تومان|تومن|rials?|irr|irt|toman)/gi, '');
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(text)) {
    text = text.replace(/\.0+$/, '');
    if (!/^\d{1,16}(\.\d{1,2})?$/.test(text)) {
      return null;
    }
  }
  try {
    return parseMinor(text);
  } catch {
    return null;
  }
}

export function minorToString(minor: bigint): string {
  return minorToDecimal(minor);
}

/** Quantity as thousandths (exact), or null. */
export function parseQuantityMilli(raw: unknown): bigint | null {
  const text = toAsciiDigits(String(raw ?? '')).replace(/[٬,\s]/g, '').replace(/٫/g, '.');
  const match = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(text);
  if (!match) {
    return null;
  }
  return BigInt(match[1]) * 1000n + BigInt((match[2] ?? '').padEnd(3, '0'));
}

export function milliToString(milli: bigint): string {
  const whole = milli / 1000n;
  const frac = (milli % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** ISO Gregorian day from a Jalali or Gregorian date as written on the document, else null. */
export function normaliseDate(raw: unknown): string | null {
  const text = cleanText(raw, 40);
  if (!text) {
    return null;
  }
  const iso = parseJalaliDate(text);
  if (!iso) {
    return null;
  }
  const probe = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== iso
    ? null
    : iso;
}

/** Digits of a national / legal / economic id (Persian digits accepted); '' when none. */
export function normaliseTaxId(raw: unknown): string {
  return toAsciiDigits(String(raw ?? '')).replace(/\D/g, '').slice(0, 14);
}

/**
 * Checksum of Iranian ids: 10-digit national code, 11-digit legal-entity id. 12/14-digit economic
 * codes have no public checksum, so they are only length-checked. Returns null when unknowable.
 */
export function taxIdLooksValid(id: string): boolean | null {
  if (/^\d{10}$/.test(id)) {
    if (/^(\d)\1{9}$/.test(id)) {
      return false;
    }
    const digits = id.split('').map(Number);
    const sum = digits.slice(0, 9).reduce((acc, d, i) => acc + d * (10 - i), 0);
    const r = sum % 11;
    return digits[9] === (r < 2 ? r : 11 - r);
  }
  if (/^\d{11}$/.test(id)) {
    const d = id.split('').map(Number);
    const k = d[9] + 2;
    const coef = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17];
    const sum = coef.reduce((acc, c, i) => acc + (d[i] + k) * c, 0);
    let r = sum % 11;
    if (r === 10) {
      r = 0;
    }
    return r === d[10];
  }
  if (/^\d{12}$|^\d{14}$/.test(id)) {
    return null;
  }
  return id === '' ? null : false;
}

/** Name normalised for vendor matching: letters/digits only, so ZWNJ/space/punctuation OCR noise does not split a vendor. */
export function normaliseName(value: string): string {
  return cleanText(value, 120)
    .toLowerCase()
    .replace(/[‌\s]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim();
}

/** Multiplies minor units by a decimal rate string (scale <= 6), rounding half up. */
export function convertMinor(minor: bigint, rate: string): bigint {
  const match = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(toAsciiDigits(rate).trim());
  if (!match) {
    throw new Error('Invalid exchange rate');
  }
  const scaled = BigInt(match[1] + (match[2] ?? '').padEnd(6, '0'));
  return (minor * scaled + 500_000n) / 1_000_000n;
}
