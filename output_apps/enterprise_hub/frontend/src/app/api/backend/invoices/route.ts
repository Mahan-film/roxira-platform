import { NextResponse } from "next/server";
import crypto from "crypto";

function jwtSecret(): string {
  const secret = process.env.SANDBOX_JWT_SECRET;
  if (!secret) throw new Error("SANDBOX_JWT_SECRET is not set");
  return secret;
}

function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) {
    str += "=";
  }
  return Buffer.from(str, "base64").toString("utf8");
}

function verifySandboxJwt(authHeader: string | null): { valid: boolean; email?: string } {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false };
  }

  const token = authHeader.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false };
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSig = crypto
    .createHmac("sha256", jwtSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  if (signature !== expectedSig) {
    return { valid: false };
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { valid: false };
    }
    return { valid: true, email: payload.sub };
  } catch {
    return { valid: false };
  }
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const auth = verifySandboxJwt(authHeader);

  if (!auth.valid) {
    return NextResponse.json(
      {
        error: "unauthorized",
        message: "Invalid or expired Bearer token. Provision a token at https://roxira.net/#modules",
        hint: "Include 'Authorization: Bearer <TOKEN>' header in your cURL request.",
      },
      { status: 401 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "EUR";
  const amount = typeof body.amount === "number" && body.amount > 0 ? body.amount : 12500;
  const items = Array.isArray(body.items) && body.items.length > 0
    ? body.items
    : [
        {
          desc: "Enterprise API High-Throughput Tier License",
          qty: 1,
          price: amount,
        },
      ];

  const vatRate = 19;
  const vatAmount = Number(((amount * vatRate) / 100).toFixed(2));
  const totalAmount = Number((amount + vatAmount).toFixed(2));

  // Multi-currency settlement reference rates
  const fxRates: Record<string, number> = {
    USD: 1.087,
    AED: 3.992,
    GBP: 0.854,
    TRY: 37.45,
    MYR: 4.82,
  };

  const baseInEur = currency === "EUR" ? amount : amount / (fxRates[currency] || 1);
  const settlementReference = {
    usdEquivalent: Number((baseInEur * fxRates.USD).toFixed(2)),
    aedEquivalent: Number((baseInEur * fxRates.AED).toFixed(2)),
    gbpEquivalent: Number((baseInEur * fxRates.GBP).toFixed(2)),
  };

  const timestamp = new Date().toISOString();
  const invoiceId = `INV-2026-EU-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const rawHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ invoiceId, amount, totalAmount, currency, timestamp, user: auth.email }))
    .digest("hex");
  const auditHash = `sha256:${rawHash.slice(0, 16)}...${rawHash.slice(-8)}`;

  return NextResponse.json(
    {
      success: true,
      status: "ISSUED_SANDBOX_VERIFIED",
      invoiceId,
      issuedTo: auth.email,
      currency,
      subtotal: amount,
      vat: {
        rate: `${vatRate}%`,
        amount: vatAmount,
        jurisdiction: "EU-Standard VAT (Reverse-Charge Qualified)",
      },
      totalAmount,
      items,
      settlementReference,
      auditHash,
      serverNode: "prod-frankfurt-1",
      timestamp,
      quota: {
        tier: "sandbox",
        dailyLimit: 100,
        remaining: 99,
        resetInHours: 24,
      },
    },
    { status: 201 },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}
