import "server-only";

/**
 * Server-side funnel event to Umami (for events that happen without a browser, e.g. `paid`
 * from a webhook, `signup` from an auth hook). Never throws; analytics must not break a request.
 */
export async function trackServer(
  event: "signup" | "activate" | "checkout_started" | "paid",
  data?: Record<string, unknown>,
): Promise<void> {
  const base = process.env.NEXT_PUBLIC_UMAMI_URL;
  const website = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  if (!base || !website) return;
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost";
    await fetch(`${base.replace(/\/$/, "")}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "chassis-server/1.0" },
      body: JSON.stringify({
        type: "event",
        payload: { website, hostname: new URL(appUrl).hostname, url: "/", name: event, data },
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* ignore */
  }
}
