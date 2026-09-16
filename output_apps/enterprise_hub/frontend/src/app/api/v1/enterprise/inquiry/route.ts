import { NextResponse } from "next/server";

const ALLOWED_TIERS = new Set(["starter", "business", "foundry"]);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface InquiryPayload {
  company?: unknown;
  phone?: unknown;
  email?: unknown;
  tier?: unknown;
  notes?: unknown;
  source?: unknown;
}

/**
 * Stub endpoint for enterprise demo / sales inquiries.
 * Validates the payload and issues a tracking reference; no persistence yet.
 */
export async function POST(request: Request) {
  let body: InquiryPayload;
  try {
    body = (await request.json()) as InquiryPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const company = typeof body.company === "string" ? body.company.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const tier = typeof body.tier === "string" ? body.tier : "";

  if (company.length < 2 || phone.length < 7 || !EMAIL_RE.test(email) || !ALLOWED_TIERS.has(tier)) {
    return NextResponse.json({ error: "validation_failed" }, { status: 422 });
  }

  const reference = `RQ-${Date.now().toString(36).toUpperCase()}`;
  return NextResponse.json(
    {
      status: "received",
      reference,
      tier,
      company,
      received_at: new Date().toISOString(),
    },
    { status: 202 },
  );
}
