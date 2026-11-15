/**
 * Semantic end-of-turn check for Persian phone speech.
 *
 * The energy VAD only knows "600 ms of silence". People pause mid-sentence ("سلام، من یه سوال
 * داشتم در مورد ... [pause] ... مهریه"), so the transcript decides whether to answer now or hold
 * a little longer. Cheap, local, no extra API call.
 */

// A turn that ends on one of these words is almost never finished.
const TRAILING = new Set([
  'و', 'که', 'یا', 'ولی', 'اما', 'اگر', 'اگه', 'چون', 'تا', 'برای', 'واسه', 'به', 'از', 'با', 'در',
  'تو', 'توی', 'روی', 'رو', 'را', 'این', 'اون', 'آن', 'یه', 'یک', 'هم', 'مثلاً', 'مثلا', 'یعنی',
  'بعد', 'اینکه', 'اینه', 'درباره', 'مورد', 'راجع', 'بین', 'بدون', 'طبق', 'خب', 'ببینید',
  'ببین', 'آقا', 'خانم', 'چطور', 'وقتی', 'زمانی', 'حالا', 'سلام',
]);
// short replies that are complete on their own
const CLOSERS = new Set(['ممنون', 'ممنونم', 'مرسی', 'متشکرم', 'سپاس', 'خداحافظ', 'خدانگهدار', 'بله', 'نه', 'خیر',
  'باشه', 'درسته', 'شدم']);
const FILLERS =/(^|\s)(ا+م+|ا+و+م+|ه+م+|آ+|ااا+)[\s.،…]*$/;

export function words(text: string): string[] {
  return text.replace(/[.،,!؟?…:;«»"()-]/g, ' ').split(/\s+/).filter(Boolean);
}

/** true when the caller most likely has more to say. */
export function looksIncomplete(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[؟?]\s*$/.test(t)) return false; // a question mark is a finished question
  if (/(،|,|…|\.\.\.)\s*$/.test(t)) return true; // Whisper ends mid-thought with a comma/ellipsis
  if (FILLERS.test(t)) return true;
  const w = words(t);
  if (w.length <= 2) return !w.some((x) => CLOSERS.has(x)); // "سلام" / "یه سوال" - wait for the rest; "ممنون" is done
  return TRAILING.has(w[w.length - 1]);
}
