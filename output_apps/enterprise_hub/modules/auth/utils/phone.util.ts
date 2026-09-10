import { IR_MOBILE_REGEX } from '../constants/auth.constants';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * نرمال‌سازی ورودی شماره همراه:
 *   • تبدیل ارقام فارسی/عربی به لاتین
 *   • حذف فاصله، خط تیره، پرانتز و پیشوند بین‌المللی +98/0098/98
 *
 * خروجی همیشه به شکل استاندارد `09xxxxxxxxx` بازگردانده می‌شود تا
 * اعتبارسنجی IR_MOBILE_REGEX و ارسال به کاوه‌نگار یکنواخت باشد.
 */
export function normalizeIranianMobile(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return '';
  }

  let value = String(raw).trim();

  value = value
    .split('')
    .map((char) => {
      const fa = PERSIAN_DIGITS.indexOf(char);
      if (fa > -1) {
        return String(fa);
      }
      const ar = ARABIC_DIGITS.indexOf(char);
      if (ar > -1) {
        return String(ar);
      }
      return char;
    })
    .join('');

  value = value.replace(/[\s\-()._]/g, '').replace(/^\+/, '');

  if (value.startsWith('0098')) {
    value = `0${value.slice(4)}`;
  } else if (value.startsWith('98') && value.length === 12) {
    value = `0${value.slice(2)}`;
  } else if (value.startsWith('9') && value.length === 10) {
    value = `0${value}`;
  }

  return IR_MOBILE_REGEX.test(value) ? value : value;
}
