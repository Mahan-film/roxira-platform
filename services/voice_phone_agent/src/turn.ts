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

/** Same word, allowing an STT misspelling ("حوشمند" for "هوشمند"); words of 1-2 letters must match exactly. */
export function sameWord(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  if (x.length < 3 || y.length < 3 || Math.abs(x.length - y.length) > 2) return false;
  const bx = bigrams(x);
  const by = new Set(bigrams(y));
  const common = bx.filter((g) => by.has(g)).length;
  return (2 * common) / (bx.length + by.size) >= 0.6;
}

const ECHO_MAX_LEAD = 3; // transcript words before the echo starts ("یکی", "در اینجا")
const ECHO_MAX_SKIP = 3; // agent words the STT may drop inside the echo
const ECHO_MIN_WORDS = 4;

/**
 * Remove the agent's own voice coming back on the line (handset on speaker, line echo) from the start
 * of a transcript. Real call 2026-11-15: "یکی به غازی حوشمند خوش آمدید. آخرین آرای وحدت رویه چی هستش؟"
 * where the first part is the greeting.
 *
 * The leading words must line up, IN ORDER, with a stretch of the agent's words (word-to-word, small
 * misspellings allowed, a few agent words may be missing); two non-matching words in a row end the echo.
 * Only strips when at least 4 words line up, 2 of them longer than 3 letters, and most of the stripped
 * span matched. Real call 2026-11-21: the old bag-of-letter-pairs check matched the caller's own
 * question against 45 s of agent speech ("الان توی یک درگیری ..." has the same common words and
 * letter pairs as any long answer) and threw the first half of the question away.
 */
export function stripEcho(text: string, agentTexts: string[]): { text: string; removed: string } {
  const agent = words(agentTexts.join(' '));
  if (!agent.length) return { text, removed: '' };
  const w = words(text);
  let cut = 0;
  for (let lead = 0; lead <= Math.min(ECHO_MAX_LEAD, w.length - 1); lead++) {
    for (let j = 0; j < agent.length; j++) {
      if (!sameWord(w[lead], agent[j])) continue;
      // greedy in-order alignment of w[lead..] against agent[j..]
      let k = j + 1;
      let matched = 1;
      let long = norm(w[lead]).length > 3 ? 1 : 0;
      let last = lead;
      let miss = 0;
      for (let i = lead + 1; i < w.length && miss < 2; i++) {
        let hit = -1;
        for (let d = 0; d <= ECHO_MAX_SKIP && k + d < agent.length; d++) {
          if (sameWord(w[i], agent[k + d])) { hit = k + d; break; }
        }
        if (hit < 0) { miss++; continue; }
        matched++;
        if (norm(w[i]).length > 3) long++;
        last = i;
        k = hit + 1;
        miss = 0;
      }
      const span = last + 1 - lead;
      if (matched >= ECHO_MIN_WORDS && long >= 2 && matched / span >= 0.6 && last + 1 > cut) cut = last + 1;
    }
  }
  if (!cut) return { text, removed: '' };
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
