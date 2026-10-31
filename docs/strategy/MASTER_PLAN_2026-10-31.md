# Roxira master plan, 2026-10-31

Source: four owner-supplied research reports (agent operations, agent memory, product, data migration), checked against the live system. Report figures are claims until reproduced here.

## Live facts that override the reports

- Server: 4 vCPU, 8 GB RAM, 75 GB disk, 12 GB free (84%). Reports assumed 20 GB free and up to 32 GB RAM.
- PgBouncer 1.25.2. Docker log rotation already set (20 MB, 3 files). Reclaimable: about 8.5 GB images and 3 GB build cache.
- Current data is test data. The free-tier rule in AGENTS.md section 4 ends before real customers.

## Decisions

| Area | Decision |
|---|---|
| Product | Modular suite: core ledger, invoicing, Iranian tax, treasury, stock, Iranian payroll, AI copilot, then firm hub. Manufacturing starts as light BOM and work orders after day 90. Hardware gimmicks: never. |
| Market wedge | Accounting firms in Iran; self-serve onboarding; keyboard-first voucher entry. |
| Architecture | Keep the NestJS modular monolith with BullMQ and FastAPI workers. No microservices, Temporal, Inngest, Neo4j, Airbyte or local LLM. |
| Assistant | One deterministic state graph, not an agent swarm. Numbers only from deterministic tools and certified metrics, never free text-to-SQL. Every figure verified after generation; missing evidence means abstain. |
| Memory | Postgres-native episodic, bitemporal fact, procedural and document memory, with forced row-level security. No external memory server. |
| Autonomy | L0 read, L1 draft, L2 human approval, L3 bounded rules. Document text is untrusted and never reaches a turn with write tools. |
| Import | Upload directly to R2. Parse hostile binaries only in disposable sandboxes. Normalise to Parquet, reconcile with DuckDB, dry-run in Postgres, then commit with a signed report. Never write to a customer's live database. |
| Vector stores | Consolidate; do not run two stores for the same data without a reason. |
| Privacy | Before real data: masking proxy, provider allowlist by data class, Groq zero retention, OpenRouter `data_collection: deny`, Mistral opt-out, billed Gemini, no customer data to DeepSeek direct or unbilled tiers. |
| Report conflict | Reports disagree on DeepSeek for proprietary code. Rule: public or synthetic only until its terms are confirmed; repository code stays an owner decision. |

## Roadmap

1. **Stabilise (now):** merge the open queue one by one; reclaim disk; move uploads and backups off local disk; continuous WAL archive to R2.
2. **Isolation (weeks 1-3):** transaction-local tenant context, forced RLS, non-owner runtime role, composite tenant indexes, isolation tests through PgBouncer, Persian normalisation, masking proxy.
3. **Accounting completeness (weeks 2-6):** four-level chart, Jalali fiscal years and year close, 2 to 10 column trial balances, balance sheet, profit and loss, cash flow, ageing, cost centres, hash-chained audit log, effective-dated statutory parameters, Tamin list disk v6, property tests for ledger invariants.
4. **Import (weeks 3-8):** R2 multipart, sandbox extraction, Persian encodings, Sepidar playbook, retrieval plus two-model schema mapping, reconciliation, dry run, mapping memory.
5. **Assistant (weeks 6-12):** 25 certified metrics, value lookup, bitemporal memory, numeric validator, investigator agent, close copilot, anomaly rules, voice.
6. **Growth (day 60+):** firm hub, open banking aggregators, PC-POS bridge, public API and webhooks, shop connectors.
7. **Later (day 90+):** light manufacturing, fixed assets, contractor accounting, international tax, on-premise sync agent.

## Factory operating model

- Opus: architecture, review and final decisions. Sonnet: money, security and migrations. Haiku: small scoped work.
- OpenCode on the server with the key pool: repetitive tasks, once one real task proves it end to end.
- Antigravity: simple UI, always reviewed.
- At most three or four local sessions at once. Cross-family review before merge. One PR deploys at a time when it has migrations.
- Track cost per accepted change, rework rate and escape rate from the existing task queue.
- Before adopting a report's setting, confirm it against current official docs.

## Owner decisions needed

- Server upgrade: 8 GB RAM and 12 GB free cannot carry this roadmap.
- Iranian hosting: reports recommend a domestic production cell for roxira.ir. It affects cost, sanctions exposure and data law, so legal review comes first.
- Legal review of Moadian direct submission, data residency and any roxira.ir and roxira.net corporate separation.
- Provider privacy settings and billing that need owner accounts.
- Module prices and bundles.

## Not proven

Competitor claims, benchmark figures, bank and POS protocols, Sepidar and Rahkaran internals, and Iranian legal summaries in the reports need primary-source or live verification before they shape code or copy.
