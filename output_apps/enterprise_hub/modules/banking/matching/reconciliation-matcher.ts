import {
  DEFAULT_MATCH_WINDOW_DAYS,
  MATCH_AMOUNT_TOLERANCE,
  MIN_REFERENCE_LENGTH,
} from '../constants/banking.constants';

/** Statement line as the matcher sees it (bank's point of view). */
export interface MatchableStatementLine {
  id: number;
  /** `YYYY-MM-DD`. */
  txnDate: string;
  withdrawal: number;
  deposit: number;
  reference: string | null;
}

/** Ledger line on the bank's GL account (book's point of view). */
export interface MatchableBookLine {
  id: number;
  date: Date;
  debit: number;
  credit: number;
  entryNumber: string;
  description: string | null;
  entryDescription?: string | null;
}

export interface ProposedMatch {
  statementLineId: number;
  journalLineId: number;
  byReference: boolean;
}

export interface MatchProposal {
  matches: ProposedMatch[];
  /** Statement lines with several equally good candidates, left for a person to pick. */
  ambiguous: number[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Persian/Arabic digits to ASCII, everything else dropped except letters/digits. */
export function normaliseReference(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const ascii = value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
  return ascii.replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
}

/** Days between a `YYYY-MM-DD` date and a ledger timestamp, compared by calendar day (UTC). */
export function dayDistance(txnDate: string, bookDate: Date): number {
  const statementDay = Date.parse(`${txnDate.slice(0, 10)}T00:00:00Z`);
  const book = new Date(bookDate);
  const bookDay = Date.UTC(
    book.getUTCFullYear(),
    book.getUTCMonth(),
    book.getUTCDate(),
  );
  return Math.round(Math.abs(statementDay - bookDay) / DAY_MS);
}

/** Statement deposit = book debit on the bank account; withdrawal = book credit. */
export function amountsAgree(
  statement: Pick<MatchableStatementLine, 'withdrawal' | 'deposit'>,
  book: Pick<MatchableBookLine, 'debit' | 'credit'>,
): boolean {
  const deposit = Number(statement.deposit) || 0;
  const withdrawal = Number(statement.withdrawal) || 0;
  if (deposit > 0 && withdrawal === 0) {
    return book.credit === 0 && Math.abs(book.debit - deposit) <= MATCH_AMOUNT_TOLERANCE;
  }
  if (withdrawal > 0 && deposit === 0) {
    return book.debit === 0 && Math.abs(book.credit - withdrawal) <= MATCH_AMOUNT_TOLERANCE;
  }
  return false;
}

/** The statement reference (>= 4 chars) appears in the entry number or a description. */
export function referenceAppears(
  reference: string | null,
  book: MatchableBookLine,
): boolean {
  const ref = normaliseReference(reference);
  if (ref.length < MIN_REFERENCE_LENGTH) {
    return false;
  }
  return [book.entryNumber, book.description, book.entryDescription].some(
    (text) => normaliseReference(text).includes(ref),
  );
}

/**
 * Proposes one-to-one matches between unmatched statement lines and unmatched book lines.
 *
 * A candidate must have the same direction and amount (±1 rial) and fall within the date window.
 * A candidate whose text carries the statement's reference number wins; otherwise the closest date
 * wins. When the best candidates tie (same reference status and distance), the statement line is
 * reported as ambiguous and left alone: a wrong auto-match is worse than a manual one.
 */
export function proposeMatches(
  statementLines: MatchableStatementLine[],
  bookLines: MatchableBookLine[],
  windowDays: number = DEFAULT_MATCH_WINDOW_DAYS,
): MatchProposal {
  const taken = new Set<number>();
  const matches: ProposedMatch[] = [];
  const ambiguous: number[] = [];

  // Lines carrying a reference go first so a reference match is never stolen by a date-only match.
  const ordered = [...statementLines].sort((a, b) => {
    const refA = normaliseReference(a.reference).length >= MIN_REFERENCE_LENGTH ? 0 : 1;
    const refB = normaliseReference(b.reference).length >= MIN_REFERENCE_LENGTH ? 0 : 1;
    return refA - refB || a.txnDate.localeCompare(b.txnDate) || a.id - b.id;
  });

  for (const statement of ordered) {
    const candidates = bookLines
      .filter((book) => !taken.has(book.id))
      .filter((book) => amountsAgree(statement, book))
      .map((book) => ({
        book,
        distance: dayDistance(statement.txnDate, book.date),
        byReference: referenceAppears(statement.reference, book),
      }))
      .filter((candidate) => candidate.distance <= windowDays)
      .sort(
        (a, b) =>
          Number(b.byReference) - Number(a.byReference) ||
          a.distance - b.distance ||
          a.book.id - b.book.id,
      );

    if (candidates.length === 0) {
      continue;
    }
    const [best, runnerUp] = candidates;
    if (
      runnerUp &&
      runnerUp.byReference === best.byReference &&
      runnerUp.distance === best.distance
    ) {
      ambiguous.push(statement.id);
      continue;
    }
    taken.add(best.book.id);
    matches.push({
      statementLineId: statement.id,
      journalLineId: best.book.id,
      byReference: best.byReference,
    });
  }

  return { matches, ambiguous };
}

/** Statement line fields the closing-balance helper needs. */
export interface BalanceLine {
  id: number;
  txnDate: string;
  withdrawal: number;
  deposit: number;
  balance: number | null;
}

/**
 * Bank closing balance of a set of statement lines.
 *
 * Exports are oldest-first or newest-first, so the import order (`id`) is checked against the
 * running balance: whichever direction explains more consecutive pairs
 * (`balance[n] = balance[n-1] + deposit[n] - withdrawal[n]`) is taken as chronological. The last
 * reported balance in that order, plus the net of any later lines without a balance, is the closing
 * balance. Without any reported balance it is `openingBalance` plus the net of all lines.
 */
export function bankClosingBalance(
  lines: BalanceLine[],
  openingBalance = 0,
): number {
  const byId = [...lines].sort(
    (a, b) => a.txnDate.localeCompare(b.txnDate) || a.id - b.id,
  );
  const net = (line: BalanceLine) =>
    (Number(line.deposit) || 0) - (Number(line.withdrawal) || 0);
  const consistent = (ordered: BalanceLine[]) => {
    let hits = 0;
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1].balance;
      const current = ordered[index].balance;
      if (previous === null || current === null) {
        continue;
      }
      if (Math.abs(Number(previous) + net(ordered[index]) - Number(current)) <= MATCH_AMOUNT_TOLERANCE) {
        hits += 1;
      }
    }
    return hits;
  };
  // Newest-first exports: same dates, reversed id order within each day.
  const reversedWithinDay = [...lines].sort(
    (a, b) => a.txnDate.localeCompare(b.txnDate) || b.id - a.id,
  );
  const chronological =
    consistent(reversedWithinDay) > consistent(byId) ? reversedWithinDay : byId;

  let closing = Number(openingBalance) || 0;
  for (const line of chronological) {
    closing = line.balance !== null ? Number(line.balance) : closing + net(line);
  }
  return Math.round(closing * 100) / 100;
}
