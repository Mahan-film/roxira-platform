import type { BillingProvider } from "./types";

const todo = (): never => {
  throw new Error("Polar adapter is a stub: implement BillingProvider in src/lib/billing/polar.ts");
};

/** Optional stub. Implement the four methods against Polar's API when a product needs it. */
export const polarProvider: BillingProvider = {
  name: "polar",
  createCheckout: async () => todo(),
  customerPortalUrl: async () => todo(),
  verifyWebhook: () => false,
  parseEvent: () => todo(),
};
