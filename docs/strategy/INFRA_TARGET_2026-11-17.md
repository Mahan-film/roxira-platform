# Target infrastructure and Rust path (2026-11-17)

Owner direction (2026-11-17): fix everything from the root, make the system as fast and future-proof as possible, ready to move hot paths to Rust, and push execution to the Antigravity lanes (owner's machine L1–L4, colleague's machine L5–L6).

## Principle
We do **not** rewrite the product in Rust (`ARCHITECTURE_DECISIONS_2026-11-16.md`). The parts that dominate latency are already Rust: TEI (embeddings), Qdrant (vector search), tokenizers, and soon orjson, oxlint and the TS 7 compiler. Each remaining hot path gets a **contract** (typed interface + HTTP/JSON schema + contract tests). A stage moves to Rust only when, after caching, it is above 30% of p95 in the `answer_timing` logs. The contract makes that swap a deployment change, not a rewrite.

## What each system does (target)

| System | Role | Today | Target / next step | Row |
|---|---|---|---|---|
| nginx | edge, TLS via Cloudflare, routing | OK; HTTP→HTTPS fixed (T210) | enforce CSP after a clean report window | T216 |
| NestJS backend | ERP API, tenant scope, ledger | superuser DB role, guards in CI | restricted role cutover; TenantScope injected everywhere | T200, T209 |
| Next.js frontend | UI | TS 5.9 + ESLint | oxlint + TS 7 check (T202), then TS 7 build | T202 |
| FastAPI AI core | Smart Judge, assistant | 350 KB module, per-stage timing | retrieval behind `RetrievalBackend` contract; query-embedding cache; concurrent retrieval; early SSE byte | T211 |
| TEI (Rust) | embeddings bge-m3 | ~40 ms warm, slow cold | keep; warm-up on start; cache queries | T211 |
| Qdrant (Rust) | law/regulation/ruling vectors | 22 collections, 8 stale; served v6 = 16 laws | measured switch to v7b (60 laws) after expanded golden set; delete stale after snapshot | T212, T213 |
| Postgres 17 + PgBouncer | data | pool 200/500 > max_connections 100 | pool 40/60, tuning per MEMORY_BUDGET.md; WAL-G PITR | T214, T204 |
| Redis | cache, BullMQ | no AOF, noeviction, no cap | AOF on for queues, maxmemory + policy split cache/queue | T217 |
| LiteLLM key pool | model routing | free-first | unchanged; prices re-checked before 2027-01-01 | T161 |
| flagd (Go) | feature flags | PR #892 | per-tenant/country flags, kill switches | T203 |
| Backups | pg_dump+age hourly, Neon, Telegram, R2 | healthy; Qdrant now off-site (T197) | WAL-G PITR; weekly Mac restore drill with RTO | T204, T198 |
| Monitoring | synthetic checks, Telegram, email | external uptime re-enabled | error capture (T199); DR email over cap fixed | T199, T218 |

Considered and parked: Valkey instead of Redis (licence-safe drop-in; revisit at the next Redis major upgrade), a Rust retrieval service (axum + qdrant-client + ort; trigger above), Cube/ClickHouse for reporting (trigger: report p95 > 1.5 s).

## New rows

| Row | Task | Done when |
|---|---|---|
| **T211** | Smart Judge speed + Rust-ready retrieval contract | Redis query-embedding cache (normalised Persian text, TTL 7 d, size cap); independent retrieval stages run concurrently; `/chat/stream` sends a first SSE frame at once and the client first-byte timeout is 60 s; orjson responses; `RetrievalBackend` Protocol + JSON contract + contract tests; `docs/strategy/ADR_RUST_READY_HOT_PATH.md`; a replay benchmark printing per-stage p50/p95. |
| **T212** | Law coverage | Golden set extended to the 44 laws that are in v7b but not v6 (deterministic questions from article payloads, no LLM); v6 vs v7b compared; `LIGHTRAG_QDRANT_COLLECTION` unset fails fast (no silent fallback to `iran_laws_v2`); new baseline stored; switch recommended with exact commands. |
| **T213** | Qdrant cleanup script | A script snapshots a collection, copies the snapshot off the container, verifies it, then deletes; dry-run by default; list: v8h (copy of v6), v7, v4, v5, mistral_v1, phase1_test, then v2 and bge_m3 after T212. The hub runs it. |
| **T214** | Postgres and PgBouncer sizing | PgBouncer default_pool_size 40, max_db_connections 60; Postgres shared_buffers/work_mem/effective_cache_size per MEMORY_BUDGET.md; documented restart window. |
| **T215** | User-scoped RLS for Smart Judge tables | chat_conversations, chat_messages, support_tickets, payment_orders, user_entitlements, user_retrial_requests get user-scoped RLS (or a documented app-layer guard with tests); legacy empty tables (accounting_accounts, journal_entries, fin_invoices, crypto_unmatched_tx, email_accounts, legal_statutes_temporal) listed for a reviewed drop migration. |
| **T216** | CSP enforce | CSP report-only reports reviewed; policy tightened and switched to enforce on all three domains; rollback flag. |
| **T217** | Redis durability | AOF for the queue database, maxmemory with `allkeys-lru` for cache keys only (or separate logical DBs), documented. |
| **T218** | DR report email | Report fits the 10-mail cap (summary + attachments split or compressed) or the cap is raised in config; test with the real payload size. |
