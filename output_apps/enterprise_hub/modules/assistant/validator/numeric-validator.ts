/**
 * اعتبارسنج عددی دستیار: هر عدد در پاسخ باید به یک شاهد در همان نوبت برسد
 * (نتیجهٔ ابزار یا متریک تأییدشده، تاریخ امروز، یا عددی که خود کاربر نوشته).
 * عدد بدون شاهد یعنی پاسخ رد می‌شود و دستیار پرهیز می‌کند. این ماژول خالص است:
 * نه پایگاه‌داده می‌خواند و نه چیزی ثبت می‌کند.
 */

/** پیام پرهیز: دستیار به‌جای حدس زدن عدد، صادقانه اعلام می‌کند. */
export const ABSTAIN_MESSAGE_FA =
  'از این پاسخ مطمئن نیستم: عددهایی در آن بود که در داده‌های ثبت‌شده شاهدی برایشان پیدا نکردم، پس آن را نمایش نمی‌دهم. پرسش را مشخص‌تر بپرسید (مثلاً بازهٔ زمانی یا نام شاخص) تا دوباره از داده‌های ثبت‌شده محاسبه کنم.';

/** حداکثر خطای نسبی مجاز برای عددهای گردشده («حدود ۲۵ میلیون»). */
const ROUNDING_RELATIVE_TOLERANCE = 0.05;

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** ارقام فارسی/عربی را لاتین می‌کند. */
export function toLatinDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (char) => {
    const persian = PERSIAN_DIGITS.indexOf(char);
    return String(persian >= 0 ? persian : ARABIC_DIGITS.indexOf(char));
  });
}

// ---------------------------------------------------------------- number words

const ONES: Record<string, number> = {
  صفر: 0, یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, شیش: 6, هفت: 7, هشت: 8,
  ده: 10, یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14, پانزده: 15,
  شانزده: 16, هفده: 17, هجده: 18, نوزده: 19,
  بیست: 20, سی: 30, چهل: 40, پنجاه: 50, شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90,
  صد: 100, یکصد: 100, دویست: 200, سیصد: 300, چهارصد: 400, پانصد: 500,
  ششصد: 600, هفتصد: 700, هشتصد: 800, نهصد: 900,
};
/** «هزار» و بالاتر: ضرب می‌کنند. */
const SCALES: Record<string, number> = {
  هزار: 1e3, میلیون: 1e6, میلیارد: 1e9, بیلیون: 1e9, تریلیون: 1e12,
};

const WORD_PATTERN = /[آ-یٰ‌]+/g;

interface Token {
  text: string;
  /** عدد استخراج‌شده. */
  value: number;
  /** تعداد رقم اعشاری نوشته‌شده (برای تعیین دقت گرد کردن). */
  decimals: number;
  /** ضریب بزرگی (هزار/میلیون/…)؛ ۱ اگر نباشد. */
  magnitude: number;
  kind: 'number' | 'date';
}

/**
 * عددهای نوشته‌شده با حروف («پنج میلیون و دویست هزار») را پیدا می‌کند.
 * «یک» به‌تنهایی عدد حساب نمی‌شود (حرف نکره است)، مگر با «میلیون/…» بیاید.
 */
function wordNumbers(text: string): Token[] {
  const words = [...text.matchAll(WORD_PATTERN)].map((m) => ({
    word: m[0].replace(/‌/g, ''),
    index: m.index ?? 0,
  }));
  const tokens: Token[] = [];
  let i = 0;
  while (i < words.length) {
    const start = i;
    let total = 0;
    let group = 0;
    let seen = 0;
    let scaleSeen = 1;
    let lastSmall = '';
    while (i < words.length) {
      const { word } = words[i];
      if (word === 'و' && seen > 0 && i + 1 < words.length && (words[i + 1].word in ONES || words[i + 1].word in SCALES)) {
        i += 1;
        continue;
      }
      if (word in ONES) {
        group += ONES[word];
        lastSmall = word;
      } else if (word in SCALES) {
        const scale = SCALES[word];
        group = (group || 1) * scale;
        if (scale >= 1e6) {
          total += group;
          group = 0;
        }
        scaleSeen = Math.max(scaleSeen, scale);
      } else {
        break;
      }
      seen += 1;
      i += 1;
    }
    if (seen === 0) {
      i = start + 1;
      continue;
    }
    const value = total + group;
    const loneArticle = seen === 1 && lastSmall === 'یک' && scaleSeen === 1;
    if (!loneArticle) {
      tokens.push({
        text: words.slice(start, i).map((w) => w.word).join(' '),
        value,
        decimals: 0,
        magnitude: scaleSeen,
        kind: 'number',
      });
    }
  }
  return tokens;
}

// ------------------------------------------------------------- digit numbers

const MAGNITUDE_AFTER = /^\s*(هزار\s+میلیارد|هزار|میلیون|میلیارد|بیلیون|تریلیون)/;
const MAGNITUDE_VALUE: Record<string, number> = {
  هزار: 1e3, میلیون: 1e6, میلیارد: 1e9, بیلیون: 1e9, تریلیون: 1e12,
  'هزار میلیارد': 1e12,
};

