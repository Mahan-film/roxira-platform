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

/** Shape of one entry in GET /payments/pricing-matrix's `plans` map. Prices
 * are fixed Toman amounts set server-side (W22) — there is no USD/exchange
 * rate involved anymore. */
export interface BackendPlanPrice {
  name: string;
  price_toman: number;
  price_rial: number;
}

export interface PricingMatrixResponse {
  status: string;
  plans: Partial<Record<BackendPlanType, BackendPlanPrice>>;
}

/** Format an integer with Persian digits and thousands separators. */
export function formatPersianNumber(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return safe.toLocaleString("fa-IR");
}
