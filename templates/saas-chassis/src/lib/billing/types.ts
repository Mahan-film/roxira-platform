import type { Interval, PlanId } from "@config/plans";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "paused"
  | "canceled"
  | "incomplete";

export interface CheckoutInput {
  organizationId: string;
  planId: PlanId;
  interval: Interval;
  customerEmail: string;
  successUrl: string;
}

/** Provider-neutral webhook event. `type: "ignored"` events are acknowledged and dropped. */
export interface BillingEvent {
  /** Unique per delivery-worthy event; used for idempotency. */
  id: string;
  type: "subscription" | "ignored";
  organizationId?: string;
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  planId?: PlanId;
  status?: SubscriptionStatus;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
}

/** One interface, one adapter per merchant of record. Adapters use plain fetch, no SDK. */
export interface BillingProvider {
  readonly name: "paddle" | "lemonsqueezy" | "polar";
  createCheckout(input: CheckoutInput): Promise<{ url: string }>;
  customerPortalUrl(providerCustomerId: string): Promise<string>;
  /** Must verify the signature over the RAW body, in constant time. */
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  parseEvent(rawBody: string): BillingEvent;
}
