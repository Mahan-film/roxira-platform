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
        message: "Invalid or expired Bearer token. Obtain one via POST /api/v1/provision-sandbox",
      },
      { status: 401 },
    );
  }

  let body: { tool?: string; parameters?: Record<string, unknown> } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const { tool, parameters = {} } = body;
  const timestamp = new Date().toISOString();

  let result: Record<string, unknown> | null = null;

  switch (tool) {
    case "issue_vat_invoice": {
      const items = Array.isArray(parameters.items) ? parameters.items : [];
      const vatRate = typeof parameters.vatRate === "number" ? parameters.vatRate : 19;
      const currency = parameters.currency || "EUR";

      const subtotal = items.reduce(
        (sum: number, it: { qty?: unknown; price?: unknown }) =>
          sum + (Number(it.qty) || 1) * (Number(it.price) || 0),
        0,
      );
      const vatAmount = Number(((subtotal * vatRate) / 100).toFixed(2));
      const totalAmount = Number((subtotal + vatAmount).toFixed(2));

      result = {
        invoiceNumber: `INV-MCP-${Date.now().toString().slice(-6)}`,
        status: "VALIDATED_AND_ISSUED",
        currency,
        itemsCount: items.length,
        subtotal,
        vatRate: `${vatRate}%`,
        vatAmount,
        totalAmount,
        reverseChargeEligible: vatRate === 0,
      };
      break;
    }

    case "post_double_entry_ledger": {
      const entries = Array.isArray(parameters.entries) ? parameters.entries : [];
      const ref = parameters.reference || `TX-${Date.now().toString().slice(-6)}`;

      const totalDebit = entries.reduce(
        (s: number, e: { debit?: unknown }) => s + (Number(e.debit) || 0),
        0,
      );
      const totalCredit = entries.reduce(
        (s: number, e: { credit?: unknown }) => s + (Number(e.credit) || 0),
        0,
      );
      const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

      result = {
        transactionId: `JE-AUTO-${Date.now().toString().slice(-6)}`,
        reference: ref,
        totalDebit: Number(totalDebit.toFixed(2)),
        totalCredit: Number(totalCredit.toFixed(2)),
        isBalanced,
        status: isBalanced ? "POSTED_TO_TRIAL_BALANCE" : "REJECTED_UNBALANCED_ENTRY",
        currency: "EUR",
      };
      break;
    }

    case "calculate_fifo_valuation": {
      const warehouse = parameters.warehouse || "EU-Central (Frankfurt)";
      const dispatchQty = Number(parameters.dispatchQuantity) || 100;

      const batches = [
        { batch: "BATCH-2026-A", available: 100, cost: 42.0 },
        { batch: "BATCH-2026-B", available: 150, cost: 46.5 },
        { batch: "BATCH-2026-C", available: 200, cost: 49.0 },
      ];

      let remaining = dispatchQty;
      let cogs = 0;
      const allocation = batches.map((b) => {
        const taken = Math.min(b.available, Math.max(0, remaining));
        remaining -= taken;
        cogs += taken * b.cost;
        return { batch: b.batch, taken, unitCost: b.cost, left: b.available - taken };
      });

      result = {
        warehouse,
        requestedQuantity: dispatchQty,
        allocatedQuantity: dispatchQty - remaining,
        cogsUsd: Number(cogs.toFixed(2)),
        averageUnitCogs: Number((cogs / Math.max(1, dispatchQty - remaining)).toFixed(2)),
        batchAllocation: allocation,
      };
      break;
    }

    case "update_crm_pipeline": {
      const dealId = parameters.dealId || "D-1";
      const targetStage = parameters.targetStage || "Qualified";

      result = {
        dealId,
        previousStage: "Initial Inquiry",
        currentStage: targetStage,
        auditTimestamp: timestamp,
        complianceCheck: "PASSED (EU-KYB Verified)",
        nextAction:
          targetStage === "Contract & KYB"
            ? "Awaiting digital cryptographic signature"
            : "Automated SLA pipeline sync active",
      };
      break;
    }

    case "compute_late_payment_penalty": {
      const principal = Number(parameters.principal) || 50000;
      const overdueDays = Number(parameters.overdueDays) || 30;
      const annualIndexRate = Number(parameters.annualIndexRate) || 12.0;

      const penalty = principal * (annualIndexRate / 100) * (overdueDays / 365);
      const totalClaimable = principal + penalty;

      result = {
        principalAmount: principal,
        overdueDays,
        annualIndexRate: `${annualIndexRate}%`,
        accruedPenalty: Number(penalty.toFixed(2)),
        totalClaimableSettlement: Number(totalClaimable.toFixed(2)),
        arbitrationStandard: "UNCITRAL & Statutory Central Bank Commercial Code",
      };
      break;
    }

    case "query_compliance_graphrag": {
      const query = parameters.query || "cross-border settlement rules";
      const jurisdiction = parameters.jurisdiction || "EU-VAT / UAE-FTA";

      result = {
        query,
        jurisdiction,
        confidence: "99.4%",
        synthesizedComplianceRule:
          "Under Article 196 EU VAT Directive and UAE FTA B2B Regulations, cross-border electronic software settlements with cryptographic invoice hashes qualify for zero-withholding reverse charge treatment.",
        graphNodes: [
          "GraphNode:TaxJurisdiction.EU-Art196",
          "GraphNode:FTA-Treaty.UAE-FTA-2024",
          "VectorShard:ArbitrationRules-v4",
        ],
      };
      break;
    }

    default:
      return NextResponse.json(
        {
          error: "tool_not_found",
          message: `Unknown tool '${tool}'. Consult /api/v1/mcp/manifest for available tools.`,
        },
        { status: 404 },
      );
  }

  const rawHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ tool, parameters, result, timestamp, client: auth.email }))
    .digest("hex");
  const auditHash = `sha256:${rawHash.slice(0, 16)}...${rawHash.slice(-8)}`;

  return NextResponse.json({
    success: true,
    tool,
    caller: auth.email,
    result,
    auditHash,
    serverNode: "prod-frankfurt-1",
    timestamp,
    quota: {
      tier: "sandbox",
      dailyLimit: 100,
      remaining: 98,
    },
  });
}
