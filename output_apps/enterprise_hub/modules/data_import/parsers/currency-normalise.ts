/**
 * نرمال‌سازی واحد پول در بستهٔ دیتابیس.
 *
 * چالش دیتابیس مشتری: نام‌های فارسی («ریال»، «تومان»، «درهم») و کدهای ISO
 * (USD/EUR/…) و همچنین نشانگر `MULTI` برای حساب چندارزی. این تابع همه را به
 * یک کد کانونیک تبدیل می‌کند و ناشناخته‌ها را `null` برمی‌گرداند.
 */

import { fixPersianChars, toAsciiDigits } from '../normaliser/normalise';

/** نگاشت نام/نماد ارز به کد کانونیک. */
const CURRENCY_ALIASES: Record<string, string> = {
  ریال: 'IRR',
  ریالایران: 'IRR',
  تومان: 'IRT',
  تومانایران: 'IRT',
  دلار: 'USD',
  دلارامریکا: 'USD',
  '$': 'USD',
  یورو: 'EUR',
  '€': 'EUR',
  لیر: 'TRY',
  لیرترکیه: 'TRY',
  '₺': 'TRY',
  درهم: 'AED',
  'درهمامارات': 'AED',
  ریالعمان: 'OMR',
  'ریال عمان': 'OMR',
  یوان: 'CNY',
  رنمینبی: 'CNY',
  '￥': 'CNY',
  multi: 'MULTI',
  چندارزی: 'MULTI',
  چندارزه: 'MULTI',
};

const KNOWN_ISO = new Set(['USD', 'EUR', 'AED', 'IRR', 'IRT', 'TRY', 'OMR', 'CNY']);

/** نرمال‌سازی یک مقدار ارز خام به کد کانونیک (یا `null`). */
export function normaliseCurrency(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const fixed = fixPersianChars(toAsciiDigits(String(raw))).trim();
  if (!fixed) {
    return null;
  }
  const compact = fixed.replace(/\s+/g, '').toUpperCase();
  if (!compact) {
    return null;
  }

  const alias =
    CURRENCY_ALIASES[compact] ??
    CURRENCY_ALIASES[compact.replace(/[^\p{L}\p{N}$€₺￥]/gu, '')];
  if (alias) {
    return alias;
  }

  if (compact === 'MULTI') {
    return 'MULTI';
  }

  if (KNOWN_ISO.has(compact)) {
    return compact;
  }

  return null;
}

/** تشخیص ستون‌هایی که ماهیت ارزی دارند (نام‌محور، بدون ستون‌های مبلغ). */
export function looksLikeCurrencyColumn(name: string): boolean {
  const key = name.toLowerCase();
  // Boolean flags such as IsForeignCurrencyAccount / HasCurrency hold 0/1, not a currency.
  if (/^(is|has)[_a-z]/.test(key)) {
    return false;
  }
  const isAmount = /(gheymat|mablagh|nerkh|price|amount|rial|toman|dolar|dollar|euro)/i.test(
    key,
  );
  if (isAmount) {
    return false;
  }
  return /(currency|vahedpool|vahed_pool|arz)/i.test(key);
}
