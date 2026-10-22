import { ImportFieldDefinition } from '../registry/import-registry.types';

/**
 * نرمال‌سازی مقادیر ورودی پیش از اعتبارسنجی و درج.
 *
 * قواعد سخت (قرارداد مشترک فاز ۱):
 * - رقم‌های فارسی/عربی → ASCII.
 * - ي/ك عربی → ی/ک فارسی.
 * - تاریخ جلالی (`1403/07/15` یا `۱۴۰۳-۷-۱۵`) → تاریخ ISO میلادی.
 * - مبلغ «۱۲٬۵۰۰٬۰۰۰ ریال»/«... تومان» → عدد صحیح ریال (تومان × ۱۰).
 *
 * تبدیل جلالی از الگوریتم شناخته‌شده و تست‌شده jalaali-js الهام گرفته شده و
 * به‌صورت درون‌ساز پیاده شده است تا هیچ کتابخانه سنگین جدیدی به وابستگی‌ها
 * اضافه نشود.
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** تبدیل رقم‌های فارسی/عربی به ASCII (بقیه نویسه‌ها بدون تغییر). */
export function toAsciiDigits(value: string): string {
  let result = '';
  for (const char of value) {
    const persianIndex = PERSIAN_DIGITS.indexOf(char);
    if (persianIndex !== -1) {
      result += String(persianIndex);
      continue;
    }
    const arabicIndex = ARABIC_DIGITS.indexOf(char);
    if (arabicIndex !== -1) {
      result += String(arabicIndex);
      continue;
    }
    result += char;
  }
  return result;
}

/** یکسان‌سازی نویسه‌های عربی ي/ك/ة/ى با معادل فارسی. */
export function fixPersianChars(value: string): string {
  return value
    .replace(/\u064a/g, '\u06cc') // ي عربی → ی فارسی
    .replace(/\u0643/g, '\u06a9') // ك عربی → ک فارسی
    .replace(/\u0629/g, '\u0647') // ة → ه
    .replace(/\u0649/g, '\u06cc'); // ى → ی
}

/** نرمال‌سازی یک متن: رقم/حرف فارسی‌سازی و یکسان‌سازی فاصله‌ها. */
export function normaliseText(value: string): string {
  return fixPersianChars(toAsciiDigits(value))
    .replace(/[\u200c\u200e\u200f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** کلید تطبیق مترادف‌ها: بدون فاصله و با حروف کوچک. */
export function normaliseKey(value: string): string {
  return normaliseText(value).toLowerCase().replace(/\s+/g, '');
}

/** نرمال‌سازی رایانامه (کوچک و بدون فاصله اضافی). */
export function normaliseEmail(value: string): string {
  return fixPersianChars(toAsciiDigits(value)).trim().toLowerCase();
}

/** نرمال‌سازی شماره تلفن/همراه به رقم خالص با پیشوند + اختیاری. */
export function normalisePhone(value: string): string | null {
  const digits = toAsciiDigits(value).replace(/[^\d+]/g, '');
  if (!digits || digits === '+') {
    return null;
  }
  return digits;
}

/** نرمال‌سازی کد ملی به رقم‌های ASCII. */
export function normaliseNationalId(value: string): string | null {
  const digits = toAsciiDigits(value).replace(/\D/g, '');
  return digits || null;
}

/** تبدیل عدد فارسی/عربی با جداکننده هزار و ممیز به number. */
export function parseNumber(value: string): number | null {
  const cleaned = toAsciiDigits(fixPersianChars(value))
    .replace(/[٬,\s]/g, '')
    .replace(/٫/g, '.');
  if (!cleaned) {
    return null;
  }
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * تبدیل مبلغ («۱۲٬۵۰۰٬۰۰۰ ریال» یا «۲٬۵۰۰٬۰۰۰ تومان») به عدد صحیح ریال.
 * تومان با ضریب ۱۰ به ریال تبدیل می‌شود.
 */
export function parseMoneyRials(value: string): number | null {
  const fixed = fixPersianChars(toAsciiDigits(value)).trim();
  if (!fixed) {
    return null;
  }
  const isToman = /تومان/.test(fixed);
  const isRial = /ریال/.test(fixed);
  const numeric = fixed.replace(/[^\d.\-]/g, '');
  if (!numeric || numeric === '-' || numeric === '.') {
    return null;
  }
  const amount = Number(numeric);
  if (!Number.isFinite(amount)) {
    return null;
  }
  const rials = isToman && !isRial ? amount * 10 : amount;
  return Math.round(rials);
}

/* ------------------------------ تبدیل جلالی ------------------------------- */

/** تقسیم صحیح به سمت صفر (معادل `~~` در jalaali-js). */
function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** باقی‌مانده مثبت‌نما مطابق روش jalaali-js. */
function mod(a: number, b: number): number {
  return a - Math.trunc(a / b) * b;
}

/** جدول شکست‌های تقویم جلالی (jalaali-js). */
const JALALI_BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097,
  2192, 2262, 2324, 2394, 2456, 3178,
];

interface JalCalResult {
  leap: number;
  gy: number;
  march: number;
}

/** محاسبه سال مبدأ/کبیسه تقویم جلالی (الگوریتم jalaali-js). */
function jalCal(jy: number, withoutLeap = false): JalCalResult {
  const bl = JALALI_BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = JALALI_BREAKS[0];
  let jump = 0;

  for (let i = 1; i < bl; i += 1) {
    const jm = JALALI_BREAKS[i];
    jump = jm - jp;
    if (jy < jm) {
      break;
    }
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }

  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) {
    leapJ += 1;
  }

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  let leap = 0;
  if (!withoutLeap) {
    if (jump - n < 6) {
      n = n - jump + div(jump + 4, 33) * 33;
    }
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) {
      leap = 4;
    }
  }

  return { leap, gy, march };
}

/** تبدیل تاریخ میلادی به شماره روز جولیَن. */
function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

/** تبدیل شماره روز جولیَن به تاریخ میلادی. */
function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

/** شماره روز جولیَن متناظر با تاریخ جلالی. */
function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy, true);
  return (
    g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1
  );
}

