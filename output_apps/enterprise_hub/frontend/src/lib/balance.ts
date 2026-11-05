/**
 * Balance side of an account: «بد» (debit), «بس» (credit) or «بی‌حساب» (zero).
 * `net` is debit minus credit in rials; exact decimal strings are accepted so large
 * amounts never pass through a float.
 */
export type BalanceSide = "debit" | "credit" | "zero";

export interface BalanceMarker {
  side: BalanceSide;
  label: "بد" | "بس" | "بی‌حساب";
  /** Unsigned decimal string. */
  abs: string;
}

export function balanceMarker(
  net: string | number | bigint | null | undefined,
): BalanceMarker | null {
  if (net === null || net === undefined) return null;
  let text: string;
  if (typeof net === "number") {
    if (!Number.isFinite(net)) return null;
    text = String(net);
  } else {
    text = String(net).trim();
  }
  const match = /^(-?)(\d+(?:\.\d+)?)$/.exec(text);
  if (!match) return null;
  const [, sign, abs] = match;
  if (/^0+(?:\.0+)?$/.test(abs)) return { side: "zero", label: "بی‌حساب", abs };
  return sign === "-"
    ? { side: "credit", label: "بس", abs }
    : { side: "debit", label: "بد", abs };
}
