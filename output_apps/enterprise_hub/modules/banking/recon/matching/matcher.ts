import { absBig } from '../rial';

/** Statement side: whole amounts in minor units, direction from the bank's point of view. */
export interface BankItem {
  id: number;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Positive minor amount. */
  amount: bigint;
  direction: 'in' | 'out';
  reference: string | null;
  chequeNo: string | null;
  sayadId: string | null;
  description: string;
}

/** Ledger side on the bank's GL account: debit = money in, credit = money out. */
export interface BookItem {
  id: number;
  date: string;
  amount: bigint;
  direction: 'in' | 'out';
  entryNumber: string;
  text: string;
}

export type MatchStage =
  | 'exact'
  | 'reference'
  | 'cheque'
  | 'date_tolerance'
  | 'one_to_many'
  | 'many_to_one';

export interface MatchGroup {
  id: string;
  stage: MatchStage;
  bankIds: number[];
  bookIds: number[];
  confidence: number;
  reasons: string[];
}

export interface MatchOptions {
  /** Days a bank date may differ from the book date. */
  windowDays: number;
  /** Groups at or above this confidence (and unambiguous, one-to-one) are `matched`. */
  autoMinConfidence: number;
  /** Largest group size for one-to-many / many-to-one. */
  maxGroupSize: number;
  /** Candidate pool cap for the subset-sum search (keeps worst case bounded). */
  maxSubsetPool: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  windowDays: 3,
  autoMinConfidence: 0.9,
  maxGroupSize: 4,
  maxSubsetPool: 14,
};

export interface MatchResult {
  matched: MatchGroup[];
  suggested: MatchGroup[];
  unmatchedBank: number[];
  unmatchedBook: number[];
}

const DAY_MS = 86_400_000;

export function daysBetween(a: string, b: string): number {
  return Math.round(
    Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS,
  );
}

/** Digits/letters only, lower case; used to find a reference inside free text. */
export function compactKey(value: string | null | undefined): string {
  return (value ?? '').replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
}

const MIN_KEY = 5;

function appearsIn(key: string | null, text: string): boolean {
  const compact = compactKey(key);
  return compact.length >= MIN_KEY && compactKey(text).includes(compact);
}

interface Candidate {
  book: BookItem;
  days: number;
  stage: MatchStage;
  confidence: number;
  reasons: string[];
}

function scorePair(bank: BankItem, book: BookItem, opts: MatchOptions): Candidate | null {
  if (bank.direction !== book.direction || bank.amount !== book.amount) {
    return null;
  }
  const days = daysBetween(bank.date, book.date);
  const bySayad = bank.sayadId !== null && appearsIn(bank.sayadId, book.text);
  const byCheque = bank.chequeNo !== null && appearsIn(bank.chequeNo, book.text);
  const byRef = appearsIn(bank.reference, `${book.text} ${book.entryNumber}`);

  if (bySayad || byCheque) {
    // A cheque/Sayad number is a strong key; allow a long delay between the cheque date and cash-in.
    if (days > 120) {
      return null;
    }
    return {
      book,
      days,
      stage: 'cheque',
      confidence: bySayad ? 0.99 : 0.97,
      reasons: [bySayad ? 'شناسه صیاد یکسان' : 'شماره چک یکسان', `اختلاف تاریخ ${days} روز`],
    };
  }
  if (byRef) {
    if (days > 31) {
      return null;
    }
    return {
      book,
      days,
      stage: 'reference',
      confidence: days === 0 ? 0.99 : 0.96,
      reasons: ['شماره پیگیری/مرجع در سند آمده است', `اختلاف تاریخ ${days} روز`],
    };
  }
  if (days > opts.windowDays) {
    return null;
  }
  if (days === 0) {
    return {
      book,
      days,
      stage: 'exact',
      confidence: 0.95,
      reasons: ['مبلغ و تاریخ یکسان'],
    };
  }
  return {
    book,
    days,
    stage: 'date_tolerance',
    confidence: Math.max(0.5, 0.95 - 0.04 * days),
    reasons: ['مبلغ یکسان', `اختلاف تاریخ ${days} روز`],
  };
}

