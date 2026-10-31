/**
 * پنهان‌سازی مقدار سلول‌ها پیش از هر فراخوانی LLM.
 *
 * فقط «شکل» داده به مدل می‌رسد: رقم → 9، حرف لاتین → x، حرف فارسی → ا. ایمیل، تلفن، کد ملی، شماره
 * حساب/شبا و هر رشتهٔ طولانی شبیه شناسه کاملاً پوشانده می‌شود. نام ستون‌ها (که برای نگاشت لازم‌اند)
 * عوض نمی‌شوند. مسیر مدل (رایگان‌اول، رجیستری) در `openrouter-mapping.service.ts` می‌ماند.
 */

import { fixPersianChars, toAsciiDigits } from './normaliser/normalise';

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const LONG_ID = /\b[\w-]{12,}\b/g;

export function maskValue(value: unknown): string {
  const text = fixPersianChars(toAsciiDigits(value === null || value === undefined ? '' : String(value)));
  if (text === '') return '';
  const redacted = text.replace(EMAIL, '\uE000').replace(LONG_ID, '\uE001');
  return redacted
    .replace(/\d/g, '9')
    .replace(/[A-Za-z]/g, 'x')
    .replace(/[\u0621-\u064a\u0671-\u06d3]/g, 'ا')
    .replace(/\uE000/g, '<email>')
    .replace(/\uE001/g, '<id>');
}

export function maskRows(rows: string[][]): string[][] {
  return rows.map((row) => row.map(maskValue));
}
