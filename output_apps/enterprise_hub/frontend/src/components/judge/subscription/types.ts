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

/** Real backend plan keys accepted by POST /payments/create-invoice (see
 * `get_calculated_pricing()` in smartjudge_module.py). Any UI option that
 * does not map to one of these must be shown as "coming soon", never wired
 * to a fake/local-only charge. */
export type BackendPlanType = "SINGLE_DRAFT" | "VIP_MONTHLY_PRO";

/** Shape of one entry in GET /payments/pricing-matrix's `plans` map. */
export interface BackendPlanPrice {
  name: string;
  base_usd: number;
  price_toman: number;
  price_rial: number;
  rate_usd_toman: number;
}

export interface PricingMatrixResponse {
  status: string;
  current_usd_rate_toman: number;
  plans: Partial<Record<BackendPlanType, BackendPlanPrice>>;
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