let groupSeq = 0;
const nextId = () => `g${++groupSeq}`;

/**
 * Matches a statement against the ledger.
 *
 * One-to-one stages first (most specific key wins: cheque/Sayad, reference, exact date, date
 * tolerance). A bank item with several equally good book candidates, or a candidate wanted by two
 * bank items, is never auto-matched: it becomes a `suggested` group. Then many-to-one /
 * one-to-many (a bank lump sum for several book lines and the reverse) over what is left; those
 * are always `suggested`.
 */
export function matchStatement(
  bankItems: BankItem[],
  bookItems: BookItem[],
  options: Partial<MatchOptions> = {},
): MatchResult {
  const opts = { ...DEFAULT_MATCH_OPTIONS, ...options };
  groupSeq = 0;
  const usedBank = new Set<number>();
  const usedBook = new Set<number>();
  const matched: MatchGroup[] = [];
  const suggested: MatchGroup[] = [];

  const stageRank: Record<MatchStage, number> = {
    cheque: 0,
    reference: 1,
    exact: 2,
    date_tolerance: 3,
    one_to_many: 4,
    many_to_one: 4,
  };

  const candidatesOf = (bank: BankItem): Candidate[] =>
    bookItems
      .filter((book) => !usedBook.has(book.id))
      .map((book) => scorePair(bank, book, opts))
      .filter((c): c is Candidate => c !== null)
      .sort(
        (a, b) =>
          stageRank[a.stage] - stageRank[b.stage] || a.days - b.days || a.book.id - b.book.id,
      );

  // Pre-compute candidate lists so claims by two bank items can be detected.
  const pool = new Map<number, Candidate[]>();
  for (const bank of bankItems) {
    pool.set(bank.id, candidatesOf(bank));
  }

  const ordered = [...bankItems].sort((a, b) => {
    const ra = pool.get(a.id)?.[0] ? stageRank[pool.get(a.id)![0].stage] : 9;
    const rb = pool.get(b.id)?.[0] ? stageRank[pool.get(b.id)![0].stage] : 9;
    return ra - rb || a.date.localeCompare(b.date) || a.id - b.id;
  });

  for (const bank of ordered) {
    const candidates = candidatesOf(bank);
    if (candidates.length === 0) {
      continue;
    }
    const [best, second] = candidates;
    const tie = second && stageRank[second.stage] === stageRank[best.stage] && second.days === best.days;
    if (tie) {
      // Equal candidates: surface the best-ranked one as a suggestion, claim nothing.
      suggested.push({
        id: nextId(),
        stage: best.stage,
        bankIds: [bank.id],
        bookIds: [best.book.id],
        confidence: Math.min(best.confidence, 0.7),
        reasons: [...best.reasons, `${candidates.length} سند هم‌مبلغ و هم‌تاریخ وجود دارد؛ یکی را انتخاب کنید`],
      });
      continue;
    }
    // Is this book line equally wanted by another unmatched bank item (same amount/date)?
    const rivals = bankItems.filter(
      (other) =>
        other.id !== bank.id &&
        !usedBank.has(other.id) &&
        scorePair(other, best.book, opts) !== null &&
        (pool.get(other.id)?.[0]?.book.id === best.book.id) &&
        stageRank[scorePair(other, best.book, opts)!.stage] === stageRank[best.stage] &&
        scorePair(other, best.book, opts)!.days === best.days,
    );
    if (rivals.length > 0 && best.stage !== 'cheque' && best.stage !== 'reference') {
      suggested.push({
        id: nextId(),
        stage: best.stage,
        bankIds: [bank.id],
        bookIds: [best.book.id],
        confidence: Math.min(best.confidence, 0.7),
        reasons: [...best.reasons, 'چند ردیف بانک یک سند را می‌خواهند'],
      });
      continue;
    }
    const group: MatchGroup = {
      id: nextId(),
      stage: best.stage,
      bankIds: [bank.id],
      bookIds: [best.book.id],
      confidence: best.confidence,
      reasons: best.reasons,
    };
    usedBank.add(bank.id);
    usedBook.add(best.book.id);
    (best.confidence >= opts.autoMinConfidence ? matched : suggested).push(group);
  }

  // Suggested one-to-one groups from the tie branches must not hold items "used"; they did not.
  const suggestedBank = new Set(suggested.flatMap((g) => g.bankIds));

  // ---- many-to-one: one bank lump = several book lines (e.g. a deposit slip of several receipts)
  const freeBank = () => bankItems.filter((b) => !usedBank.has(b.id) && !suggestedBank.has(b.id));
  const freeBook = () => bookItems.filter((b) => !usedBook.has(b.id));

  for (const bank of freeBank()) {
    const pool2 = freeBook()
      .filter((book) => book.direction === bank.direction && book.amount < bank.amount)
      .filter((book) => daysBetween(bank.date, book.date) <= opts.windowDays)
      .sort((a, b) => daysBetween(bank.date, a.date) - daysBetween(bank.date, b.date) || a.id - b.id)
      .slice(0, opts.maxSubsetPool);
    const subset = findSubset(pool2.map((b) => b.amount), bank.amount, opts.maxGroupSize);
    if (subset.length >= 2) {
      const books = subset.map((index) => pool2[index]);
      suggested.push({
        id: nextId(),
        stage: 'many_to_one',
        bankIds: [bank.id],
        bookIds: books.map((b) => b.id),
        confidence: 0.7,
        reasons: [`مجموع ${books.length} سند برابر یک ردیف بانک است`],
      });
      suggestedBank.add(bank.id);
      books.forEach((b) => usedBook.add(b.id));
    }
  }

  // ---- one-to-many: several bank lines = one book line (a batch payment split by the bank)
  for (const book of freeBook()) {
    const pool2 = freeBank()
      .filter((bank) => bank.direction === book.direction && bank.amount < book.amount)
      .filter((bank) => daysBetween(bank.date, book.date) <= opts.windowDays)
      .sort((a, b) => daysBetween(a.date, book.date) - daysBetween(b.date, book.date) || a.id - b.id)
      .slice(0, opts.maxSubsetPool);
    const subset = findSubset(pool2.map((b) => b.amount), book.amount, opts.maxGroupSize);
    if (subset.length >= 2) {
      const banks = subset.map((index) => pool2[index]);
      suggested.push({
        id: nextId(),
        stage: 'one_to_many',
        bankIds: banks.map((b) => b.id),
        bookIds: [book.id],
        confidence: 0.7,
        reasons: [`مجموع ${banks.length} ردیف بانک برابر یک سند است`],
      });
      banks.forEach((b) => suggestedBank.add(b.id));
      usedBook.add(book.id);
    }
  }

  const matchedBank = new Set(matched.flatMap((g) => g.bankIds));
  const matchedBook = new Set(matched.flatMap((g) => g.bookIds));
  const suggestedBook = new Set(suggested.flatMap((g) => g.bookIds));
  return {
    matched,
    suggested,
    unmatchedBank: bankItems
      .filter((b) => !matchedBank.has(b.id) && !suggestedBank.has(b.id))
      .map((b) => b.id),
    unmatchedBook: bookItems
      .filter((b) => !matchedBook.has(b.id) && !suggestedBook.has(b.id))
      .map((b) => b.id),
  };
}

/**
 * Indexes of at most `maxSize` amounts summing exactly to `target` (smallest group first), or [].
 * Depth-first over a capped pool: worst case C(pool, maxSize) combinations, a few thousand.
 */
export function findSubset(amounts: bigint[], target: bigint, maxSize: number): number[] {
  for (let size = 2; size <= maxSize; size += 1) {
    const found = search(amounts, target, size, 0, []);
    if (found) {
      return found;
    }
  }
  return [];
}

function search(
  amounts: bigint[],
  remaining: bigint,
  size: number,
  start: number,
  picked: number[],
): number[] | null {
  if (size === 0) {
    return remaining === 0n ? picked : null;
  }
  for (let index = start; index < amounts.length; index += 1) {
    if (absBig(amounts[index]) > absBig(remaining)) {
      continue;
    }
    const result = search(amounts, remaining - amounts[index], size - 1, index + 1, [...picked, index]);
    if (result) {
      return result;
    }
  }
  return null;
}
