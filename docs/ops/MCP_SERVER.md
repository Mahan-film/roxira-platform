# MCP Server (Enterprise Hub)

The NestJS backend (`output_apps/enterprise_hub/`) exposes an
[MCP](https://modelcontextprotocol.io) endpoint over the existing business modules
(CRM, HR, inventory, accounting, data-import). Every tool calls the owning module's
service — there is no direct SQL and no new write path. This is the "MCP server over
our modules" decision from `docs/strategy/SUITE_V2_COMPOSABLE_2026-10-22.md`.

## Endpoint

| Property | Value |
| --- | --- |
| Transport | Streamable HTTP (stateless, no session) |
| Method | `POST` only (JSON-RPC 2.0). `GET`/`DELETE` return `405` |
| Path | `/enterprise-hub/mcp` (controller) → `/v1/enterprise-hub/mcp` behind the global URI version prefix (`v1`) |
| Auth | `Authorization: Bearer <JWT>` (existing `JwtAuthGuard`) |
| Tenant | From the signed JWT `tenantId` claim only (`requireTenantId`) |

Direct backend URL: `http://<host>:3000/v1/enterprise-hub/mcp`.
Through the frontend proxy: `/api/backend/enterprise-hub/mcp`.
Through nginx/Cloudflare the public URL is `https://<host>/api/...` — point the agent
at whichever base is reachable from the agent host.

## Connecting an agent (bearer JWT)

The endpoint is protected by the same HS256 JWT issued by the Auth module. The agent
must send a valid token on **every** request. The tenant id is read only from the
`tenantId` claim — it is never taken from tool arguments, so a token cannot be used
to read another organization's data.

1. Obtain a token the same way the app does (`POST /v1/auth/verify-otp`), or reuse a
   session token. It must carry `tenantId` (and `tenantRole`/`role` for admin tools).
2. Configure the MCP client. Example (Claude Desktop / Cursor / `mcp.json` style):

```jsonc
{
  "mcpServers": {
    "roxira-enterprise-hub": {
      "type": "http",
      "url": "https://<host>/v1/enterprise-hub/mcp",
      "headers": {
        "Authorization": "Bearer <JWT>"
      }
    }
  }
}
```

3. Smoke-test with curl (Streamable HTTP, stateless):

```bash
curl -sS https://<host>/v1/enterprise-hub/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Without a token the request fails with `401`; with a token that has no `tenantId`
claim it fails with `403` (fail-closed).

## Tools

All list tools cap the result at **100 rows per call** regardless of the requested
`limit`. Tools marked *admin* call `requireTenantAdmin` (platform `ADMIN` or tenant
`OWNER`), the same check the REST controllers use.

### Read

| Tool | Input | Notes |
| --- | --- | --- |
| `crm_list_leads` | `search?`, `stage?`, `limit?` | Paginated leads |
| `crm_get_lead` | `id` | Single lead |
| `hr_list_employees` | `search?`, `limit?` | *admin* |
| `inventory_list_items` | `search?`, `limit?` | Stock items + low-stock flag |
| `inventory_stock` | `warehouseId` | Stock per warehouse |
| `accounting_trial_balance` | — | *admin* |
| `accounting_account_ledger` | `code`, `limit?` | *admin* |
| `import_list_entities` | — | Importable entities + fields |
| `import_list_batches` | — | *admin* (platform admin or tenant owner) |

### Propose (no write — human-in-the-loop)

Propose tools validate the input and return
`{ "kind": <string>, "payload": <object>, "warnings": [<string>] }`. They never write.
After the user reviews/approves the proposal in the UI, the actual write goes through
the existing REST endpoints (e.g. `POST /enterprise-hub/crm/leads`,
`POST /enterprise-hub/hr/employees`,
`POST /enterprise-hub/accounting/journal-entries`).

| Tool | Input | Notes |
| --- | --- | --- |
| `crm_propose_lead` | lead fields (`fullName`, `email`, …) | Warns on duplicate email |
| `hr_propose_employee` | employee fields (`firstName`, `nationalId`, …) | *admin*; warns on duplicate national id |
| `accounting_propose_journal` | `lines[]` (`accountCode`, `debit`, `credit`, `description?`) | *admin*; validates one-sided lines and debit = credit |

There are **no delete tools** and no tools that mutate data.

## Implementation notes

- Code lives in `output_apps/enterprise_hub/mcp/`:
  - `mcp.controller.ts` — route + `requireTenantId` enforcement.
  - `mcp-http.handler.ts` — per-request stateless `McpServer` + Streamable HTTP
    transport, tool registration and MCP result envelopes.
  - `mcp-tools.service.ts` — one method per tool, delegating to module services.
  - `mcp-sdk.ts` — loads the official `@modelcontextprotocol/sdk` and `zod`
    (`require()` because the SDK's `exports` map is not read by the tsconfig's
    classic Node resolution).
- Input schemas are declared with `zod`; tenant scope is enforced from the request,
  not from arguments.
- Tests: `mcp-tools.service.spec.ts` (unit, mocked services, one block per tool) and
  `mcp.controller.spec.ts` (auth + tenant isolation via supertest).

## Local checks

```bash
cd output_apps/enterprise_hub
npx tsc --noEmit -p .
npx jest mcp --passWithNoTests
```

The factory workbench runs `tsc --noEmit -p .` and
`jest --findRelatedTests <changed files>` automatically on commit.