const DATE_RE = /(?<![\d/.-])(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?![\d/])/g;
const MONTH_RE = /(?<![\d/.-])(\d{4})\/(\d{1,2})(?![\d/])/g;
const NUMBER_RE =
  /(?<![\p{L}\d_./-])\d+(?:[,،٬]\d{3})*(?:[.٫/]\d+)?(?![\p{L}\d_])/gu;
const LIST_MARKER_RE = /^[ \t]*(?:[-*•]\s*)?\d{1,2}[.)]\s/;

function digitNumbers(text: string): Token[] {
  const tokens: Token[] = [];
  const masked = [...text];
  const mask = (start: number, length: number): void => {
    for (let k = start; k < start + length; k++) masked[k] = ' ';
  };

  for (const re of [DATE_RE, MONTH_RE]) {
    for (const match of text.matchAll(re)) {
      const index = match.index ?? 0;
      if (masked[index] === ' ') continue;
      tokens.push({ text: match[0], value: 0, decimals: 0, magnitude: 1, kind: 'date' });
      mask(index, match[0].length);
    }
  }

  const rest = masked.join('');
  // نشانگر فهرست («۱.» در ابتدای سطر) عدد ادعایی نیست.
  const lines = rest.split('\n');
  let offset = 0;
  const listMarkers = new Set<number>();
  for (const line of lines) {
    const marker = LIST_MARKER_RE.exec(line);
    if (marker) {
      listMarkers.add(offset + marker[0].search(/\d/));
    }
    offset += line.length + 1;
  }

  for (const match of rest.matchAll(NUMBER_RE)) {
    const index = match.index ?? 0;
    if (listMarkers.has(index)) continue;
    const raw = match[0];
    const clean = raw.replace(/[,،٬]/g, '').replace(/[٫/]/, '.');
    const value = Number(clean);
    if (!Number.isFinite(value)) continue;
    const decimals = clean.includes('.') ? clean.split('.')[1].length : 0;
    const after = rest.slice(index + raw.length);
    const mag = MAGNITUDE_AFTER.exec(after);
    const magnitude = mag ? MAGNITUDE_VALUE[mag[1].replace(/\s+/g, ' ')] : 1;
    tokens.push({
      text: mag ? `${raw} ${mag[1]}` : raw,
      value: value * magnitude,
      decimals,
      magnitude,
      kind: 'number',
    });
  }
  return tokens;
}

/** همهٔ عددهای ادعاشدهٔ یک متن (رقمی و حروفی). */
export function extractNumbers(text: string): Token[] {
  const latin = toLatinDigits(text);
  // «۱۵ میلیون» یک عدد رقمی است؛ واژهٔ «میلیون» نباید دوباره حروفی شمرده شود.
  const wordsOnly = latin.replace(
    /\d[\d,،٬.٫/]*\s*(?:هزار\s+میلیارد|هزار|میلیون|میلیارد|بیلیون|تریلیون)/g,
    ' ¤ ',
  );
  return [...digitNumbers(latin), ...wordNumbers(wordsOnly)];
}

// -------------------------------------------------------------------- evidence

export interface Evidence {
  numbers: Set<number>;
  /** تاریخ‌ها به شکل `y/m/d` شمسی و میلادی و `y/m` ماه. */
  dates: Set<string>;
}

const ISO_DATE_RE = /(\d{4})-(\d{2})-(\d{2})/g;

function pad(n: number | string): string {
  return String(Number(n));
}

function normalizeDate(y: string, m: string, d?: string): string {
  return d === undefined ? `${y}/${pad(m)}` : `${y}/${pad(m)}/${pad(d)}`;
}

function jalaliOf(date: Date): { jy: number; jm: number; jd: number } {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const pick = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return { jy: pick('year'), jm: pick('month'), jd: pick('day') };
}

function addDate(evidence: Evidence, date: Date): void {
  const { jy, jm, jd } = jalaliOf(date);
  evidence.dates.add(normalizeDate(String(jy), String(jm), String(jd)));
  evidence.dates.add(normalizeDate(String(jy), String(jm)));
  const iso = date.toISOString().slice(0, 10);
  evidence.dates.add(iso.replace(/-/g, '/').replace(/\/0/g, '/'));
}

/** عدد خام را به مجموعهٔ شواهد اضافه می‌کند. */
function addNumber(evidence: Evidence, value: number): void {
  if (Number.isFinite(value)) evidence.numbers.add(Math.abs(value));
}

function collect(evidence: Evidence, value: unknown, depth: number): void {
  if (depth > 12 || value === null || value === undefined) return;
  if (typeof value === 'number') {
    addNumber(evidence, value);
  } else if (typeof value === 'bigint') {
    addNumber(evidence, Number(value));
  } else if (typeof value === 'string') {
    collectText(evidence, value);
  } else if (Array.isArray(value)) {
    addNumber(evidence, value.length);
    for (const item of value) collect(evidence, item, depth + 1);
  } else if (typeof value === 'object') {
    if (value instanceof Date) {
      addDate(evidence, value);
      return;
    }
    for (const item of Object.values(value as Record<string, unknown>)) {
      collect(evidence, item, depth + 1);
    }
  }
}

