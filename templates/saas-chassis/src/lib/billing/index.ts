import { lemonSqueezyProvider } from "./lemonsqueezy";
import { paddleProvider } from "./paddle";
import { polarProvider } from "./polar";
import type { BillingProvider } from "./types";

export type { BillingEvent, BillingProvider, CheckoutInput } from "./types";

/** Active provider, chosen by BILLING_PROVIDER (default: paddle). */
export function getBilling(): BillingProvider {
  switch (process.env.BILLING_PROVIDER ?? "paddle") {
    case "paddle":
      return paddleProvider;
    case "lemonsqueezy":
      return lemonSqueezyProvider;
    case "polar":
      return polarProvider;
    default:
      throw new Error(`Unknown BILLING_PROVIDER: ${process.env.BILLING_PROVIDER}`);
  }
}
