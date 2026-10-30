import { NextResponse } from "next/server";

import { escapeHtml, headerText } from "@/lib/mail-safe";
import crypto from "crypto";
import net from "net";

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

async function sendSmtpEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; log: string }> {
  const smtpHost = process.env.SMTP_HOST || "roxira_mail";
  const smtpPort = Number(process.env.SMTP_PORT) || 25;
  const fromEmail = "info@roxira.net";
  const fromName = "Roxira Enterprise Billing";

  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const messageId = `<${Date.now()}.${crypto.randomBytes(4).toString("hex")}@roxira.net>`;
  const dateStr = new Date().toUTCString();

  const rawEmail = [
    `Message-ID: ${messageId}`,
    `Date: ${dateStr}`,
    `From: "${fromName}" <${fromEmail}>`,
    `To: <${to}>`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    `Roxira International Proforma Invoice`,
    `Please view this email in an HTML-compatible client.`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    html,
    ``,
    `--${boundary}--`,
    ``,
  ].join("\r\n");

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let step = 0;
    let log = "";

    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, log: `Timeout connecting to ${smtpHost}:${smtpPort}` });
    }, 12000);

    socket.connect(smtpPort, smtpHost, () => {
      log += `Connected to ${smtpHost}:${smtpPort}\n`;
    });

    socket.on("data", (data) => {
      const resp = data.toString();
      log += `S: ${resp.trim()}\n`;

      if (step === 0 && resp.startsWith("220")) {
        step = 1;
        socket.write("EHLO roxira.net\r\n");
      } else if (step === 1 && resp.startsWith("250")) {
        step = 2;
        socket.write(`MAIL FROM:<${fromEmail}>\r\n`);
      } else if (step === 2 && resp.startsWith("250")) {
        step = 3;
        socket.write(`RCPT TO:<${to}>\r\n`);
      } else if (step === 3 && resp.startsWith("250")) {
        step = 4;
        socket.write("DATA\r\n");
      } else if (step === 4 && resp.startsWith("354")) {
        step = 5;
        socket.write(rawEmail + "\r\n.\r\n");
      } else if (step === 5 && resp.startsWith("250")) {
        step = 6;
        socket.write("QUIT\r\n");
        clearTimeout(timer);
        socket.end();
        resolve({ ok: true, log });
      } else if (resp.startsWith("4") || resp.startsWith("5")) {
        clearTimeout(timer);
        socket.end();
        resolve({ ok: false, log: `SMTP rejected: ${resp.trim()}` });
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, log: `Socket error: ${err.message}` });
    });
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const company = headerText(typeof body.company === "string" ? body.company : "Enterprise Client");
    const companyHtml = escapeHtml(company);
    const plan = typeof body.plan === "string" ? body.plan.toLowerCase() : "pro";
    const settlementMethod =
      typeof body.settlementMethod === "string" ? body.settlementMethod : "usdt_usdc";

    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid corporate email address." },
        { status: 400 },
      );
    }

    const proformaId = `PROFORMA-2026-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const planName = plan === "enterprise" ? "Enterprise B2B Hub Tier" : "Pro Agent & Developer Tier";
    const planPrice = plan === "enterprise" ? "$299 / month" : "$49 / month";

    const settlementName =
      settlementMethod === "usdt_usdc"
        ? "Instant Stablecoin Settlement (USDT / USDC on TRC20/ERC20)"
        : "International Corporate Wire (EUR / USD via SWIFT/SEPA)";

    const clientIp =
      request.headers.get("cf-connecting-ip")?.trim() ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "127.0.0.1";

    const customerHtml = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:40px 20px;background:#070914;font-family:-apple-system,sans-serif;color:#f1f5f9;">
  <div style="max-width:600px;margin:auto;background:#0c101c;border:1px solid #1e293b;border-radius:16px;padding:32px;">
    <div style="padding-bottom:16px;border-bottom:1px solid #1e293b;">
      <span style="background:#4f46e5;color:#fff;font-weight:900;padding:6px 12px;border-radius:8px;font-size:16px;">R</span>
      <span style="margin-left:8px;font-size:16px;font-weight:bold;color:#fff;">Roxira International B2B Hub</span>
    </div>
    <h2 style="color:#fff;margin-top:24px;">Proforma Invoice: ${proformaId}</h2>
    <p style="color:#94a3b8;font-size:13px;line-height:1.6;">
      Thank you for upgrading your organization to <strong>${planName}</strong> (${planPrice}).
      Your invoice is ready for settlement.
    </p>

    <div style="background:#05070e;border:1px solid #312e81;border-radius:10px;padding:16px;margin:20px 0;font-size:13px;">
      <div style="color:#818cf8;font-weight:bold;margin-bottom:8px;">INVOICE DETAILS</div>
      <div style="color:#cbd5e1;">Entity: <strong>${companyHtml}</strong></div>
      <div style="color:#cbd5e1;">Tier: <strong>${planName}</strong></div>
      <div style="color:#cbd5e1;">Amount Due: <strong style="color:#34d399;">${planPrice}</strong></div>
      <div style="color:#cbd5e1;">Settlement Method: <strong>${settlementName}</strong></div>
    </div>

    <div style="background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:16px;font-size:12px;color:#cbd5e1;line-height:1.5;">
      <strong>Settlement Instructions:</strong><br>
      To finalize activation and assign your dedicated tenant database shard, reply to this email or send your transaction hash / wire proof to <a href="mailto:info@roxira.net" style="color:#818cf8;">info@roxira.net</a>.
    </div>

    <div style="margin-top:24px;border-top:1px solid #1e293b;padding-top:16px;font-size:11px;color:#64748b;">
      Roxira International B2B Hub · 543 Birch St, San Francisco, CA 94102, USA
    </div>
  </div>
</body>
</html>`;

    const adminHtml = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;padding:20px;">
  <h2>🔔 New Plan Upgrade Inquiry Received</h2>
  <p><strong>Proforma ID:</strong> ${proformaId}</p>
  <p><strong>Company:</strong> ${companyHtml}</p>
  <p><strong>Email:</strong> ${email}</p>
  <p><strong>Plan:</strong> ${planName} (${planPrice})</p>
  <p><strong>Settlement:</strong> ${settlementName}</p>
  <p><strong>Client IP:</strong> ${clientIp}</p>
  <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
</body>
</html>`;

    // Dispatch email to customer
    await sendSmtpEmail({
      to: email,
      subject: `Proforma Invoice: ${planName} (${proformaId}) - Roxira International`,
      html: customerHtml,
    }).catch(() => null);

    // Dispatch notification to owner
    await sendSmtpEmail({
      to: "mahanpikasso@gmail.com",
      subject: `[LEAD] ${company} requested ${planName} (${proformaId})`,
      html: adminHtml,
    }).catch(() => null);

    return NextResponse.json({
      success: true,
      proformaId,
      company,
      email,
      plan: planName,
      price: planPrice,
      settlementMethod: settlementName,
      message: `Proforma invoice ${proformaId} generated and dispatched to ${email}.`,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
