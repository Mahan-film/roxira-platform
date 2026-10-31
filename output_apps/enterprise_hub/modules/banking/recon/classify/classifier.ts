import { fixPersianChars, toAsciiDigits } from '../../../data_import/normaliser/normalise';
import { normaliseAccountNumber } from '../iban';

export const CATEGORIES = [
  'bank_fee',
  'sms_fee',
  'sale',
  'purchase',
  'partner_current',
  'payroll',
  'loan',
  'tax',
  'own_transfer',
  'unknown',
] as const;
export type Category = (typeof CATEGORIES)[number];

export type PersonType = 'real' | 'legal' | 'unknown';

export type ClassificationSource = 'tenant_rule' | 'own_account' | 'fee_rule' | 'history' | 'keyword' | 'none';

export interface ClassifiableItem {
  id: number;
  direction: 'in' | 'out';
  /** Whole rials. */
  amountRial: bigint;
  description: string;
}

export interface TenantRule {
  id: number;
  kind: 'counterparty' | 'keyword';
  /** Normalised counterparty key or keyword. */
  pattern: string;
  category: Category;
  personType: PersonType | null;
  counterAccountCode: string | null;
}

export interface ClassifierSettings {
  /** Largest bank fee (whole rial) still treated as a "small fee". */
  feeMaxRial: bigint;
  smsFeeMaxRial: bigint;
}

export const DEFAULT_CLASSIFIER_SETTINGS: ClassifierSettings = {
  feeMaxRial: 5_000_000n,
  smsFeeMaxRial: 500_000n,
};

export interface OwnAccount {
  accountNumber: string;
  iban: string | null;
  names: string[];
}

export interface ClassifierContext {
  settings: ClassifierSettings;
  rules: TenantRule[];
  /** Counterparty key to how many times each category was confirmed for it. */
  history: Map<string, Partial<Record<Category, number>>>;
  /** The tenant's other bank accounts (and company names) for own-account transfer detection. */
  ownAccounts: OwnAccount[];
}

export interface Classification {
  category: Category;
  personType: PersonType;
  counterparty: string | null;
  counterpartyKey: string | null;
  confidence: number;
  source: ClassificationSource;
  evidence: string[];
  counterAccountCode: string | null;
  /** A small fee recognised by a fee rule, eligible for rule-based auto-post. */
  autoPostEligible: boolean;
}

/** Below this the system asks instead of deciding. */
export const CONFIDENT = 0.8;