function collectText(evidence: Evidence, text: string): void {
  const latin = toLatinDigits(text);
  for (const token of extractNumbers(text)) {
    if (token.kind === 'number') addNumber(evidence, token.value);
  }
  for (const match of latin.matchAll(ISO_DATE_RE)) {
    const date = new Date(`${match[0]}T12:00:00Z`);
    if (!Number.isNaN(date.getTime())) addDate(evidence, date);
    evidence.dates.add(normalizeDate(match[1], match[2], match[3]));
  }
  for (const match of latin.matchAll(DATE_RE)) {
    evidence.dates.add(normalizeDate(match[1], match[2], match[3]));
  }
  for (const match of latin.matchAll(MONTH_RE)) {
    evidence.dates.add(normalizeDate(match[1], match[2]));
  }
  // سال‌هایی مثل «سال 1405» در برچسب‌ها.
  for (const match of latin.matchAll(/(?<!\d)(1[34]\d{2})(?!\d)/g)) {
    addNumber(evidence, Number(match[1]));
  }
}

/** شواهد یک نوبت: نتیجهٔ ابزارها/متریک‌ها، تاریخ امروز و متن‌های خود کاربر. */
export function buildEvidence(input: {
  toolResults: readonly unknown[];
  userTexts?: readonly string[];
  now: Date;
}): Evidence {
  const evidence: Evidence = { numbers: new Set(), dates: new Set() };
  addDate(evidence, input.now);
  for (const result of input.toolResults) collect(evidence, result, 0);
  for (const text of input.userTexts ?? []) {
    collectText(evidence, text);
    const latin = toLatinDigits(text);
    for (const match of latin.matchAll(DATE_RE)) {
      evidence.dates.add(normalizeDate(match[1], match[2], match[3]));
    }
  }
  return evidence;
}

// ------------------------------------------------------------------ validation

export interface UnsupportedNumber {
  text: string;
  value: number | null;
}

export interface NumericValidation {
  ok: boolean;
  unsupported: UnsupportedNumber[];
  checked: number;
}

/** آیا `claimed` با یکی از عددهای شاهد (یا ده‌یک آن، یعنی ریال←تومان) می‌خواند؟ */
function supported(token: Token, evidence: Evidence): boolean {
  const claimed = token.value;
  const step = (token.magnitude > 1 || token.decimals > 0)
    ? (token.magnitude > 1 ? token.magnitude : 1) * 10 ** -token.decimals
    : 0;
  for (const base of evidence.numbers) {
    for (const candidate of [base, base / 10]) {
      if (candidate === claimed) return true;
      if (step === 0) {
        // دقیقاً برابر، با تحمل خطای ممیز شناور.
        if (Math.abs(candidate - claimed) <= Math.abs(claimed) * 1e-12) return true;
        continue;
      }
      const diff = Math.abs(candidate - claimed);
      if (diff <= step / 2 + 1e-9 && diff <= Math.abs(candidate) * ROUNDING_RELATIVE_TOLERANCE) {
        return true;
      }
    }
  }
  return false;
}

/**
 * پاسخ را بررسی می‌کند: هر عدد (رقمی یا حروفی) باید در `evidence` باشد.
 * تاریخ‌ها فقط وقتی معتبرند که امروز، تاریخ در شواهد یا تاریخ خود کاربر باشند.
 */
export function validateNumbers(
  answer: string,
  evidence: Evidence,
): NumericValidation {
  const tokens = extractNumbers(answer);
  const unsupported: UnsupportedNumber[] = [];
  for (const token of tokens) {
    if (token.kind === 'date') {
      const [y, m, d] = toLatinDigits(token.text).split(/[/-]/);
      if (!evidence.dates.has(normalizeDate(y, m, d))) {
        unsupported.push({ text: token.text, value: null });
      }
      continue;
    }
    if (!supported(token, evidence)) {
      unsupported.push({ text: token.text, value: token.value });
    }
  }
  return { ok: unsupported.length === 0, unsupported, checked: tokens.length };
}

/** یک‌جا: شواهد را می‌سازد و پاسخ را یا برمی‌گرداند یا با پرهیز جایگزین می‌کند. */
export function enforceNumericEvidence(input: {
  answer: string;
  toolResults: readonly unknown[];
  userTexts?: readonly string[];
  now: Date;
}): { answer: string; validation: NumericValidation; abstained: boolean } {
  const evidence = buildEvidence(input);
  const validation = validateNumbers(input.answer, evidence);
  return validation.ok
    ? { answer: input.answer, validation, abstained: false }
    : { answer: ABSTAIN_MESSAGE_FA, validation, abstained: true };
}
