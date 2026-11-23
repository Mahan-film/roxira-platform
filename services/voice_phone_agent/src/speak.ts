/**
 * Phone-only shaping of Smart Judge text before it is read aloud (T250). Deterministic, and it never
 * touches legal content: article, ruling and law numbers, names and wording stay as the brain wrote them.
 * It only changes how a written answer sounds on the line:
 * - Jalali dates written as 1405/07/21 are read as «21 مهر 1405» (a caller cannot follow digit groups);
 * - written-answer labels at the start of a sentence («پاسخ کوتاه:», «خلاصه پاسخ:») are dropped;
 * - «ارسال‌شده در این پیام» (the server's retrieval wording) becomes «موجود در منابع من»: a caller sent no message.
 *   Only that phrase: a bare «در این پیام» can be the case itself (a threat by SMS) and is left alone.
 */

const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const D = '[0-9۰-۹٠-٩]';

function latinDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
}

// year 13xx/14xx, then month and day; not part of a longer number
const DATE_RE = new RegExp(`(?<!${D}|/)([1۱١][34۳۴٣٤]${D}{2})\\s?[/\\-]\\s?(${D}{1,2})\\s?[/\\-]\\s?(${D}{1,2})(?!${D}|/)`, 'g');

export function speakDates(t: string): string {
  return t.replace(DATE_RE, (all, y: string, m: string, d: string) => {
    const mi = Number(latinDigits(m));
    const di = Number(latinDigits(d));
    if (mi < 1 || mi > 12 || di < 1 || di > 31) return all;
    return `${di} ${MONTHS[mi - 1]} ${latinDigits(y)}`;
  });
}

const LABEL_RE = /^\s*(?:پاسخ(?:\s(?:کوتاه|مستقیم|کلی))?|خلاصه(?:\sپاسخ)?|نتیجه(?:\sگیری|‌گیری)?)\s*[:：]\s*/;

const MESSAGE_RE = /ارسال[\u200c\s]?شده\s(?:در\s)?(?:این|همین)\sپیام/g;

/** One sentence as it should be spoken on the phone. */
export function speakable(sentence: string): string {
  let s = sentence.replace(LABEL_RE, '');
  s = s.replace(MESSAGE_RE, 'موجود در منابع من');
  return speakDates(s).replace(/\s+/g, ' ').trim();
}
