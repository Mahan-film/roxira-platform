import net from "net";

import { escapeHtml, headerText } from "./mail-safe.ts";

export const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
export const PHONE_RE = /^[0-9+\-\s()]{7,20}$/;
/** Same bound as `create-inquiry.dto.ts` (email MaxLength 150). */
export const MAX_EMAIL_LENGTH = 150;

export const PLANS: Record<string, string> = {
  api: "API early access",
  pro: "Pro Agent & Developer tier",
  enterprise: "Enterprise B2B Hub tier",
};

export type Persisted = { ok: true; id?: number } | { ok: false; status: number };
export type MailResult = { ok: boolean; log: string };
export type Lead = { name: string; company: string; phone: string; email: string; message: string; source: string };

export interface InquiryDeps {
  persistLead: (lead: Lead, clientIp: string) => Promise<Persisted>;
  /** Owner mailbox for lead notices (env LEAD_NOTIFY_EMAIL); empty means owner mail is off. */
  ownerEmail: string;
  sendMail: (mail: { to: string; subject: string; html: string }) => Promise<MailResult>;
}

/**
 * Client IP for the backend rate limit. Only `X-Real-IP` is read: nginx overwrites it with
 * `$remote_addr` (the real-IP-resolved peer). `CF-Connecting-IP` and `X-Forwarded-For` are
 * client-controllable (roxira.ir is not behind Cloudflare) and are never trusted here.
 */
export function resolveClientIp(headers: Pick<Headers, "get">): string {
  const value = headers.get("x-real-ip")?.trim() ?? "";
  return net.isIP(value) ? value : "";
}

/** A backend outage (unreachable or 5xx) is the only case where mail may stand in for storage. */
export function isBackendOutage(status: number): boolean {
  return status === 0 || status >= 500;
}

const json = (body: Record<string, unknown>, status: number) => Response.json(body, { status });

export async function handleUpgradeInquiry(
  rawBody: unknown,
  headers: Pick<Headers, "get">,
  deps: InquiryDeps,
): Promise<Response> {
  const body = (rawBody && typeof rawBody === "object" ? rawBody : {}) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const name = headerText(typeof body.name === "string" ? body.name : "", 150);
  const company = headerText(typeof body.company === "string" ? body.company : "", 150);
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const planKey = typeof body.plan === "string" ? body.plan.toLowerCase() : "";
  const plan = planKey in PLANS ? planKey : "api";
  const planName = PLANS[plan];

  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
    return json({ success: false, error: "Please enter a valid corporate email address." }, 400);
  }
  if (name.length < 2 || company.length < 2 || !PHONE_RE.test(phone)) {
    return json({ success: false, error: "Please enter your name, company and a phone number." }, 400);
  }

  const persisted = await deps.persistLead(
    { name, company, phone, email, message: `Requested: ${planName}`, source: `upgrade-inquiry-${plan}` },
    resolveClientIp(headers),
  );

  if (!persisted.ok) {
    if (persisted.status === 429) {
      return json({ success: false, error: "Too many requests. Please try again later." }, 429);
    }
    // The backend answered and refused the lead (validation, auth, throttle): no mail, to anyone.
    if (!isBackendOutage(persisted.status)) {
      const status = persisted.status === 400 || persisted.status === 422 ? 400 : 502;
      return json(
        {
          success: false,
          error:
            status === 400
              ? "We could not accept these details. Please check them and try again."
              : "We could not record your request. Please email info@roxira.net.",
        },
        status,
      );
    }
  }

  const reference =
    persisted.ok && persisted.id !== undefined ? `RQ-${persisted.id.toString(36).toUpperCase()}` : null;
  const companyHtml = escapeHtml(company);

  const adminHtml = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;padding:20px;">
  <h2>New request from roxira.net</h2>
  <p><strong>Request:</strong> ${escapeHtml(planName)}</p>
  <p><strong>Name:</strong> ${escapeHtml(name)}</p>
  <p><strong>Company:</strong> ${companyHtml}</p>
  <p><strong>Email:</strong> ${escapeHtml(email)}</p>
  <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
  <p><strong>Stored in database:</strong> ${persisted.ok ? `yes (${reference})` : "NO, database write failed"}</p>
  <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
</body>
</html>`;

  const customerHtml = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;padding:20px;">
  <h2>We received your request</h2>
  <p>Thank you, ${escapeHtml(name)}. We received your request (${escapeHtml(planName)}) for ${companyHtml}
  and will contact you by email or phone.</p>
  <p>This message is not an invoice. No account, key or subscription has been created.</p>
  <p>Roxira International, info@roxira.net</p>
</body>
</html>`;

  const safe = (p: Promise<MailResult>): Promise<MailResult> => p.catch(() => ({ ok: false, log: "exception" }));
  const ownerMail: Promise<MailResult> = EMAIL_RE.test(deps.ownerEmail)
    ? safe(deps.sendMail({ to: deps.ownerEmail, subject: `[LEAD] ${company}: ${planName}`, html: adminHtml }))
    : Promise.resolve({ ok: false, log: "not sent: LEAD_NOTIFY_EMAIL unset or invalid" });
  // The customer address is mailed only once the backend has accepted (validated and stored) the lead.
  const customerMail: Promise<MailResult> = persisted.ok
    ? safe(
        deps.sendMail({
          to: email,
          subject: "Roxira International: we received your request",
          html: customerHtml,
        }),
      )
    : Promise.resolve({ ok: false, log: "not sent: lead not stored" });
  const [owner, customer] = await Promise.all([ownerMail, customerMail]);

  // A stored lead survives mail failure; an unstored one is safe only if it reached the owner's inbox.
  if (!persisted.ok && !owner.ok) {
    console.error(`[UPGRADE_INQUIRY] lead lost: backend status=${persisted.status}, owner mail failed`);
    return json({ success: false, error: "We could not record your request. Please email info@roxira.net." }, 502);
  }

  return json(
    {
      success: true,
      reference,
      plan: planName,
      stored: persisted.ok,
      ownerNotified: owner.ok,
      confirmationEmailSent: customer.ok,
      message: owner.ok
        ? "Request received. We will contact you. No invoice or key has been issued."
        : "Request stored. Email notification could not be sent, so we may take longer to see it. No invoice or key has been issued.",
    },
    200,
  );
}
