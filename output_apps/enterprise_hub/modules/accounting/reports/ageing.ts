/**
 * Receivable and payable ageing from ledger lines (pure, integer minor units).
 *
 * Each (account, party) pair is aged on its own: a customer's debt never nets a payable. Items are
 * the lines that grow the balance (debits on the receivable side, credits on the payable side);
 * the other lines settle the oldest open items first (FIFO). A settlement larger than the open
 * items is kept as `unapplied` (an advance or overpayment) and is used by the next item.
 *
 * Age is counted in days from the line's date to `asOf`. Journal lines carry no due date, so this
 * is ageing by document date, not by days overdue.
 *
 * Known limit: a reversal is a settlement like any other, so it settles the oldest open item, not
 * necessarily the one it reverses. Totals per party stay exact; only the bucket split can differ.
 */

export type AgeingSide = 'receivable' | 'payable';

export const DEFAULT_AGEING_EDGES: readonly number[] = [30, 60, 90];

export interface AgeingLine {
  accountCode: string;
  accountName: string;
  partyCode: string | null;
  /** YYYY-MM-DD. */
  day: string;
  debit: bigint;
  credit: bigint;
}

export interface AgeingBucket {
  /** Inclusive lower bound in days. */
  fromDay: number;
  /** Inclusive upper bound in days; null for the last, open-ended bucket. */
  toDay: number | null;
}

export interface AgeingRow {
  accountCode: string;
  accountName: string;
  /** Null: lines without a party. Shown so the report adds up to the account balance. */
  partyCode: string | null;
  /** Open amount per bucket, same order as `AgeingReport.buckets`. */
  amounts: bigint[];
  /** Sum of `amounts`. */
  open: bigint;
  /** Settlements not matched to an item (advance received / paid). */
  unapplied: bigint;
  /** `open - unapplied`: the party's balance on its natural side. */
  balance: bigint;
  /** Date of the oldest open item, null when nothing is open. */
  oldestOpenDay: string | null;
}

export interface AgeingReport {
  side: AgeingSide;
  asOf: string;
  buckets: AgeingBucket[];
  rows: AgeingRow[];
  totals: Omit<AgeingRow, 'accountCode' | 'accountName' | 'partyCode' | 'oldestOpenDay'>;
}

export class AgeingInputError extends Error {}

const DAY_MS = 86_400_000;

function dayNumber(day: string): number {
  const time = Date.parse(`${day}T00:00:00.000Z`);
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day) {
    throw new AgeingInputError(`Invalid day "${day}": expected YYYY-MM-DD.`);
  }
  return time / DAY_MS;
}

/** Buckets from strictly increasing positive edges: [30, 60] -> 0-30, 31-60, 61+. */
export function ageingBuckets(edges: readonly number[]): AgeingBucket[] {
  edges.forEach((edge, index) => {
    if (!Number.isInteger(edge) || edge < 1 || (index > 0 && edge <= edges[index - 1])) {
      throw new AgeingInputError('Ageing edges must be strictly increasing positive whole days.');
    }
  });
  const buckets: AgeingBucket[] = [];
  let fromDay = 0;
  for (const edge of edges) {
    buckets.push({ fromDay, toDay: edge });
    fromDay = edge + 1;
  }
  buckets.push({ fromDay, toDay: null });
  return buckets;
}

function bucketIndex(buckets: AgeingBucket[], age: number): number {
  return buckets.findIndex((bucket) => bucket.toDay === null || age <= bucket.toDay);
}

interface OpenItem {
  day: string;
  remaining: bigint;
}

/**
 * Ages `lines` at `asOf`. Lines after `asOf` are ignored. Lines of one pair are taken in date
 * order; lines on the same day keep their input order (pass them ordered by entry and line id).
 */
export function ageing(
  lines: readonly AgeingLine[],
  options: { side: AgeingSide; asOf: string; edges?: readonly number[] },
): AgeingReport {
  const asOfNumber = dayNumber(options.asOf);
  const buckets = ageingBuckets(options.edges ?? DEFAULT_AGEING_EDGES);
  const sign = options.side === 'receivable' ? 1n : -1n;

  const groups = new Map<string, { first: AgeingLine; lines: Array<{ line: AgeingLine; at: number }> }>();
  for (const line of lines) {
    const at = dayNumber(line.day);
    if (at > asOfNumber) {
      continue;
    }
    const key = `${line.accountCode}\u0000${line.partyCode ?? ''}\u0000${line.partyCode === null ? 0 : 1}`;
    const group = groups.get(key) ?? { first: line, lines: [] };
    group.lines.push({ line, at });
    groups.set(key, group);
  }

  const rows: AgeingRow[] = [];
  for (const { first, lines: groupLines } of groups.values()) {
    // Array.prototype.sort is stable, so same-day lines keep their input order.
    groupLines.sort((a, b) => a.at - b.at);
    const open: OpenItem[] = [];
    let unapplied = 0n;
    for (const { line } of groupLines) {
      let amount = sign * (line.debit - line.credit);
      if (amount > 0n) {
        const used = amount < unapplied ? amount : unapplied;
        unapplied -= used;
        amount -= used;
        if (amount > 0n) {
          open.push({ day: line.day, remaining: amount });
        }
      } else if (amount < 0n) {
        let settle = -amount;
        while (settle > 0n && open.length > 0) {
          const item = open[0];
          const used = settle < item.remaining ? settle : item.remaining;
          item.remaining -= used;
          settle -= used;
          if (item.remaining === 0n) {
            open.shift();
          }
        }
        unapplied += settle;
      }
    }

    const amounts = buckets.map(() => 0n);
    for (const item of open) {
      amounts[bucketIndex(buckets, asOfNumber - dayNumber(item.day))] += item.remaining;
    }
    const openTotal = amounts.reduce((sum, value) => sum + value, 0n);
    if (openTotal === 0n && unapplied === 0n) {
      continue;
    }
    rows.push({
      accountCode: first.accountCode,
      accountName: first.accountName,
      partyCode: first.partyCode,
      amounts,
      open: openTotal,
      unapplied,
      balance: openTotal - unapplied,
      oldestOpenDay: open[0]?.day ?? null,
    });
  }

  rows.sort((a, b) => {
    if (a.accountCode !== b.accountCode) {
      return a.accountCode < b.accountCode ? -1 : 1;
    }
    if (a.partyCode === b.partyCode) {
      return 0;
    }
    if (a.partyCode === null) {
      return 1;
    }
    if (b.partyCode === null) {
      return -1;
    }
    return a.partyCode < b.partyCode ? -1 : 1;
  });

  const totals = {
    amounts: buckets.map((_, index) => rows.reduce((sum, row) => sum + row.amounts[index], 0n)),
    open: rows.reduce((sum, row) => sum + row.open, 0n),
    unapplied: rows.reduce((sum, row) => sum + row.unapplied, 0n),
    balance: rows.reduce((sum, row) => sum + row.balance, 0n),
  };
  return { side: options.side, asOf: options.asOf, buckets, rows, totals };
}
