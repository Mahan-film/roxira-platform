import { planIdForPrice, priceIdFor } from "@config/plans";
import { hmacHex, safeEqualHex } from "./crypto";
import type { BillingEvent, BillingProvider, SubscriptionStatus } from "./types";

const API = "https://api.lemonsqueezy.com/v1";

async function ls<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.LEMONSQUEEZY_API_KEY;
  if (!key) throw new Error("LEMONSQUEEZY_API_KEY is not set");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Lemon Squeezy ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

const STATUS: Record<string, SubscriptionStatus> = {
  active: "active",
  on_trial: "trialing",
  past_due: "past_due",
  unpaid: "past_due",
  paused: "paused",
  cancelled: "canceled",
  expired: "canceled",
};

interface LsPayload {
  meta: { event_name: string; custom_data?: { organization_id?: string } };
  data: {
    id: string;
    attributes: {
      customer_id?: number;
      variant_id?: number;
      status?: string;
      renews_at?: string | null;
      ends_at?: string | null;
      cancelled?: boolean;
      updated_at?: string;
    };
  };
}

export const lemonSqueezyProvider: BillingProvider = {
  name: "lemonsqueezy",

  async createCheckout(input) {
    const variant = priceIdFor(input.planId, input.interval);
    const store = process.env.LEMONSQUEEZY_STORE_ID;
    if (!variant) throw new Error(`No variant configured for ${input.planId}/${input.interval}`);
    if (!store) throw new Error("LEMONSQUEEZY_STORE_ID is not set");
    const out = await ls<{ data: { attributes: { url: string } } }>("/checkouts", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "checkouts",
          attributes: {
            checkout_data: { email: input.customerEmail, custom: { organization_id: input.organizationId } },
            product_options: { redirect_url: input.successUrl },
          },
          relationships: {
            store: { data: { type: "stores", id: store } },
            variant: { data: { type: "variants", id: variant } },
          },
        },
      }),
    });
    return { url: out.data.attributes.url };
  },

  async customerPortalUrl(customerId) {
    const out = await ls<{ data: { attributes: { urls: { customer_portal: string } } } }>(
      `/customers/${encodeURIComponent(customerId)}`,
    );
    return out.data.attributes.urls.customer_portal;
  },

  verifyWebhook(rawBody, headers) {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
    const sig = headers.get("x-signature");
    if (!secret || !sig) return false;
    return safeEqualHex(hmacHex(secret, rawBody), sig);
  },

  parseEvent(rawBody): BillingEvent {
    const p = JSON.parse(rawBody) as LsPayload;
    const a = p.data.attributes;
    // Lemon Squeezy has no event id; name + subscription + updated_at is stable per delivery.
    const id = `${p.meta.event_name}:${p.data.id}:${a.updated_at ?? ""}`;
    if (!p.meta.event_name.startsWith("subscription_")) return { id, type: "ignored" };
    const end = a.ends_at ?? a.renews_at;
    return {
      id,
      type: "subscription",
      organizationId: p.meta.custom_data?.organization_id,
      providerSubscriptionId: p.data.id,
      providerCustomerId: a.customer_id !== undefined ? String(a.customer_id) : undefined,
      planId: planIdForPrice(a.variant_id !== undefined ? String(a.variant_id) : undefined),
      status: STATUS[a.status ?? ""] ?? "incomplete",
      currentPeriodEnd: end ? new Date(end) : undefined,
      cancelAtPeriodEnd: a.cancelled === true,
    };
  },
};
