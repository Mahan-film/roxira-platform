# Roxira Accounting: first factory product (2026-10-30)

Owner goal: an advanced accounting system, roxira.ir for Iran and roxira.net for international companies, built by the
software factory as its first measured product.

## 1. Decision
Keep the own NestJS suite. Do not move to ERPNext, Odoo or Bigcapital. This confirms
`docs/strategy/ROXIRA_BUSINESS_SUITE_2026-10-22.md` with fresher evidence.

| Option | Verdict | Reason |
| --- | --- | --- |
| Own suite | **Keep** | Live and multi-tenant, about 26k lines across accounting, invoicing, inventory, CRM, HR, tax and banking, with Jalali dates, AI import and a Moadian client |
| ERPNext | Reject as core | Second stack on MariaDB, about 4 GB RAM from a vendor estimate, our tenant and Moadian work would be redone. Possible separate deployment for a manufacturing customer |
| Odoo | Reject | Sources disagree on Community accounting depth, and the deeper features sit in the paid edition |
| Bigcapital | Reject as core, read as reference | AGPL means changes to a hosted modified version must be shared unless a commercial licence is bought; second stack on MariaDB. The ClickHouse claim in the owner's note was not confirmed |

Reuse without adopting: read their schemas, report layouts and tests. Use MIT or Apache libraries only, each one
pinned and scanned.

## 2. Phases
Each item is one factory task with acceptance tests, a cross-family review and a recorded cost.

**Phase 0, truth (1 week).** Remove the fake `sandbox` and `mcp` responses from roxira.net (`prod-frankfurt-1`,
`PASSED (EU-KYB Verified)`) and any public claim the product cannot back. Audit the ledger: enforce balanced entries,
immutable posted entries with reversal only, period locks, tenant isolation and concurrency tests.

**Phase 1, Iran on roxira.ir.** Invoice to automatic journal, VAT, receipts and payments, bank reconciliation, profit and
loss, balance sheet, fiscal close, electronic ledger export, Moadian on its test environment with `MOADIAN_ENABLED`
off in production until verified. Sayad cheque handling after a legal check.

**Phase 2, international on roxira.net.** English app, real multi-currency with dated rates from a named source,
realised and unrealised FX gain or loss, tax profiles per country, MyInvois only when a paying customer needs it.

**Phase 3, AI layer.** Document to draft entry, never auto-posted without user approval. Questions over the books through
the existing MCP server, tenant-scoped and read-only by default.

## 3. Factory measure
Target: one accepted task per day at under $0.50 average, with review pass rate reported weekly. Numbers are recorded per
phase in `docs/STATE.md`, and a task that fails review twice goes to a human or to Claude.

## 4. Rules
Money uses decimal types, never floats. Every table has a tenant column and repository-level checks. Migrations land
only through reviewed PRs. No accounting or tax rule ships without a test citing its source.
