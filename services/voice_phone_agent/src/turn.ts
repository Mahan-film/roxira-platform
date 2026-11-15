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

function norm(s: string): string {
  return s.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ً-ٰٟ]/g, '').replace(/‌/g, ' ');
}

function bigrams(s: string): string[] {
  const t = norm(s).replace(/[^\p{L}\p{N}]/gu, '');
  const out: string[] = [];
  for (let i = 0; i + 1 < t.length; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Share of `part`'s letter pairs that also occur in `whole` (0..1); robust to STT misspellings. */
export function containment(part: string, whole: string): number {
  const p = bigrams(part);
  if (!p.length) return 0;
  const w = new Set(bigrams(whole));
  return p.filter((b) => w.has(b)).length / p.length;
}

/**
 * Remove the agent's own voice coming back on the line (handset on speaker, line echo) from the start
 * of a transcript. Real call 2026-11-15: "یکی به غازی حوشمند خوش آمدید. آخرین آرای وحدت رویه چی هستش؟"
 * where the first part is the greeting. Leading words that look like recent agent speech are dropped;
 * two non-matching words in a row end the echo. Only strips when at least 4 words match.
 */
export function stripEcho(text: string, agentTexts: string[]): { text: string; removed: string } {
  const agent = agentTexts.join(' ');
  if (!agent.trim()) return { text, removed: '' };
  const agentWords = new Set(words(norm(agent)));
  const w = words(text);
  let cut = 0;
  let miss = 0;
  for (let i = 0; i < w.length; i++) {
    const x = norm(w[i]);
    const echoLike = agentWords.has(x) || (bigrams(x).length >= 2 && containment(x, agent) >= 0.67);
    if (echoLike) { cut = i + 1; miss = 0; } else if (++miss >= 2) break;
  }
  // >= 4 words: a caller may open by repeating a 3-word term from the last answer ("رأی وحدت رویه ...")
  if (cut < 4 || containment(w.slice(0, cut).join(' '), agent) < 0.6) return { text, removed: '' };
  const rest = w.slice(cut).join(' ');
  const q = /[؟?]\s*$/.test(text) && rest ? '؟' : '';
  return { text: rest ? rest + q : '', removed: w.slice(0, cut).join(' ') };
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
