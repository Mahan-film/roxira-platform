# Deep-research prompts R22-R25 (two stages each)

How to use: open Gemini web, Deep Research mode. Send STAGE 1. When the report arrives, send STAGE 2
(below) in the same chat. Give both outputs to the main hub with the message "register R<n>".
Shared context to paste once at the top of every STAGE 1:

> Context: Roxira is a SaaS platform (accounting/tax, CRM, ERP, HR, AI legal assistant "Smart Judge")
> built by a two-person team using AI coding agents on two machines (a Mac and a Linux laptop behind a
> local HTTP proxy). Budget is minimal; open-source and free tiers first; spend only when it clearly
> pays. Output: facts with primary-source URLs and dates, kept separate from recommendations.

## STAGE 2 (identical for every R<n>)

STAGE 2 — Act now as a skeptical senior reviewer of the report you just wrote.
1. Re-check every number, date, threshold and legal claim against a primary source. Table: claim | source URL | source date | VERIFIED / CHANGED (correct value) / UNVERIFIABLE.
2. List what the report missed that would hurt us in 12–24 months (at least 10), each with why it matters.
3. Turn it into a DECISION PACK: options, recommendation, one-off and monthly cost, effort, reversibility, what to do this month / 3 / 6 / 12 months, revisit trigger.
4. List open questions that need a human expert, each with the default you would choose.
Keep facts and recommendations separate. Do not repeat the original report; only correct, extend and decide.

## R22 — Unattended agent CLIs on subscription logins

STAGE 1 — Research, with primary sources (official terms, docs, changelogs, 2026):
1. Is running Claude Code non-interactively (`claude -p`, headless, scheduled by systemd/cron, from CI) allowed on a personal Pro or Max login? Quote the terms/usage policy section. Limits: rate windows, concurrency, what triggers an account flag. What is the officially supported way for unattended use (API key, Agent SDK, Claude Code GitHub Action) and its cost?
2. Same questions for Google Antigravity (`agy -p` or any headless mode) on a consumer login, and for Gemini CLI (consumer sign-in changes in 2026, free API key tier limits, cost of the cheapest reliable headless option).
3. Same for OpenCode/Codex CLI with a subscription login versus API keys.
4. Is it allowed to use two accounts (one per machine) or to share one login between two machines? Risks of running from a proxied network.
5. Cheapest fully compliant setup for 7 unattended lanes at ~USD 5-30/month. Compare 3 options in a table (cost, reliability, ban risk, setup effort).

## R23 — CRM and ERP (sales, purchasing, stock, BOM, production costing)

STAGE 1 — Research:
1. What is the minimum complete feature set a small-to-mid retail/food/manufacturing SME expects from CRM+ERP in 2026 (leads, quotes, orders, purchasing, stock with FIFO/average cost, BOM, production orders, costing, POS, returns)? Compare Odoo, ERPNext, Twenty, Medusa, and one commercial leader; table of features present/absent.
2. Which of those can be reused as open-source components under licences safe for a closed SaaS (no AGPL/SSPL/ELv2 in the runtime), and which must we build? Include licence per component.
3. Data model pitfalls that cannot be retrofitted (multi-company, multi-currency, multi-warehouse, lot/serial, unit conversion, effective-dated prices, tenant isolation).
4. Integration patterns with accounting postings (automatic journal entries from stock moves, GRNI, landed cost).
5. A phased build order that gives a sellable CRM first and ERP later.

## R24 — HR and payroll

STAGE 1 — Research:
1. Minimum HR scope for SMEs in 2026: employee records, contracts, leave, attendance, payroll, statutory filings, expense claims, onboarding. Table of must/should/later.
2. Payroll rule engines: build vs buy vs open source (licences), effective-dated statutory rules, and how to keep country rules in packs (default pack first, then Germany, Malaysia, Gulf).
3. Privacy/security: special-category data, retention, access control, audit trail, employee self-service, export on cancellation.
4. Certified-payroll partnerships (e.g. Germany ITSG-certified) vs own engine: cost, risk.
5. AI assistance that is safe in HR (drafts only, no automated decisions on people).

## R25 — Realtime RAG and legal graph

STAGE 1 — Research:
1. Best-practice 2026 architecture for a multilingual legal RAG that must answer within first token ≤1.5 s p95 and Recall@5 ≥ 0.95: hybrid dense+sparse+FTS, reranking, as-of-date versioning, citation graph expansion (1-hop), abstention. Which pieces are worth it at our scale (tens of thousands of chunks)?
2. Realtime updating: how to ingest a new or amended law without re-indexing everything (versioned collections, blue/green alias switch, incremental graph edges in Postgres CTE vs a graph database). Failure modes seen in production systems.
3. Tenant-scoped RAG (customer documents next to public law): isolation in Qdrant (payload filters vs collections), leak tests, deletion on cancellation.
4. Evaluation: golden sets, nightly eval, regression gates, LLM-judge pitfalls; how to include voice (STT errors) in the eval.
5. Cost/latency table for free-first model routing with paid fallback.
