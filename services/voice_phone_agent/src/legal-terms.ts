/**
 * Persian legal vocabulary for the phone STT, and a small post-STT repair for misrecognitions
 * seen on real calls.
 *
 * - LEGAL_VOCAB feeds the Whisper prompt and the Gemini prompt (config.ts). Whisper keeps only the
 *   LAST ~224 prompt tokens, so the most important terms go at the END of the list.
 * - repairLegalTerms() fixes exact misrecognitions from real calls. It is a patch, not the cure:
 *   the cure is a better STT path (Gemini hybrid needs GEMINI_API_KEY, #989).
 *   The Smart Judge server runs its own repair (legal_phonetics.repair_legal_phonetics) on every
 *   chat message; every rule here must be idempotent and must not fight those patterns.
 *
 * Add a rule only for an error seen on a real call, with the call date and a test in agent.test.ts.
 */

/**
 * Ordered least to most important (Whisper truncates the prompt from the front). The prompt stays
 * about as long as the 2026-11-15 one (~335 characters); to make room for the 2026-11-21 terms,
 * rarely-misheard ones were dropped (واخواهی، فرجام‌خواهی، بازپرس، اعسار، انحصار وراثت، سفته، قولنامه،
 * اجاره‌نامه، آیین دادرسی).
 */
export const LEGAL_VOCAB: readonly string[] = [
  'دادنامه', 'دادخواست', 'دادسرا', 'شورای حل اختلاف', 'اجرای احکام', 'مهریه', 'نفقه', 'طلاق توافقی',
  'حضانت', 'چک برگشتی', 'تخلیه', 'دیه', 'قانون مدنی', 'ماده', 'تبصره', 'مهلت تجدیدنظرخواهی',
  'دیوان عدالت اداری', 'دیوان عالی کشور',
  // 2026-11-21 call: each of these was misheard
  'بخشنامه', 'آیین‌نامه', 'تخلفات انتظامی وکلا', 'دادگاه عالی انتظامی قضات', 'قانون مبارزه با پولشویی',
  'قوه قضاییه', 'آخرین آرای وحدت رویه',
];

interface Rule { re: RegExp; to: string; seen: string }

// Persian has no \b: a "word edge" is the start/end of the string or a non-letter.
const L = '(?<![\\p{L}\\p{M}])';
const R = '(?![\\p{L}\\p{M}])';
const rx = (src: string) => new RegExp(L + src + R, 'gu');

const RULES: Rule[] = [
  // "قول به غذایی" for قوه قضاییه (2026-11-21); also the plain spelling variants
  { re: rx('(?:قول\\s*به|قوه|قوه‌ی|قوهٔ)\\s*[غق][ضذزظ]ایی(?:ه)?'), to: 'قوه قضاییه', seen: '2026-11-21 قول به غذایی' },
  // "آرای عدی بستا سویه" (2026-11-21), "آده رای بحث زدیه" (2026-11-15) for آرای وحدت رویه
  { re: rx('(?:آرای|ارای)\\s+عدی\\s+بستا\\s+[سر]ویه'), to: 'آرای وحدت رویه', seen: '2026-11-21 آرای عدی بستا سویه' },
  { re: rx('آده\\s+رای\\s+بحث\\s+زدیه'), to: 'آرای وحدت رویه', seen: '2026-11-15 آده رای بحث زدیه' },
  // "قانون موردان برشویش" for قانون مبارزه با پولشویی (2026-11-21)
  { re: rx('(?:موردان|مبارزان)\\s+(?:برشویش|پولشویش|پول\\s*شویی|پولشویی)'), to: 'مبارزه با پولشویی', seen: '2026-11-21 موردان برشویش' },
  { re: rx('(?:برشویش|پولشویش)'), to: 'پولشویی', seen: '2026-11-21 برشویش' },
  // "قضاک" for قضات, "تخلافات" for تخلفات (2026-11-21)
  { re: rx('قضاک'), to: 'قضات', seen: '2026-11-21 قضاک' },
  { re: rx('تخلافات'), to: 'تخلفات', seen: '2026-11-21 تخلافات' },
  // "آخر آرای ..." / "آخر رای ...": colloquial "last" that the brain read as a definition question
  // (2026-11-15); the server's "latest" catalog intent only knows آخرین. Only at the start of the
  // utterance, or before وحدت رویه: "در آخر رأی دادگاه" (at the end of the verdict) must stay.
  { re: new RegExp('(?<=^|[.،؟?!:]\\s*)آخر(?=\\s+(?:آرای|ارای|رأی|رای|بخشنامه)' + R + ')', 'gu'), to: 'آخرین', seen: '2026-11-15 آخر رای' },
  { re: new RegExp(L + 'آخر(?=\\s+(?:آرای|ارای|رأی|رای)\\s+وحدت\\s+رویه' + R + ')', 'gu'), to: 'آخرین', seen: '2026-11-21 آخر آرای وحدت رویه' },
];

/** Fix known legal-term misrecognitions; returns the text unchanged when nothing matches. */
export function repairLegalTerms(text: string): string {
  if (!text) return text;
  let s = text.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  for (const r of RULES) s = s.replace(r.re, r.to);
  return s;
}
