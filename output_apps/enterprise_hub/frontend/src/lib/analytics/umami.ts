/**
 * Umami (self-hosted, privacy-friendly) analytics helpers. See docs/ops/OBSERVABILITY.md.
 *
 * The tracker script is rendered ONLY when a website id is set for the current host:
 *   NEXT_PUBLIC_UMAMI_WEBSITE_ID        roxira.ir (default host)
 *   NEXT_PUBLIC_UMAMI_WEBSITE_ID_GHAZI  ghazihoushmand.ir
 * Website ids ship to the browser, so they are public values; never put a secret here.
 * NEXT_PUBLIC_* values are inlined at build time: pass them as Docker build args.
 */

export const ANALYTICS_EVENTS = [
  "chat_started",
  "answer_shown",
  "signup_completed",
  "checkout_started",
  "payment_success",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** Event payload: flat and non-personal (plan names, counts, booleans). Never phone numbers or message text. */
export type AnalyticsData = Record<string, string | number | boolean>;

export interface UmamiScriptConfig {
  src: string;
  websiteId: string;
  hostUrl: string;
}

const DEFAULT_SCRIPT_SRC = "/umami/script.js";
const DEFAULT_HOST_URL = "/umami";

/**
 * Tracker config for the current host, or null when no website id is set for it.
 * process.env.NEXT_PUBLIC_* must stay as literal property reads so Next.js can inline them.
 */
export function umamiScriptConfig(isGhazi: boolean): UmamiScriptConfig | null {
  const websiteId = isGhazi
    ? process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID_GHAZI
    : process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  if (!websiteId || websiteId.trim() === "") return null;
  return {
    src: process.env.NEXT_PUBLIC_UMAMI_SRC || DEFAULT_SCRIPT_SRC,
    websiteId: websiteId.trim(),
    hostUrl: process.env.NEXT_PUBLIC_UMAMI_HOST_URL || DEFAULT_HOST_URL,
  };
}

interface UmamiGlobal {
  track: (event: string, data?: AnalyticsData) => void;
}

/** Sends a custom event. No-op before the tracker loads or when blocked; never throws into the UI. */
export function track(event: AnalyticsEvent, data?: AnalyticsData): void {
  if (typeof window === "undefined") return;
  const umami = (window as Window & { umami?: UmamiGlobal }).umami;
  try {
    umami?.track(event, data);
  } catch {
    // analytics must never break the user flow
  }
}
