/**
 * Pure helpers for the petty cash page. No React.
 */

/**
 * The latest ISO date among SETTLED transactions, or null when none settled.
 * Dates are ISO YYYY-MM-DD, so string comparison is order-correct.
 */
export function lastSettlementDate(
  transactions: ReadonlyArray<{ status: string; date: string }>,
): string | null {
  let latest: string | null = null;
  for (const row of transactions) {
    if (row.status !== "SETTLED") continue;
    if (latest === null || row.date > latest) latest = row.date;
  }
  return latest;
}
