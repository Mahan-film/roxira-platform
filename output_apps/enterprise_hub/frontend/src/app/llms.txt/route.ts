import { NextResponse, type NextRequest } from "next/server";

const ROXIRA_NET_LLMS_TXT = `# Roxira International Enterprise B2B Platform
> Cloud enterprise software for cross-border finance, invoicing, accounting, inventory, and automated settlements.

## Overview
Roxira International (roxira.net) provides modular, API-first enterprise services engineered for cross-border financial transactions, multi-jurisdiction tax compliance, and automated agentic operations (B2A).

- Base URL: https://roxira.net
- Contact: info@roxira.net
- Corporate Address: 543 Birch St, San Francisco, CA 94102, USA
- Protocols: REST (OpenAPI 3), Model Context Protocol (MCP)

## Authentication for AI Agents
Autonomous AI agents can provision scoped Bearer JWT credentials programmatically:
- Provisioning Endpoint: \`POST https://roxira.net/api/v1/provision-sandbox\`
- Payload: \`{"email": "agent@your-organization.com"}\`
- Returned Header: \`Authorization: Bearer <TOKEN>\`
- Rate Limit: 100 requests / day (Sandbox tier), scalable via \`info@roxira.net\`

## Model Context Protocol (MCP) Tool Server
Connect AI coding and reasoning agents (Claude, Cursor, LangGraph, OpenAI) using our deterministic tool manifest and execution endpoint:
- Tool Manifest URL: \`https://roxira.net/api/v1/mcp/manifest\`
- Tool Execution Endpoint: \`POST https://roxira.net/api/v1/mcp/execute\`
- Protocol Version: \`mcp-2024-11-05\`

### Tool Execution Example:
\`\`\`bash
curl -X POST https://roxira.net/api/v1/mcp/execute \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"tool":"issue_vat_invoice","parameters":{"currency":"EUR","vatRate":19,"items":[{"desc":"API Gateway License","qty":1,"price":12500}]}}'
\`\`\`

### Available Tools:
1. \`issue_vat_invoice\`: Compute VAT, validate tax rates (Reverse-Charge, 5%, 19%, 20%), and issue cryptographically hashed invoices.
2. \`post_double_entry_ledger\`: Post balanced general ledger journals with automated trial balance integrity verification.
3. \`calculate_fifo_valuation\`: Simulate FIFO outbound inventory dispatch and calculate Cost of Goods Sold (COGS).
4. \`update_crm_pipeline\`: Advance enterprise customer accounts across sales stages (Qualified, Due Diligence, Contract & KYB, Closed Won).
5. \`compute_late_payment_penalty\`: Calculate arbitration interest damages based on central bank indices and overdue duration.
6. \`query_compliance_graphrag\`: Query vector-and-graph compliance engine for cross-border settlement rules.

## Core REST Endpoints
- \`POST /api/backend/invoices\`: Create multi-currency invoice (Authenticated via Scoped Bearer JWT)
- \`POST /api/v1/sandbox/verify-computation\`: Server-side cryptographic audit hash verification
- \`GET /api/v1/mcp/manifest\`: Machine-readable tool server definition for AI agents
- \`POST /api/v1/mcp/execute\`: Direct tool execution endpoint for MCP agents
`;

const GHAZI_LLMS_TXT = `# قاضی هوشمند (Smart Judge Platform)
> پلتفرم تحلیل داده‌های حقوقی، تدوین راهبرد دادرسی و پایگاه جامع قوانین معتبر ایران.

## پایگاه دانش مستقر:
- بیش از ۴,۵۰۰ ماده قانونی معتبر (قانون مدنی، تجارت، مجازات اسلامی، آیین دادرسی مدنی و کیفری).
- آرای وحدت رویه هیأت عمومی دیوان عالی کشور (شماره ۱ تا ۸۸۰) مستند به ماده ۴۷۱ ق.آ.د.ک.
- مراجع نظارتی و انتظامی (قضات، وکلا، کارشناسان رسمی و نیروهای مسلح).

## قابلیت‌ها:
- ارزیابی شانس موفقیت پرونده‌های حقوقی و کیفری.
- تدوین لایحه دفاعیه منطبق بر آخرین رویه قضایی کشور.
- تفکیک خودکار قوانین معتبر از قوانین منسوخ.

## قوانین (Laws):
- فهرست کامل قوانین: https://ghazihoushmand.ir/laws (گروه‌بندی‌شده بر اساس نوع قانون).
- نشانی هر قانون: https://ghazihoushmand.ir/laws/{law}
- نشانی هر مادهٔ قانونی: https://ghazihoushmand.ir/laws/{law}/{article}

## آدرس دسترسی:
- وب‌سایت: https://ghazihoushmand.ir
`;

export async function GET(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase() || "";
  const isRoxiraNet = host.includes("roxira.net");

  const content = isRoxiraNet ? ROXIRA_NET_LLMS_TXT : GHAZI_LLMS_TXT;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