export function normaliseText(value: string): string {
  return fixPersianChars(toAsciiDigits(value))
    .replace(/[‌‍]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const TITLES = /^(?:آقای|اقای|خانم|جناب|سرکار|دکتر|مهندس|مرحوم)\s+/;
const LEGAL = /(?:^|\s)(?:شرکت|موسسه|مؤسسه|سازمان|بانک|صندوق|تعاونی|گروه|صنایع|بازرگانی|اداره|دانشگاه|بنیاد|کارخانه|co|ltd|llc|inc)(?:\s|$)/i;

const COUNTERPARTY_PATTERNS: RegExp[] = [
  /(?:از طرف|بنام|به نام|در وجه)\s+(.+?)(?=\s+(?:بابت|شرح|شبا|شماره|کد)(?:\s|$)|\s+ir\d|\s\d{6,}|$)/,
  /(?:انتقال|پایا|ساتنا|حواله|واریز|دریافت|پرداخت|برداشت|کارت به کارت)[^،]{0,30}?\s(?:از|به|برای)\s+(.+?)(?=\s+(?:بابت|شرح|شبا|شماره|کد)(?:\s|$)|\s+ir\d|\s\d{6,}|$)/,
];

export function extractCounterparty(description: string): { name: string; key: string } | null {
  const text = normaliseText(description);
  for (const pattern of COUNTERPARTY_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const name = match[1].replace(TITLES, '').replace(/\d+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (name.length >= 3) {
        return { name, key: name };
      }
    }
  }
  return null;
}

export function personTypeOf(name: string | null): PersonType {
  if (!name) {
    return 'unknown';
  }
  const text = normaliseText(name);
  if (LEGAL.test(` ${text} `)) {
    return 'legal';
  }
  const words = text.split(' ').filter(Boolean);
  return words.length >= 2 && words.length <= 4 ? 'real' : 'unknown';
}

interface KeywordRule {
  category: Category;
  words: string[];
  /** Direction the category normally has; the opposite lowers confidence. */
  direction?: 'in' | 'out';
}

const KEYWORD_RULES: KeywordRule[] = [
  { category: 'payroll', words: ['حقوق', 'دستمزد', 'عیدی', 'پاداش', 'اضافه کار', 'مزایا'], direction: 'out' },
  { category: 'loan', words: ['وام', 'قسط', 'اقساط', 'تسهیلات'] },
  { category: 'tax', words: ['مالیات', 'امور مالیاتی', 'ارزش افزوده', 'عوارض', 'سامانه مودیان'], direction: 'out' },
  { category: 'partner_current', words: ['جاری شریک', 'جاری شرکا', 'برداشت شریک', 'سهامدار', 'علی الحساب شریک', 'حساب جاری شریک'] },
  { category: 'sale', words: ['فروش', 'فاکتور فروش', 'بابت فاکتور', 'دریافت از مشتری', 'تسویه فاکتور'], direction: 'in' },
  { category: 'purchase', words: ['خرید', 'فاکتور خرید', 'پرداخت به تامین', 'تسویه فاکتور خرید', 'بابت کالا'], direction: 'out' },
];

const SMS_WORDS = ['پیامک', 'sms', 'اس ام اس'];
const FEE_WORDS = ['کارمزد', 'حق الزحمه', 'هزینه خدمات بانکی', 'هزینه کارت', 'کارمزد کارت', 'کارمزد پایا', 'کارمزد ساتنا', 'کارمزد انتقال'];

function hasWord(text: string, words: string[]): string | null {
  for (const word of words) {
    if (text.includes(normaliseText(word))) {
      return word;
    }
  }
  return null;
}

function blank(partial: Partial<Classification> = {}): Classification {
  return {
    category: 'unknown',
    personType: 'unknown',
    counterparty: null,
    counterpartyKey: null,
    confidence: 0,
    source: 'none',
    evidence: [],
    counterAccountCode: null,
    autoPostEligible: false,
    ...partial,
  };
}

function detectOwnTransfer(text: string, own: OwnAccount[]): string | null {
  const digits = normaliseAccountNumber(text);
  for (const account of own) {
    const number = normaliseAccountNumber(account.accountNumber);
    if (number.length >= 6 && digits.includes(number)) {
      return `شماره حساب ${number.slice(-4)}…`;
    }
    const iban = account.iban ? normaliseAccountNumber(account.iban.slice(2)) : '';
    if (iban.length >= 10 && digits.includes(iban)) {
      return `شبا …${iban.slice(-4)}`;
    }
    for (const name of account.names) {
      const needle = normaliseText(name);
      if (needle.length >= 4 && text.includes(needle)) {
        return `نام ${name}`;
      }
    }
  }
  return null;
}

/** History vote: the dominant category of a counterparty if it is consistent enough. */
function historyVote(
  history: ClassifierContext['history'],
  key: string,
): { category: Category; share: number; total: number } | null {
  const counts = history.get(key);
  if (!counts) {
    return null;
  }
  const entries = Object.entries(counts) as Array<[Category, number]>;
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (total === 0) {
    return null;
  }
  const [category, top] = entries.sort((a, b) => b[1] - a[1])[0];
  return { category, share: top / total, total };
}

export function classify(item: ClassifiableItem, ctx: ClassifierContext): Classification {
  const text = normaliseText(item.description);
  const cp = extractCounterparty(item.description);
  const person = personTypeOf(cp?.name ?? null);
  const base = { counterparty: cp?.name ?? null, counterpartyKey: cp?.key ?? null, personType: person };

  // 1. tenant rules (learned from earlier answers) win over everything.
  const ruleHit = ctx.rules.find(
    (rule) =>
      (rule.kind === 'counterparty' && cp !== null && cp.key === rule.pattern) ||
      (rule.kind === 'keyword' && text.includes(rule.pattern)),
  );
  if (ruleHit) {
    return blank({
      ...base,
      category: ruleHit.category,
      personType: ruleHit.personType ?? person,
      confidence: 0.97,
      source: 'tenant_rule',
      evidence: [`قانون ذخیره‌شده: «${ruleHit.pattern}»`],
      counterAccountCode: ruleHit.counterAccountCode,
    });
  }

  // 2. transfer between the tenant's own accounts.
  const own = detectOwnTransfer(text, ctx.ownAccounts);
  if (own) {
    return blank({
      ...base,
      category: 'own_transfer',
      confidence: 0.93,
      source: 'own_account',
      evidence: [`طرف مقابل حساب دیگر خود سازمان است (${own})`],
    });
  }

  // 3. small fees (out only), thresholds are tenant-editable.
  if (item.direction === 'out') {
    const sms = hasWord(text, SMS_WORDS);
    const fee = hasWord(text, FEE_WORDS);
    if (sms || fee) {
      const sms_ = Boolean(sms);
      const limit = sms_ ? ctx.settings.smsFeeMaxRial : ctx.settings.feeMaxRial;
      const withinLimit = item.amountRial <= limit;
      return blank({
        ...base,
        category: sms_ ? 'sms_fee' : 'bank_fee',
        personType: 'legal',
        confidence: withinLimit ? 0.96 : 0.55,
        source: 'fee_rule',
        evidence: [
          `عبارت «${sms ?? fee}» در شرح`,
          withinLimit
            ? `مبلغ کمتر از سقف ${limit.toString()} ریال`
            : `مبلغ بیشتر از سقف ${limit.toString()} ریال`,
        ],
        autoPostEligible: withinLimit,
      });
    }
  }

  // 4. what this counterparty was before.
  if (cp) {
    const vote = historyVote(ctx.history, cp.key);
    if (vote && vote.share >= 0.8 && vote.total >= 2) {
      return blank({
        ...base,
        category: vote.category,
        confidence: Math.min(0.9, 0.6 + 0.1 * vote.total),
        source: 'history',
        evidence: [`${vote.total} بار قبلی با «${cp.name}» به‌عنوان ${vote.category} ثبت شده`],
      });
    }
  }

  // 5. built-in keywords.
  for (const rule of KEYWORD_RULES) {
    const word = hasWord(text, rule.words);
    if (word) {
      const directionOk = !rule.direction || rule.direction === item.direction;
      return blank({
        ...base,
        category: rule.category,
        confidence: directionOk ? 0.82 : 0.5,
        source: 'keyword',
        evidence: [`عبارت «${word}» در شرح`, ...(directionOk ? [] : ['جهت تراکنش با این دسته معمول نیست'])],
      });
    }
  }
  return blank({ ...base, evidence: ['شرح تراکنش به هیچ قاعده‌ای نمی‌خورد'] });
}

export function buildHistory(
  confirmed: Array<{ counterpartyKey: string | null; category: Category }>,
): ClassifierContext['history'] {
  const history: ClassifierContext['history'] = new Map();
  for (const entry of confirmed) {
    if (!entry.counterpartyKey || entry.category === 'unknown') {
      continue;
    }
    const counts = history.get(entry.counterpartyKey) ?? {};
    counts[entry.category] = (counts[entry.category] ?? 0) + 1;
    history.set(entry.counterpartyKey, counts);
  }
  return history;
}