/** آیا سال جلالی کبیسه است؟ */
function isLeapJalaliYear(jy: number): boolean {
  return jalCal(jy, false).leap === 0;
}

/** طول یک ماه جلالی. */
function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) {
    return 31;
  }
  if (jm <= 11) {
    return 30;
  }
  return isLeapJalaliYear(jy) ? 30 : 29;
}

/** تبدیل تاریخ جلالی به میلادی. */
export function jalaliToGregorian(
  jy: number,
  jm: number,
  jd: number,
): { gy: number; gm: number; gd: number } {
  return d2g(j2d(jy, jm, jd));
}

/** قالب‌بندی تاریخ به `YYYY-MM-DD`. */
function formatIso(gy: number, gm: number, gd: number): string {
  return `${String(gy).padStart(4, '0')}-${String(gm).padStart(2, '0')}-${String(
    gd,
  ).padStart(2, '0')}`;
}

/**
 * تجزیه تاریخ جلالی یا میلادی به ISO میلادی (`YYYY-MM-DD`).
 *
 * ورودی‌های پذیرفته‌شده: `1403/07/15`، `۱۴۰۳-۷-۱۵`، `1403-7-15` و تاریخ‌های
 * میلادی `2024-10-06` یا ISO کامل. در صورت نامعتبر بودن `null` برمی‌گردد.
 */
export function parseJalaliDate(value: string): string | null {
  const fixed = toAsciiDigits(fixPersianChars(value)).trim();
  if (!fixed) {
    return null;
  }

  const match = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:[T\s].*)?$/.exec(fixed);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return null;
  }

  // تاریخ میلادی (پیش از قرن بیستم) بدون تبدیل بازگردانده می‌شود.
  if (year >= 1900) {
    if (day > 31) {
      return null;
    }
    return formatIso(year, month, day);
  }

  if (year < 1200 || year > 1600) {
    return null;
  }
  if (day > jalaliMonthLength(year, month)) {
    return null;
  }

  const gregorian = jalaliToGregorian(year, month, day);
  return formatIso(gregorian.gy, gregorian.gm, gregorian.gd);
}

/* ---------------------------- نگاشت نوع فیلد ----------------------------- */

/** نرمال‌سازی مقدار خام یک ستون بر پایه نوع فیلد. */
export function normaliseFieldValue(
  value: string,
  field: ImportFieldDefinition,
): unknown {
  switch (field.type) {
    case 'money':
      return parseMoneyRials(value);
    case 'date':
      return parseJalaliDate(value);
    case 'phone':
      return normalisePhone(value);
    case 'email':
      return normaliseEmail(value);
    case 'national_id':
      return normaliseNationalId(value);
    case 'number':
      return parseNumber(value);
    case 'enum':
      return normaliseEnumValue(value, field);
    default:
      return normaliseText(value);
  }
}

/** نگاشت مقدار enum با مترادف‌ها و مقادیر کانونی. */
export function normaliseEnumValue(
  value: string,
  field: ImportFieldDefinition,
): string {
  const fixed = normaliseText(value);
  const aliases = field.enumAliases ?? {};
  const aliasByKey = new Map<string, string>();
  for (const [alias, canonical] of Object.entries(aliases)) {
    aliasByKey.set(normaliseKey(alias), canonical);
  }

  const alias = aliasByKey.get(normaliseKey(fixed));
  if (alias) {
    return alias;
  }

  const upper = fixed.toUpperCase();
  if (field.enumValues?.includes(upper)) {
    return upper;
  }
  return fixed;
}
