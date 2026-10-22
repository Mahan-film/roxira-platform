# Suite v2: composable open-core + agent layer — decisions 2026-10-22

Input: the owner's research brief (open-core composable assembly: Formance/Blnk ledger, ERPNext,
Twenty, Docling, LangGraph/ADK, CopilotKit + AG-UI, MCP) and the owner's accounts (Qdrant Cloud x4,
Neon x4, Zilliz x5, Upstash, Turso, Daytona, Hopx, Modal with a card since 2026-10-22, Cloudflare).
Constraint: srv1 has 7.7 GB RAM and no room for a second heavy stack (LEAN_ARCHITECTURE_2026-10-22.md).

Rule: **heavy engines run off-box and scale to zero; srv1 keeps only the thin always-on layer.**
We wrap open-source engines behind our own API (headless), never fork their cores, and keep our IP
(Iran/US rules, agents, UI) in our own services — this also keeps AGPL/GPL obligations away from our code.

## Adopt / defer / reject

| Building block | Decision | Where it runs | Why |
| --- | --- | --- | --- |
| **IBM Docling** (MIT) for PDF/Excel/Word/photo → tables/JSON | **Adopt now** | **Modal** (serverless, scale to zero) behind `DOCLING_URL`; current vision-LLM path stays as fallback | Best open document parser; needs torch/GPU-class RAM, so never on srv1. Lets the upload limit rise (below). |
| **MCP server over our modules** (CRM, HR, accounting, inventory, invoicing, import) | **Adopt now** | srv1, inside the NestJS backend (thin) | Every module exposed as tenant-scoped tools: read tools free, write tools return a *proposal* the user approves (human-in-the-loop). Same tools serve our in-app assistant, external agents and the software factory. |
| **Agent orchestrator** (LangGraph; Google ADK where A2A matters) | **Adopt in phase 2b** | Python AI core (already on srv1, models via the key pool) | "Drop one file → plan of actions across CRM/inventory/accounting/HR → one approval screen." Built on the MCP tools above. |
| **CopilotKit + AG-UI** (MIT) generative UI | **Phase 3** | Frontend `/app` | After the orchestrator exists; renders approval cards and forms inside the app. |
| **Blnk / Formance ledger** (Apache/MIT, Go) | **Spike in phase 3, not now** | Neon Postgres (separate DB) if adopted | Our journal entries already work and are tenant-scoped; a ledger engine pays off for multi-currency / multi-book (IFRS + Iran) and high volume. Decide after the spike measures RAM and fit. |
| **ERPNext / Frappe** | **Reject** | — | Needs ~4 GB extra RAM + MariaDB stack; no Jalali or Moodian; we would fork it for Iran. Our modules cover phase 1–2. |
| **Twenty CRM** | **Keep stopped** | — | Our CRM is lighter and integrated; our own MCP server replaces Twenty's MCP. |
| **Daytona / Hopx sandboxes** | **Adopt for the software factory** | Their cloud | Agent code, tests and builds run in disposable sandboxes instead of srv1 Docker: less RAM/disk pressure, safer. Needs the owner's API keys. |
| **Qdrant Cloud x4** | Use | Cloud | #1 laws replica/failover (live); #2 tenant document vectors (DMS search) so tenant data never fills srv1. #3–4 spare failover. |
| **Neon x4** | Use | Cloud | #1 nightly restore check (live); #2 read replica target for BI/analytics; #3 ledger spike DB; #4 spare. |
| **Cloudflare** | Use more | Edge | Workers AI embeddings (live); **R2 for uploaded files** (10 GB free, no egress) instead of srv1 disk; cache rule for law pages. |
| Zilliz, Upstash, Turso | **Not now** | — | Overlap with Qdrant / local Redis / Postgres; more moving parts for no gain at our size. Revisit if a concrete need appears. |

## Upload limits (owner question: why 5 MB?)

5 MB was a safety cap because files were parsed in srv1 memory. New limits once Docling-on-Modal and
R2 are live: Excel/CSV 20 MB / 50,000 rows (streamed parse), PDF/images 25 MB (processed off-box),
per-tenant daily quota. Until then raise Excel/CSV to 10 MB / 20,000 rows (safe on srv1 today).

## Standards targets (from the brief, kept realistic)

Double-entry with multi-currency (IRR, USD, USDT) now; multi-book IFRS + Iranian standards with the
ledger spike; Moodian e-invoice (phase 3); ISO 20022 bank statement import (camt.053) in phase 2;
i18n: Persian RTL + English LTR, store UTC, render Jalali/Gregorian per user.

## Order

1. Now: Docling on Modal (after the Modal GPU parity check), limit raise, MCP server (read tools first).
2. Phase 2b: orchestrator "drop a file → approve a plan", invoicing + VAT (in progress), bank import.
3. Phase 3: AG-UI/CopilotKit, ledger spike, Moodian, payroll, Daytona for the factory.
