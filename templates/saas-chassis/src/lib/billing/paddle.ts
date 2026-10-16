import { planIdForPrice, priceIdFor } from "@config/plans";
import { hmacHex, safeEqualHex } from "./crypto";
import type { BillingEvent, BillingProvider, SubscriptionStatus } from "./types";

const base = () =>
  process.env.PADDLE_ENV === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";

async function paddle<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.PADDLE_API_KEY;
  if (!key) throw new Error("PADDLE_API_KEY is not set");
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Paddle ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

const STATUS: Record<string, SubscriptionStatus> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  paused: "paused",
  canceled: "canceled",
};

interface PaddleSubscription {
  id: string;
  customer_id?: string;
  status?: string;
  custom_data?: { organization_id?: string } | null;
  items?: { price?: { id?: string } }[];
  current_billing_period?: { ends_at?: string } | null;
  scheduled_change?: { action?: string } | null;
}

export const paddleProvider: BillingProvider = {
  name: "paddle",

  async createCheckout(input) {
    const priceId = priceIdFor(input.planId, input.interval);
    if (!priceId) throw new Error(`No price configured for ${input.planId}/${input.interval}`);
    // A transaction's checkout.url requires a default payment link set in the Paddle dashboard.
    const out = await paddle<{ data: { checkout?: { url?: string } } }>("/transactions", {
      method: "POST",
      body: JSON.stringify({
        items: [{ price_id: priceId, quantity: 1 }],
        custom_data: { organization_id: input.organizationId },
      }),
    });
    const url = out.data.checkout?.url;
    if (!url) throw new Error("Paddle returned no checkout url (set a default payment link)");
    return { url };
  },

  async customerPortalUrl(customerId) {
    const out = await paddle<{ data: { urls: { general: { overview: string } } } }>(
      `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
      { method: "POST", body: "{}" },
    );
    return out.data.urls.general.overview;
  },

  verifyWebhook(rawBody, headers) {
    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    const header = headers.get("paddle-signature");
    if (!secret || !header) return false;
    const parts = Object.fromEntries(header.split(";").map((p) => p.split("=") as [string, string]));
    const ts = parts.ts;
    const h1 = parts.h1;
    if (!ts || !h1) return false;
    // Reject replays older than 5 minutes.
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
    return safeEqualHex(hmacHex(secret, `${ts}:${rawBody}`), h1);
  },

  parseEvent(rawBody): BillingEvent {
    const body = JSON.parse(rawBody) as { event_id: string; event_type: string; data: PaddleSubscription };
    if (!body.event_type.startsWith("subscription.")) return { id: body.event_id, type: "ignored" };
    const d = body.data;
    return {
      id: body.event_id,
      type: "subscription",
      organizationId: d.custom_data?.organization_id,
      providerSubscriptionId: d.id,
      providerCustomerId: d.customer_id,
      planId: planIdForPrice(d.items?.[0]?.price?.id),
      status: STATUS[d.status ?? ""] ?? "incomplete",
      currentPeriodEnd: d.current_billing_period?.ends_at
        ? new Date(d.current_billing_period.ends_at)
        : undefined,
      cancelAtPeriodEnd: d.scheduled_change?.action === "cancel",
    };
  },
};
