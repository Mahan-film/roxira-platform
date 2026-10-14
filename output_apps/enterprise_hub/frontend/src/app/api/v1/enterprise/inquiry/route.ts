import { NextResponse } from "next/server";

const NEST_API_ORIGIN = (
  process.env.NEST_API_ORIGIN ?? "http://localhost:3000"
)
  .trim()
  .replace(/\/+$/, "");

const INQUIRIES_ENDPOINT = `${NEST_API_ORIGIN}/v1/enterprise/inquiries`;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^[0-9+\-\s()]{7,20}$/;

interface InquiryPayload {
  name?: unknown;
  company?: unknown;
  phone?: unknown;
  email?: unknown;
  message?: unknown;
  source?: unknown;
}

/**
 * Enterprise demo / sales inquiry endpoint.
 *
 * Validates the payload, then forwards the inquiry to the NestJS backend
 * (`POST /v1/enterprise/inquiries`, which persists it and rate-limits by IP)
 * and returns a tracking reference.
 */
export async function POST(request: Request) {
  let body: InquiryPayload;
  try {
    body = (await request.json()) as InquiryPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const company = typeof body.company === "string" ? body.company.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const source =
    typeof body.source === "string" && body.source.trim()
      ? body.source.trim()
      : "enterprise-hub";

  if (
    name.length < 2 ||
    company.length < 2 ||
    !PHONE_RE.test(phone) ||
    !EMAIL_RE.test(email)
  ) {
    return NextResponse.json({ error: "validation_failed" }, { status: 422 });
  }

  // The backend rate-limits by client IP. Without this, every inquiry would
  // arrive from this Next.js container's IP and share one bucket. The site is
  // reachable only through Cloudflare, which sets cf-connecting-ip itself.
  const clientIp =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "";
  const forwardHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (clientIp) {
    forwardHeaders["X-Forwarded-For"] = clientIp;
    forwardHeaders["CF-Connecting-IP"] = clientIp;
  }

  let backendResponse: Response;
  try {
    backendResponse = await fetch(INQUIRIES_ENDPOINT, {
      method: "POST",
      headers: forwardHeaders,
      body: JSON.stringify({
        name,
        company,
        phone,
        email,
        ...(message ? { message } : {}),
        source,
      }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "inquiry_backend_unreachable" },
      { status: 502 },
    );
  }

  if (!backendResponse.ok) {
    return NextResponse.json(
      { error: "inquiry_persist_failed" },
      { status: 502 },
    );
  }

  const data = (await backendResponse.json().catch(() => null)) as
    | { id?: number }
    | null;
  const backendId =
    data && typeof data.id === "number" ? data.id : undefined;
  const reference =
    backendId !== undefined
      ? `RQ-${backendId.toString(36).toUpperCase()}`
      : `RQ-${Date.now().toString(36).toUpperCase()}`;

  return NextResponse.json(
    {
      status: "received",
      reference,
      company,
      source,
      received_at: new Date().toISOString(),
    },
    { status: 202 },
  );
}
