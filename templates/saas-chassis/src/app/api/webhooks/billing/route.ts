import { NextResponse } from "next/server";
import { getBilling } from "@/lib/billing";
import { applyBillingEvent } from "@/lib/billing/subscriptions";
import { trackServer } from "@/lib/track-server";

export const runtime = "nodejs";

/** Single webhook endpoint for the active billing provider. Point the provider dashboard here. */
export async function POST(req: Request) {
  const raw = await req.text(); // signature is over the raw body - do not parse first
  const billing = getBilling();

  if (!billing.verifyWebhook(raw, req.headers)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event;
  try {
    event = billing.parseEvent(raw);
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  try {
    const fresh = await applyBillingEvent(billing.name, event);
    if (fresh && event.type === "subscription" && event.status === "active") {
      await trackServer("paid", { plan: event.planId });
    }
  } catch (err) {
    // 500 makes the provider retry; the idempotency row rolls back with the failed transaction.
    console.error("billing webhook failed", err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
