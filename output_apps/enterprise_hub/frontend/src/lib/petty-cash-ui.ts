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

/**
 * Amount typed by the user as a plain number: digits (Latin or Persian), optional separators,
 * up to two decimals and strictly positive. Returns the cleaned text to send, or null when invalid.
 */
export function normalizeAmount(text: string): string | null {
  const t = text
    .replace(/[,٬\s]/g, "")
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(t)) return null;
  return /[1-9]/.test(t) ? t : null;
}
