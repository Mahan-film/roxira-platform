/**
 * Application tables. RULE: every tenant table has a NOT NULL `organization_id`, and is only
 * read/written through `orgRepo()` (src/lib/org-repo.ts) or a repository built on it, so every
 * query is filtered by the session's organization. Never trust a client-supplied organization id.
 *
 * Documented platform-level exceptions (no tenant yet, or provider-global): `waitlist`,
 * `webhook_events`.
 */
import { index, pgTable, text, timestamp, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerSubscriptionId: text("provider_subscription_id").notNull(),
    providerCustomerId: text("provider_customer_id"),
    planId: text("plan_id").notNull(),
    /** active | trialing | past_due | paused | canceled | incomplete */
    status: text("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("subscriptions_provider_sub_uq").on(t.provider, t.providerSubscriptionId),
    index("subscriptions_org_idx").on(t.organizationId),
  ],
);

/** Idempotency log for billing webhooks (provider-global, no tenant). */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("webhook_events_uq").on(t.provider, t.eventId)],
);

/** Pre-signup waitlist (no tenant yet). */
export const waitlist = pgTable("waitlist", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  locale: text("locale"),
  source: text("source"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
