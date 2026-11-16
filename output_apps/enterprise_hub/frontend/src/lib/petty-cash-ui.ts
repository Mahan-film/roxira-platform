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

const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

/**
 * Exact sum in minor units (hundredths of a rial) across items with an amount field.
 * Avoids any float arithmetic or Number() precision loss (Rule 8).
 * Supports exact rounding on fractional parts (banker's / round-half-up on third digit).
 */
export function sumMinorUnits(
  items: ReadonlyArray<{ amount?: number | string | bigint | null }>,
): bigint {
  let total = ZERO;
  for (const item of items) {
    if (item.amount === null || item.amount === undefined || item.amount === "") continue;
    if (typeof item.amount === "bigint") {
      total += item.amount;
      continue;
    }
    const t = String(item.amount).replace(/[,٬\s]/g, "");
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(t);
    if (!match) continue;
    const [, sign, intPart, fracPart = ""] = match;
    const firstTwo = fracPart.slice(0, 2).padEnd(2, "0");
    let cents = parseInt(firstTwo, 10);
    const thirdDigit = fracPart.length >= 3 ? parseInt(fracPart[2], 10) : 0;
    if (thirdDigit >= 5) {
      cents += 1;
    }
    const minor = BigInt(intPart) * HUNDRED + BigInt(cents);
    total += sign === "-" ? -minor : minor;
  }
  return total;
}

/**
 * Exact integer parse for Rial amounts (no float truncation, rejects non-digits).
 */
export function parseIntegerRial(text: string): bigint {
  const clean = text
    .replace(/[,٬\s]/g, "")
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  if (!clean || !/^\d+$/.test(clean)) return ZERO;
  return BigInt(clean);
}

/**
 * Format exact minor units (BigInt) as a decimal string suitable for formatReportMoney.
 */
export function minorToMajorString(minor: bigint): string {
  const isNeg = minor < ZERO;
  const abs = isNeg ? -minor : minor;
  const integer = abs / HUNDRED;
  const frac = abs % HUNDRED;
  const fracStr = frac === ZERO ? "" : `.${frac.toString().padStart(2, "0").replace(/0+$/, "")}`;
  return `${isNeg ? "-" : ""}${integer}${fracStr}`;
}

