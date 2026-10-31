import { CATEGORIES, Category, Classification, CONFIDENT, PersonType } from './classify/classifier';
import { MatchGroup } from './matching/matcher';

export interface QuestionChoice {
  id: string;
  label: string;
  category?: Category;
  personType?: PersonType;
}

export interface Question {
  kind: 'classify' | 'confirm_match';
  itemId: number;
  /** One short sentence. */
  text: string;
  choices: QuestionChoice[];
  evidence: string[];
  acceptsAttachment: true;
}

export interface QuestionItem {
  id: number;
  direction: 'in' | 'out';
  amountRial: bigint;
  date: string;
  description: string;
}

const LABELS: Record<Category, string> = {
  bank_fee: 'کارمزد بانکی',
  sms_fee: 'هزینه پیامک',
  sale: 'دریافت بابت فروش',
  purchase: 'پرداخت بابت خرید',
  partner_current: 'جاری شریک',
  payroll: 'حقوق و دستمزد',
  loan: 'وام / قسط',
  tax: 'مالیات',
  own_transfer: 'انتقال بین حساب‌های خودی',
  unknown: 'نمی‌دانم',
};

export const categoryLabel = (category: Category): string => LABELS[category];

const IN_CHOICES: Category[] = ['sale', 'partner_current', 'loan', 'own_transfer'];
const OUT_CHOICES: Category[] = ['purchase', 'payroll', 'tax', 'loan', 'partner_current', 'own_transfer', 'bank_fee'];

const money = (value: bigint) => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * One short question for an item the classifier is not sure about; null when it is confident.
 * The suggestion comes first, then the usual categories for the direction.
 */
export function classificationQuestion(
  item: QuestionItem,
  classification: Classification,
  options: { force?: boolean } = {},
): Question | null {
  if (
    !options.force &&
    classification.confidence >= CONFIDENT &&
    classification.category !== 'unknown'
  ) {
    return null;
  }
  const usual = item.direction === 'in' ? IN_CHOICES : OUT_CHOICES;
  const ordered: Category[] = [];
  if (classification.category !== 'unknown') {
    ordered.push(classification.category);
  }
  for (const category of usual) {
    if (!ordered.includes(category)) {
      ordered.push(category);
    }
  }
  if (options.force) {
    // An answer given on purpose may be any category, not only the usual ones for the direction.
    for (const category of CATEGORIES) {
      if (category !== 'unknown' && !ordered.includes(category)) {
        ordered.push(category);
      }
    }
  }
  const choices: QuestionChoice[] = ordered.slice(0, options.force ? ordered.length : 5).map((category) => ({
    id: category,
    label: categoryLabel(category),
    category,
  }));
  choices.push({ id: 'skip', label: 'بعداً / نمی‌دانم' });
  const who = classification.counterparty ? ` (${classification.counterparty})` : '';
  return {
    kind: 'classify',
    itemId: item.id,
    text: `${item.direction === 'in' ? 'واریز' : 'برداشت'} ${money(item.amountRial)} ریال در ${item.date}${who} چیست؟`,
    choices,
    evidence: [`شرح: ${item.description.slice(0, 120)}`, ...classification.evidence],
    acceptsAttachment: true,
  };
}

/** Yes/no question for a suggested (not auto-accepted) match group. */
export function matchQuestion(group: MatchGroup, item: QuestionItem): Question {
  return {
    kind: 'confirm_match',
    itemId: item.id,
    text: `آیا این ${item.direction === 'in' ? 'واریز' : 'برداشت'} ${money(item.amountRial)} ریالی با سند(های) پیشنهادی یکی است؟`,
    choices: [
      { id: 'yes', label: 'بله، یکی است' },
      { id: 'no', label: 'خیر' },
    ],
    evidence: [...group.reasons, `اطمینان ${Math.round(group.confidence * 100)}٪`],
    acceptsAttachment: true,
  };
}

export interface RuleDraft {
  kind: 'counterparty' | 'keyword';
  pattern: string;
  category: Category;
  personType: PersonType | null;
  counterAccountCode: string | null;
}

export interface AnswerOutcome {
  category: Category;
  personType: PersonType;
  /** Reusable tenant rule, when the answer can be generalised. */
  rule: RuleDraft | null;
}

/**
 * Applies an answer. A rule is created only when the counterparty is known (or the caller gives
 * an explicit keyword): never from a guess about the text.
 */
export function applyAnswer(
  question: Question,
  choiceId: string,
  classification: Classification,
  options: { personType?: PersonType; counterAccountCode?: string | null; keyword?: string; remember?: boolean } = {},
): AnswerOutcome | null {
  const choice = question.choices.find((c) => c.id === choiceId);
  if (!choice || !choice.category) {
    return null;
  }
  const personType = options.personType ?? classification.personType;
  let rule: RuleDraft | null = null;
  if (options.remember !== false) {
    if (options.keyword && options.keyword.trim().length >= 4) {
      rule = {
        kind: 'keyword',
        pattern: options.keyword.trim().toLowerCase(),
        category: choice.category,
        personType: personType === 'unknown' ? null : personType,
        counterAccountCode: options.counterAccountCode ?? null,
      };
    } else if (classification.counterpartyKey) {
      rule = {
        kind: 'counterparty',
        pattern: classification.counterpartyKey,
        category: choice.category,
        personType: personType === 'unknown' ? null : personType,
        counterAccountCode: options.counterAccountCode ?? null,
      };
    }
  }
  return { category: choice.category, personType, rule };
}
