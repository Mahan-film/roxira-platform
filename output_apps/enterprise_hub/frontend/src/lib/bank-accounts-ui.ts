/**
 * Pure display logic for the bank accounts list (`/app/accounting/bank`).
 * Kept free of React so it can be unit-tested directly.
 */

import { BANK_LABELS, type BankCode } from "../types/banking";

/** Unreconciled rows on both sides: statement (bank) plus book (ledger). */
export function unreconciledCount(summary: {
  unmatchedStatementCount: number;
  unmatchedBookCount: number;
}): number {
  return summary.unmatchedStatementCount + summary.unmatchedBookCount;
}

/**
 * Greatest `txnDate` of the given statement lines as an ISO `YYYY-MM-DD` string,
 * or null when there are no lines. String comparison is correct for ISO dates.
 */
export function lastStatementDate(lines: Array<{ txnDate: string }>): string | null {
  let latest: string | null = null;
  for (const line of lines) {
    if (latest === null || line.txnDate > latest) latest = line.txnDate;
  }
  return latest;
}

/** Persian bank label for a bank code. */
export function bankLabel(code: BankCode): string {
  return BANK_LABELS[code];
}
