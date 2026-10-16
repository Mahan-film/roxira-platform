"use client";

/** Funnel events used by every product. Keep this list short and stable. */
export type FunnelEvent = "signup" | "activate" | "checkout_started" | "paid";

declare global {
  interface Window {
    umami?: { track: (name: string, data?: Record<string, unknown>) => void };
  }
}

/** Client-side event. No-op when Umami is not configured or blocked. */
export function track(event: FunnelEvent, data?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  window.umami?.track(event, data);
}
