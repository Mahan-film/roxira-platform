/**
 * Single source of truth for plans: pricing page, limits and billing price ids.
 * Prices here are PLACEHOLDERS - the owner decides real prices. `priceEnv` holds the
 * NAME of the env var containing the provider's price id (Paddle price id / Lemon Squeezy
 * variant id); never put ids or keys in code.
 */
export type PlanId = "free" | "pro" | "team";
export type Interval = "month" | "year";

export interface PlanLimits {
  /** Max members in an organization. */
  members: number;
  /** Max API keys per organization. */
  apiKeys: number;
  /** AI requests per month per organization. */
  aiRequestsPerMonth: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Display price in USD; 0 = free. */
  priceMonthly: number;
  priceYearly: number;
  priceEnv?: Record<Interval, string>;
  features: string[];
  limits: PlanLimits;
  highlight?: boolean;
}

export const plans: Plan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Try it out",
    priceMonthly: 0,
    priceYearly: 0,
    features: ["1 team", "Up to 2 members", "Community support"],
    limits: { members: 2, apiKeys: 1, aiRequestsPerMonth: 50 },
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For individuals and small teams",
    priceMonthly: 19,
    priceYearly: 190,
    priceEnv: { month: "PRICE_PRO_MONTH", year: "PRICE_PRO_YEAR" },
    features: ["Up to 5 members", "API access", "Priority support"],
    limits: { members: 5, apiKeys: 5, aiRequestsPerMonth: 2000 },
    highlight: true,
  },
  {
    id: "team",
    name: "Team",
    tagline: "For growing companies",
    priceMonthly: 79,
    priceYearly: 790,
    priceEnv: { month: "PRICE_TEAM_MONTH", year: "PRICE_TEAM_YEAR" },
    features: ["Up to 25 members", "Higher limits", "Priority support"],
    limits: { members: 25, apiKeys: 25, aiRequestsPerMonth: 20000 },
  },
];

export const FREE_PLAN = plans[0] as Plan;

export function getPlan(id: string | null | undefined): Plan {
  return plans.find((p) => p.id === id) ?? FREE_PLAN;
}

/** Provider price id for a plan/interval (read from env at call time). */
export function priceIdFor(planId: PlanId, interval: Interval): string | undefined {
  const name = getPlan(planId).priceEnv?.[interval];
  return name ? process.env[name] || undefined : undefined;
}

/** Reverse lookup used by webhooks: provider price id -> plan id. */
export function planIdForPrice(priceId: string | undefined): PlanId | undefined {
  if (!priceId) return undefined;
  for (const p of plans) {
    if (!p.priceEnv) continue;
    for (const envName of Object.values(p.priceEnv)) {
      if (process.env[envName] && process.env[envName] === priceId) return p.id;
    }
  }
  return undefined;
}
