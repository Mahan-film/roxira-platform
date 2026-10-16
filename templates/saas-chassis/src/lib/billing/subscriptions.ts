import { and, eq, inArray } from "drizzle-orm";
import { FREE_PLAN, getPlan, type Plan, type PlanLimits } from "@config/plans";
import { db } from "@/db";
import { subscriptions, webhookEvents } from "@/db/schema";
import { orgRepo } from "@/lib/org-repo";
import type { BillingEvent } from "./types";

const LIVE = ["active", "trialing", "past_due"];

/** Subscription rows of one organization (tenant-scoped). */
export async function listOrgSubscriptions(organizationId: string) {
  return orgRepo(subscriptions, organizationId).list();
}

/** The plan an organization is entitled to now; Free when there is no live subscription. */
export async function getOrgPlan(organizationId: string): Promise<Plan> {
  const rows = await orgRepo(subscriptions, organizationId).list(inArray(subscriptions.status, LIVE));
  const live = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return live ? getPlan(live.planId) : FREE_PLAN;
}

export class PlanLimitError extends Error {
  constructor(public limit: keyof PlanLimits, public max: number) {
    super(`Plan limit reached: ${limit} (max ${max}). Upgrade to continue.`);
  }
}

/** Throw PlanLimitError when `current` already meets the plan's limit for `limit`. */
export async function assertWithinLimit(
  organizationId: string,
  limit: keyof PlanLimits,
  current: number,
): Promise<void> {
  const plan = await getOrgPlan(organizationId);
  const max = plan.limits[limit];
  if (current >= max) throw new PlanLimitError(limit, max);
}

/**
 * Apply a verified webhook event. Idempotent: returns false if the event id was already seen.
 * The organization id comes from the provider payload we signed into checkout (custom data),
 * or from the existing subscription row.
 */
export async function applyBillingEvent(provider: string, event: BillingEvent): Promise<boolean> {
  // One transaction: if applying fails, the idempotency row rolls back so the retry is processed.
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({ provider, eventId: event.id })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (inserted.length === 0) return false;
    if (event.type !== "subscription" || !event.providerSubscriptionId) return true;

    const existing = (
      await tx
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.provider, provider),
            eq(subscriptions.providerSubscriptionId, event.providerSubscriptionId),
          ),
        )
        .limit(1)
    )[0];

    const organizationId = event.organizationId ?? existing?.organizationId;
    if (!organizationId) throw new Error("billing event without organization id");
    const planId = event.planId ?? existing?.planId;
    if (!planId) throw new Error("billing event with unknown price id (check PRICE_* env vars)");

    const values = {
      organizationId,
      provider,
      providerSubscriptionId: event.providerSubscriptionId,
      providerCustomerId: event.providerCustomerId ?? existing?.providerCustomerId ?? null,
      planId,
      status: event.status ?? "incomplete",
      currentPeriodEnd: event.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: event.cancelAtPeriodEnd ?? false,
      updatedAt: new Date(),
    };
    await tx
      .insert(subscriptions)
      .values(values)
      .onConflictDoUpdate({
        target: [subscriptions.provider, subscriptions.providerSubscriptionId],
        set: values,
      });
    return true;
  });
}
