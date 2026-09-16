/** Shared types/formatting for the smartjudge subscription & quota UI. */

export type PlanTier = "عادی" | "طلایی" | "حقوقی";

export type SubscriptionKind = "monthly" | "annual" | "tokens";

export interface SubscriptionSelection {
  kind: SubscriptionKind;
  id: string;
  label: string;
  usd: number;
  tokens?: number;
}

/** Format an integer with Persian digits and thousands separators. */
export function formatPersianNumber(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return safe.toLocaleString("fa-IR");
}

/** USD → Toman conversion rate (auto-refreshable via env). */
export function tomanRate(): number {
  const parsed = Number(process.env.NEXT_PUBLIC_USD_TOMAN_RATE ?? "90000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90000;
}

/** Convert a hedged USD price into Toman at the current rate. */
export function usdToToman(usd: number): number {
  return Math.round(usd * tomanRate());
}

/** "۹۰۰٬۰۰۰ تومان" style formatted price. */
export function formatToman(usd: number): string {
  return `${formatPersianNumber(usdToToman(usd))} تومان`;
}
