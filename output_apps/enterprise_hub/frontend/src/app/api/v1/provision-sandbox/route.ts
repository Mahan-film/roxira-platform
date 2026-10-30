import { NextResponse } from "next/server";
import crypto from "crypto";
import net from "net";

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
function jwtSecret(): string {
  const secret = process.env.SANDBOX_JWT_SECRET;
  if (!secret) throw new Error("SANDBOX_JWT_SECRET is not set");
  return secret;
}

function base64UrlEncode(data: string | Buffer): string {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function generateScopedJwt(email: string): string {
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: email,
    iss: "roxira.net",
    aud: "roxira-api",
    scope: "sandbox:read_write mcp:tools",
    quota: "100_req_day",
    iat: now,
    exp: now + 30 * 86400, // 30 days valid
    jti: crypto.randomUUID(),
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac("sha256", jwtSecret())
    .update(signatureInput)
    .digest();

  const encodedSignature = base64UrlEncode(signature);
  return `${signatureInput}.${encodedSignature}`;
}

async function sendSmtpEmail({
  to,
  token,
}: {
  to: string;
  token: string;
}): Promise<{ ok: boolean; log: string }> {
  const smtpHost = process.env.SMTP_HOST || "roxira_mail";
  const smtpPort = Number(process.env.SMTP_PORT) || 25;
  const fromEmail = "info@roxira.net";
  const fromName = "Roxira International";

  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const messageId = `<${Date.now()}.${crypto.randomBytes(4).toString("hex")}@roxira.net>`;
  const dateStr = new Date().toUTCString();

  const htmlBody = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Your Roxira Enterprise Scoped API Key</title>
</head>
<body style="margin:0;padding:0;background-color:#070914;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f1f5f9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#070914;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#0c101c;border:1px solid #1e293b;border-radius:16px;overflow:hidden;box-shadow:0 10px 25px rgba(0,0,0,0.5);">
          <!-- Header Banner -->
          <tr>
            <td style="padding:32px 32px 24px 32px;background:linear-gradient(135deg,#1e1b4b,#0f172a);border-bottom:1px solid #1e293b;">
              <table width="100%">
                <tr>
                  <td>
                    <span style="display:inline-block;padding:8px 14px;background:#4f46e5;color:#ffffff;font-size:18px;font-weight:900;border-radius:10px;">R</span>
                    <span style="margin-left:10px;font-size:16px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Roxira International</span>
                    <div style="font-size:11px;color:#94a3b8;font-family:monospace;margin-top:2px;">roxira.net · Enterprise B2B Hub</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Body -->
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 12px 0;font-size:20px;font-weight:800;color:#ffffff;">Your Scoped API Credentials</h2>
              <p style="margin:0 0 20px 0;font-size:13px;line-height:1.6;color:#94a3b8;">
                Welcome to <strong>Roxira International</strong>. Your organization sandbox has been provisioned with access to the Multi-Currency E-Invoicing, Double-Entry General Ledger, FIFO Inventory, and Model Context Protocol (MCP) tool server.
              </p>

              <!-- Scoped JWT Box -->
              <div style="margin:20px 0;background-color:#05070e;border:1px solid #312e81;border-radius:10px;padding:16px;">
                <div style="font-size:11px;font-weight:700;color:#818cf8;text-transform:uppercase;margin-bottom:8px;">
                  Scoped Bearer JWT Token (Sandbox Tier · 100 req/day)
                </div>
                <div style="font-family:monospace;font-size:11px;line-height:1.4;word-break:break-all;color:#a5f3fc;background:#000000;padding:12px;border-radius:6px;border:1px solid #1e293b;">
                  ${token}
                </div>
              </div>

              <!-- cURL Quick Start -->
              <h3 style="margin:24px 0 8px 0;font-size:14px;font-weight:700;color:#ffffff;">Quick Start cURL Example</h3>
              <div style="background-color:#05070e;border:1px solid #1e293b;border-radius:10px;padding:14px;font-family:monospace;font-size:11px;line-height:1.5;color:#cbd5e1;overflow-x:auto;">
                curl -X POST https://roxira.net/api/backend/invoices \\<br>
                &nbsp;&nbsp;-H "Authorization: Bearer ${token.slice(0, 20)}..." \\<br>
                &nbsp;&nbsp;-H "Content-Type: application/json" \\<br>
                &nbsp;&nbsp;-d '{"currency":"EUR","amount":12500}'
              </div>

              <!-- AI Agent / MCP Info -->
              <div style="margin-top:24px;padding:16px;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.2);border-radius:10px;">
                <h4 style="margin:0 0 6px 0;font-size:13px;font-weight:700;color:#a5b4fc;">🤖 AI Agent & MCP Integration</h4>
                <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">
                  Connect Claude, LangGraph or Cursor AI agents directly to our deterministic tool server:<br>
                  <code style="color:#e2e8f0;background:#05070e;padding:2px 6px;border-radius:4px;display:inline-block;margin-top:4px;">
                    GET https://roxira.net/api/v1/mcp/manifest
                  </code>
                </p>
              </div>

              <div style="margin-top:30px;padding-top:20px;border-top:1px solid #1e293b;font-size:12px;color:#64748b;line-height:1.5;">
                <p style="margin:0 0 4px 0;">This token is valid for 30 calendar days for sandbox and testing workloads.</p>
                <p style="margin:0;">For production rate upgrades or SLA escalation, contact <a href="mailto:info@roxira.net" style="color:#818cf8;text-decoration:none;">info@roxira.net</a>.</p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background-color:#05070e;border-top:1px solid #1e293b;font-size:11px;color:#475569;line-height:1.4;">
              <strong>Roxira International B2B Hub</strong><br>
              543 Birch St, San Francisco, CA 94102, USA · <a href="https://roxira.net" style="color:#64748b;text-decoration:none;">roxira.net</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const rawEmail = [
    `Message-ID: ${messageId}`,
    `Date: ${dateStr}`,
    `From: "${fromName}" <${fromEmail}>`,
    `To: <${to}>`,
    `Subject: Your Roxira Enterprise Scoped API Key & AI Agent Access`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    `Roxira International - Scoped API Access`,
    `Bearer JWT Token:`,
    token,
    ``,
    `cURL example:`,
    `curl -X POST https://roxira.net/api/backend/invoices -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"currency":"EUR","amount":12500}'`,
    ``,
    `AI Agent MCP Manifest: https://roxira.net/api/v1/mcp/manifest`,
    `Docs: https://roxira.net/llms.txt`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    htmlBody,
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

    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid corporate email address." },
        { status: 400 },
      );
    }

    const clientIp =
      request.headers.get("cf-connecting-ip")?.trim() ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "127.0.0.1";

    // Generate real HMAC-SHA256 Scoped JWT
    const token = generateScopedJwt(email);
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    console.log(
      `[SANDBOX_PROVISION] Email: ${email} | IP: ${clientIp} | Hash: ${tokenHash.slice(0, 16)}`,
    );

    // Attempt real SMTP dispatch
    let emailDispatched = false;
    let emailLog = "";
    try {
      const emailResult = await sendSmtpEmail({ to: email, token });
      emailDispatched = emailResult.ok;
      emailLog = emailResult.log;
    } catch (err: unknown) {
      emailLog = `Dispatch exception: ${err instanceof Error ? err.message : String(err)}`;
    }

    const expiresAt = new Date(Date.now() + 30 * 86400 * 1000).toISOString();

    return NextResponse.json({
      success: true,
      email,
      token,
      emailDispatched,
      quota: "100 requests / day (Sandbox tier)",
      expiresAt,
      documentation: "https://roxira.net/llms.txt",
      mcpManifest: "https://roxira.net/api/v1/mcp/manifest",
      debugLog: emailDispatched ? "Email queued in Postfix relay" : emailLog,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
