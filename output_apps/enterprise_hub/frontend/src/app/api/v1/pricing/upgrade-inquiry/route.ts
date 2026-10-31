import { handleUpgradeInquiry, type Lead, type Persisted } from "@/lib/upgrade-inquiry";
import crypto from "crypto";
import net from "net";

const NEST_API_ORIGIN = (process.env.NEST_API_ORIGIN ?? "http://localhost:3000")
  .trim()
  .replace(/\/+$/, "");
const INQUIRIES_ENDPOINT = `${NEST_API_ORIGIN}/v1/enterprise/inquiries`;

/** Store the lead in the NestJS inquiries module (the source of truth for leads). */
async function persistLead(
  lead: Lead,
  clientIp: string,
): Promise<Persisted> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Only the nginx-set X-Real-IP is trusted upstream (see resolveClientIp); forward it as the
  // single X-Forwarded-For entry. CF-Connecting-IP is client-controllable and is not forwarded.
  if (clientIp) headers["X-Forwarded-For"] = clientIp;
  try {
    const res = await fetch(INQUIRIES_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(lead),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = (await res.json().catch(() => null)) as { id?: number } | null;
    return { ok: true, id: typeof data?.id === "number" ? data.id : undefined };
  } catch {
    return { ok: false, status: 0 };
  }
}


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
  const fromName = "Roxira International";

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
    `Roxira International: request received`,
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
  const body = await request.json().catch(() => ({}));
  return handleUpgradeInquiry(body, request.headers, {
    persistLead,
    sendMail: sendSmtpEmail,
    ownerEmail: (process.env.LEAD_NOTIFY_EMAIL ?? "").trim(),
  });
}
