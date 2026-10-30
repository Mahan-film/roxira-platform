import { NextResponse } from "next/server";

export async function GET() {
  const manifest = {
    name: "roxira-enterprise-tools",
    version: "1.1.0",
    description:
      "Deterministic B2B financial, invoicing, accounting, inventory, and legal arbitration tool server for AI agents.",
    protocol: "mcp-2024-11-05",
    authentication: {
      type: "bearer",
      header: "Authorization: Bearer <TOKEN>",
      provisioningUrl: "https://roxira.net/api/v1/provision-sandbox",
      documentationUrl: "https://roxira.net/llms.txt",
    },
    executionEndpoint: "https://roxira.net/api/v1/mcp/execute",
    tools: [
      {
        name: "issue_vat_invoice",
        description:
          "Issue and validate a VAT-compliant cross-border invoice with dynamic jurisdictional tax rates (EU 19%, UAE 5%, Reverse-Charge 0%) and cryptographic SHA-256 audit hashing.",
        parameters: {
          type: "object",
          properties: {
            items: {
              type: "array",
              description: "Line items in the invoice payload",
              items: {
                type: "object",
                properties: {
                  desc: { type: "string", description: "Service or commodity description" },
                  qty: { type: "number", description: "Unit quantity" },
                  price: { type: "number", description: "Unit price in specified currency" },
                },
                required: ["desc", "qty", "price"],
              },
            },
            vatRate: {
              type: "number",
              description: "Applicable VAT rate percentage (e.g. 0, 5, 19, 20)",
            },
            currency: {
              type: "string",
              description: "ISO 4217 currency code (e.g. EUR, USD, AED, GBP)",
            },
          },
          required: ["items", "vatRate", "currency"],
        },
      },
      {
        name: "post_double_entry_ledger",
        description:
          "Post double-entry balanced general ledger transactions and verify that total debits equal total credits for trial balance auditing.",
        parameters: {
          type: "object",
          properties: {
            reference: { type: "string", description: "External or internal voucher ID" },
            entries: {
              type: "array",
              description: "Journal line items",
              items: {
                type: "object",
                properties: {
                  account: { type: "string", description: "Account name and code" },
                  debit: { type: "number", description: "Debit amount" },
                  credit: { type: "number", description: "Credit amount" },
                },
                required: ["account", "debit", "credit"],
              },
            },
          },
          required: ["reference", "entries"],
        },
      },
      {
        name: "calculate_fifo_valuation",
        description:
          "Simulate outbound inventory dispatch queue using strict First-In-First-Out (FIFO) cost of goods sold (COGS) accounting across multi-region bonded warehouses.",
        parameters: {
          type: "object",
          properties: {
            warehouse: {
              type: "string",
              enum: [
                "EU-Central (Frankfurt)",
                "MENA-FreeZone (Jebel Ali, Dubai)",
                "TR-Transit (Istanbul Customs Hub)",
              ],
              description: "Target fulfillment warehouse facility",
            },
            dispatchQuantity: {
              type: "number",
              description: "Number of units to dispatch from available FIFO batch queue",
            },
          },
          required: ["warehouse", "dispatchQuantity"],
        },
      },
      {
        name: "update_crm_pipeline",
        description:
          "Advance enterprise B2B customer accounts through stages: Qualified, Due Diligence, Contract & KYB, and Closed Won.",
        parameters: {
          type: "object",
          properties: {
            dealId: { type: "string", description: "Unique enterprise deal ID (e.g. D-1)" },
            targetStage: {
              type: "string",
              enum: [
                "Qualified",
                "Due Diligence",
                "Contract & KYB",
                "Closed Won",
              ],
              description: "Target sales milestone stage",
            },
          },
          required: ["dealId", "targetStage"],
        },
      },
      {
        name: "compute_late_payment_penalty",
        description:
          "Compute commercial arbitration late-payment interest damages according to central bank reference rates and overdue calendar duration.",
        parameters: {
          type: "object",
          properties: {
            principal: { type: "number", description: "Outstanding debt amount" },
            overdueDays: { type: "number", description: "Overdue duration in calendar days" },
            annualIndexRate: {
              type: "number",
              description: "Statutory or contractual annual interest rate percentage"
            },
          },
          required: ["principal", "overdueDays", "annualIndexRate"],
        },
      },
      {
        name: "query_compliance_graphrag",
        description:
          "Query Roxira GraphRAG multi-jurisdiction compliance knowledge base for cross-border tax, reverse-charge, TRN verification, and settlement standards.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Compliance or tax policy question" },
            jurisdiction: {
              type: "string",
              description: "Relevant territory or legal framework (e.g. EU-VAT, UAE-FTA, UK-HMRC)"
            },
          },
          required: ["query"],
        },
      },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
