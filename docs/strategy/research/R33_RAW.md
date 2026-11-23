# R33 raw: technology radar (stack, EOL calendar, Rust, pilots)

Date of research: 2026-11-21. Method: WebFetch/WebSearch against primary pages (release pages, registry
dist-tags, endoflife.date API as a calendar aggregator, vendor changelogs). Inventory source: `docs/strategy/TECH_RADAR.md`
on branch `agent/claude-mahan-films/1096-box-mission` (versions are repo pins, not proven prod state).
Tags: VERIFIED (primary URL, date read 2026-11-21), CHANGED (differs from what repo/R12 says), UNVERIFIED.
endoflife.date is an aggregator: used for calendars, cross-checked with the vendor page where one was fetched.

## STAGE 1

### Q3 first (the calendar answers the discrepancies)

| Item | Finding | Tag | Source |
|---|---|---|---|
| Node 26 | LTS "Lithium"; Active LTS from 2026-10-28, maintenance 2027-10-20, EOL 2029-04-30; latest 26.13.1 (2026-11-11) | VERIFIED | github.com/nodejs/Release schedule.json; nodejs.org/en/about/previous-releases |
| Node 24 / 22 | 24 EOL 2028-04-30 (24.22.3); 22 maintenance, EOL 2027-04-30 (22.23.5); 20 EOL 2026-04-30; 25 EOL | VERIFIED | same |
| Node 27 | Alpha (27.0.0-alpha.0.1.1); from 27 an annual cycle, every major goes LTS after 6 months; schedule: release 2027-04-22, LTS 2027-10-20, EOL 2030-04-30 | VERIFIED | same |
| Node security | 2026-11-11 release: 16 CVEs, 7 High (HTTP/2, TLS renegotiation/mTLS bypass, llhttp heap leak). Fixed in 22.23.5, 24.22.3, 26.13.1 | VERIFIED | nodejs.org/en/blog/vulnerability/november-2026-security-releases |
| Node 26 breaking | Temporal on by default, V8 14.6, undici 8; removed `http.Server.writeHeader`, legacy `_stream_*` modules, `--experimental-transform-types` | VERIFIED (secondary: InfoQ/HelpNetSecurity 2026-05; primary nodejs.org v26.0.0 post listed in results, not read) | search results 2026-11-21 |
| R12 "Node 22 to 24" | CHANGED: 26 is the current LTS. Dockerfiles on `node:26-alpine` are the right line; R12/T162 plan to "24" is already stale. The only gap: `engines >=20.9.0` in backend (Node 20 is EOL) | CHANGED | above |
| Python | 3.11 EOL 2027-10-31; 3.12 2028-10-31; 3.13 2029-10-31 (latest 3.13.18); 3.14 2030-10-31; 3.15 released, 3.15.2 on 2026-10-09, EOL 2031-10-31; 3.10 EOL 2026-10-01 | VERIFIED via endoflife.date (python.org status page not fetched) | endoflife.date/api/python.json |
| Python image mismatch | CHANGED/real defect: image 3.11 while `requires-python >=3.13` means pyproject cannot be installed as declared. Target 3.13 (security to 2029) or 3.14 | repo + calendar | |
| PostgreSQL | 14 EOL 2026-11-12 (ended 9 days ago); 15: 2027-11-11; 16: 2028-11-09; 17: 2029-11-08; 18: 2030-11-14; 19 released 2026-11-19, EOL 2031-11-19. Current minors 17.12, 18.7, 16.16 (2026-11-09) | VERIFIED | postgresql.org/support/versioning/; endoflife.date |
| PG 19 | Headline: REPACK CONCURRENTLY, parallel autovacuum index vacuum, faster FK checks, JIT off by default, lz4 TOAST default; incompatibilities: reindex FTS/pg_trgm indexes, `standard_conforming_strings` always on, `max_locks_per_transaction` 128, RADIUS removed. `postgres:19-alpine` exists on Docker Hub | VERIFIED | postgresql.org/docs/19/release-19.html; hub.docker.com/_/postgres |
| Redis licence | 7.4.x = RSALv2 or SSPLv1 (not permitted); 8.0+ = RSALv2, SSPLv1 or AGPLv3 (AGPL not permitted for our runtime); 7.2 and earlier BSD | VERIFIED (7.2 BSD from knowledge of Redis history; redis.io page covers 7.4 and 8.0) | redis.io/legal/licenses/ |
| `redis:7-alpine` | Docker Hub tag list shows `7-alpine` = `7-alpine3.22` with a different digest from both `7.2.17` and `7.4.7`; patch not readable. Resolve the pinned digest on the server before claiming it is BSD 7.2 | UNVERIFIED | hub.docker.com/_/redis |
| Redis 8.0 | endoflife.date lists 8.0 EOL 2026-12-01; 8.4/8.6/8.8/8.10 current (8.10.3, 2026-07-29) | VERIFIED via aggregator | |
| Valkey | 9.2.0 GA 2026-11-18/19; 9.1.4, 9.0.8, 8.1.12, 8.0.13 security releases 2026-11-18 (CVE-2026-130822 use-after-free with `maxmemory-clients`). EOL: 8.0 2027-09-15, 8.1 2030-03-31, 9.0 2028-10-21, 9.1 2031-05-19. 9.x: B+tree sorted sets, opt-in forkless RDB, I/O threading in cluster bus | VERIFIED | github.com/valkey-io/valkey/releases; endoflife.date |
| Qdrant | latest 1.20.2 (2026-11-16); we pin 1.19.0. 1.20: TurboQuant `turbo8/16`, BM25 on full-text index; **`service.enforce_internal_auth` defaults true when an API key is set**. 1.19: TurboQuant 4-bit, memory tiers, quota API, old search endpoints removed from OpenAPI. Licence Apache-2.0 per R12 (not re-fetched) | VERIFIED (releases page) | github.com/qdrant/qdrant/releases |
| nginx | stable 1.30.7 / mainline 1.31.9 (2026-11-18, 10 security fixes incl. buffer overflow with `try_files`+`alias`, HTTP/2 and HTTP/3 UAF). 14 security releases in 2026 | VERIFIED | nginx.org/en/CHANGES |
| `nginx:alpine` digest-pinned | A digest pin freezes patches: any pin older than 2026-11-18 lacks 10 fixes. Pin age unknown | UNVERIFIED (pin age) | |
| PgBouncer | 1.26.1 (2026-10-14) is latest; fixes 3 CVEs (SCRAM auth confusion, CPU spin, overflow). We run `v1.26.1-p0` | VERIFIED | pgbouncer.org/changelog.html |
| TypeScript | 7.0.2 = `latest` on npm (we alias it); `7.1.0-beta`, `next` tag active. `microsoft/typescript-go` repo archived 2026-09-01 (read-only), so track the npm package, not that repo | VERIFIED | registry.npmjs.org dist-tags; github releases |
| Next.js | 16.4.6 = `latest` (matches our pin); 16.5.0 canary; 15 EOL 2027-01-31 (aggregator); 16 no EOL date | VERIFIED | registry.npmjs.org; endoflife.date |
| React | 19.3.1 = latest | VERIFIED | registry |
| NestJS | `latest` 12.6.0 (2026-11-20). 11.2.x only on `legacy` tag, 11 support ended 2026-08-27, 10 ended 2025-01-16 (aggregator). **We pin ^10.4.4: no security support.** v12 notes list tighter defaults (TCP buffer 16 Mi, WS maxPayload 1 MB, multipart 1000 parts, stricter startup validation, middleware mounting changes); Node minimum / ESM / Express 5 requirement not confirmed | VERIFIED (versions); UNVERIFIED (Nest's own EOL statement and migration guide) | github.com/nestjs/nest/releases; registry; endoflife.date |
| Express | `latest` 5.3.0, `latest-4` 4.22.3 (we have `@types/express ^4`) | VERIFIED | registry |
| Other npm latest | ESLint 10.15.0 (we run 8.57.1 backend: EOL line); Jest 30.5.2 (we run 29); TypeORM 1.1.3 (we run ^0.3.20; 1.x breaking changes not read); Playwright 1.65.1 (ours current) | VERIFIED | registry |
| Python libs | openai 3.57.0 (Apache-2.0; repo has 3.22.1 and 3.51.0 pins); fastapi 0.165.0 (MIT; repo pins 0.143.0); uv 0.13.9 (2026-11-17) | VERIFIED | pypi.org/pypi/*/json; github uv releases |
| LiteLLM | stable 1.110.2, LTS line 1.108.14 (2026-11-20); we pin 1.105.6. Fixes seen: memory growth from finished requests (1.110.2), `/key/info` authorisation gap (fixed 1.106.12/1.108.13/1.109.3/1.110.2; unknown whether 1.105.x is affected) | VERIFIED (releases page); impact UNVERIFIED | github.com/BerriAI/litellm/releases |
| Ubuntu / Debian | Ubuntu 22.04 EOL 2027-06-01; 24.04 2029-05-31; 26.04 (CI box) released 2026-04-23, EOL 2031-05-29. Debian 12 EOL 2028-06-30, 13 2030-06-30. Prod host OS unknown | VERIFIED via aggregator | endoflife.date |
| Docker Engine | 29 is current (29.10.0); 28 EOL 2026-05-13; containerd image store default on fresh 29 installs, graph drivers deprecated. Engine version on our hosts unknown | VERIFIED (blog/docs via search) | docs.docker.com/engine/release-notes/29/ |
| TEI | latest v1.9.4; Apache-2.0 (LICENSE fetched); v1.9.0 changed default GeLU (embedding output can shift; re-embed check) | VERIFIED | github.com/huggingface/text-embeddings-inference |

### Q1 fastest and safest option per layer (honest status)

I found NO neutral, reproducible 2026 benchmark that decides any layer for our workload. What exists:
- Cache: only maintainer/vendor numbers for Valkey 9 (AWS: up to 40% pipelined throughput, 20% zero-copy) and one
  thinly documented third-party post where Redis 8.4 had lower p95 on hot reads (0.607 ms vs 1.191 ms Valkey 9.0.3).
  Mixed evidence, so "faster" is UNVERIFIED either way. Licence decides, not speed.
- Vector: only a competitor-run single-trial result (2026-07-20, M4 Pro, Qdrant 1.18.2 vs pgvector 0.8.5): Qdrant 2.38 ms at 0.963
  recall vs pgvector 12.97 ms at 0.910 (unfiltered, GloVe-100); pgvector faster at 10% and 50% filter selectivity. Qdrant's own
  benchmark page is dated Feb 2023. Treat as hints; our `eval/replay_benchmark.py` is the only valid test.
- Web framework: TechEmpower page did not render, so no round number or ranking could be read. UNVERIFIED. Our endpoints wait on
  Postgres or LLMs, so framework speed is below the noise floor (see Q2).

Layer verdicts (keep unless a measured gain, upgrade for safety):

| Layer | Keep | Upgrade target | Candidate to measure (not adopt) |
|---|---|---|---|
| Backend runtime | Node 26 LTS | NestJS 12, Express 5 line, Node 26.13.1+ | Fastify adapter (Nest-supported) only if p95 profile shows HTTP layer >10% |
| Frontend build | Next 16.4.6, React 19.3.1, TS 7.0.2 | stay on latest | none |
| DB + pooling | PG 17 (to 2029), PgBouncer 1.26.1 | PG 18.7 in Q1-Q2 2027; PG 19 after 19.2 | PgDog (Rust pooler) is AGPL-3.0: refused |
| Cache/queue | BullMQ (Redis protocol) | Valkey 8.1.12 or 9.1.4 | Redis 8.x only under AGPL: refused; Dragonfly/others: licence not checked (BSL family likely refused) UNVERIFIED |
| Vector/embeddings | Qdrant, TEI (both Rust) | Qdrant 1.20.2, TEI 1.9.4 | pgvector for small collections (one fewer service), measure recall/p95 |
| LLM gateway | LiteLLM pinned | 1.108.14 LTS line | keep; thin in-house router only if gateway RAM/latency measured as the limit |
| Reverse proxy | nginx | 1.30.7 stable or 1.31.9 | Caddy (Go, Apache-2.0 per knowledge, UNVERIFIED this session); Pingora (Apache-2.0, a Rust framework, not a drop-in: no) |
| CI/test | GH Actions + box, Playwright, oxlint, ruff | ESLint 10, Jest 30, uv 0.13 | Vitest (R19 trial) |
| Containers | Docker Compose | Docker Engine 29.x | rootless/Podman: no measured need |
| Backup/DR | restic, WAL-G (Go) | keep; enable PITR after owner OK | none |
| Observability | none in prod | Prometheus (Apache-2.0) + small exporter set | Vector (Rust, MPL-2.0, Datadog-maintained) for log shipping; MPL is file-level copyleft, runtime binary only, flag to owner |

### Q2 where Rust/Go pays, where a rewrite is wasteful

- Already consumed as binaries: Qdrant, TEI, ruff, oxlint, uv, WAL-G, flagd, orjson core. This is the best ROI: Rust speed with zero rewrite.
- Pays: single-binary daemons (log shipper, health probe, file watcher), CPU-bound parsing of untrusted input (PDF/OCR chunking if profiling shows it), a retrieval sidecar behind the existing typed `RetrievalBackend` contract (`ADR_RUST_READY_HOT_PATH.md`) but only if `replay_benchmark.py` shows Python is the bottleneck.
- Wasteful: CRUD/ledger in NestJS, anything waiting on Postgres or LLM, glue scripts, UI. Team of two cannot maintain a second language runtime across CI, security scanning and agent prompts.
- Mature Rust parts we could adopt instead of writing: Pingora (Apache-2.0, 831 commits, MSRV 1.85, caching API "volatile", no releases listed: UNVERIFIED maturity), Vector (MPL-2.0, active, 22.9k stars), uv (Rust, 0.13.9, licence not shown on page, known dual MIT/Apache: UNVERIFIED), PgDog (AGPL: no). Licence check mandatory before any adoption.
- Rule: no rewrite without a measured gain on our workload. Measure first (p95 per stage, CPU profile, RAM), set a threshold in the row (e.g. stage >30% of p95 and >2x speedup in a prototype).

### Q4 pilots for the next 12 months (cheap designs)

| Pilot | Maturity | Licence | Risk | Cheap pilot |
|---|---|---|---|---|
| Valkey 9.1/9.2 replacing Redis 7 | GA | BSD | BullMQ/ioredis edge cases | run BullMQ + rate-limit suite against valkey in CI; `valkey-benchmark` vs `redis-benchmark` on our command mix |
| Postgres 18 (then 19) | GA | PostgreSQL | extension/pooler compat; FTS reindex in 19 | restore a backup into 18 on the box, run migrations + pgbench + replay |
| pgvector in PG as Qdrant fallback for small tenants | mature | PostgreSQL | recall at filters | run replay_benchmark on same corpus, compare recall@10 and p95 |
| Qdrant TurboQuant (1.19/1.20) | new, vendor feature | Apache-2.0 | recall loss | collection copy with turbo8, compare recall/RAM |
| Fastify adapter for Nest | mature | MIT | low gain expected | autocannon on top 5 endpoints, before/after |
| OpenTelemetry + Prometheus | mature | Apache-2.0 | RAM on 7.7 GB host | one exporter on the box first, then prod |
| Python 3.14 free-threaded | official, optional | PSF | wheel gaps (torch, docling) | CI job only, never prod |
| Vector log shipper | mature | MPL-2.0 | licence review | box only |

Not verified in this session: edge/runtime options (Workers-style), new queues (NATS, Redpanda licences), agent tooling maturity. Do not adopt on this report.

## STAGE 2 (skeptical review of the above)

### 1. Claim re-check

| Claim | Source | Date | Status |
|---|---|---|---|
| Node 26 LTS from 2026-10-28, EOL 2029-04-30 | nodejs/Release schedule.json | 2026-11-21 | VERIFIED |
| Node 22 EOL 2027-04-30; 24 EOL 2028-04-30 | same | | VERIFIED |
| Node 27 annual/all-LTS cadence | nodejs.org previous-releases | | VERIFIED |
| PG 14 EOL 2026-11-12; 17 EOL 2029-11-08; 18 2030-11-14; 19 released 2026-11-19 | postgresql.org versioning | | VERIFIED (endoflife.date listed cycle 19 with inconsistent dates; primary used) |
| Redis 7.4 RSAL/SSPL; 8.0+ adds AGPL | redis.io licences | | VERIFIED |
| Python EOL dates | endoflife.date | | CHANGED vs R12? R12 said 3.11 EOL Oct 2027: matches; python.org not fetched, UNVERIFIED primary |
| Nest 10 has no security support | endoflife.date | | UNVERIFIED primary (Nest docs not read) |
| nginx 1.31.9 has 10 security fixes | nginx.org CHANGES (page truncated at 100k chars) | 2026-11-18 | VERIFIED for listed items |
| Qdrant 1.20.2 latest, internal-auth default | GitHub releases | 2026-11-16 | VERIFIED |
| Valkey 9 faster than Redis 8 | vendor claims only | | UNVERIFIABLE |
| Qdrant faster than pgvector | competitor single-trial | 2026-07-20 | UNVERIFIABLE for our data |
| `redis:7-alpine` is licence-safe 7.2 | Docker Hub tag list | | UNVERIFIED (digest not resolved) |
| TS7 repo archived 2026-09-01 | GitHub page | | VERIFIED; consequence (where TS7 development continues) UNVERIFIED |

### 2. Missed risks (12-24 months)

1. Digest-pinned images freeze patches: nginx fixed 10 flaws on 2026-11-18, Node fixed 7 High on 2026-11-11. Without an automated rebuild job, pins become the vulnerability.
2. NestJS 10 and ESLint 8 are out of support; a security fix will not come, and agents may paste old APIs.
3. TypeORM 0.3 to 1.x and Express 4 to 5 are major jumps still ahead (read migration notes first); doing them together with Nest 12 multiplies risk. Sequence them.
4. Node 27 changes cadence: every major becomes LTS, so "skip odd versions" logic in our docs and Dockerfiles breaks; plan one LTS upgrade per year (2027-10, 2028-10).
5. Node 22 EOL 2027-04-30: Twenty CRM or any tool image still on 22 hits it; inventory all base images, not just ours.
6. PG 14 just went EOL; Twenty CRM runs PG 16.9 (old minor, 16.16 is current) on a separate cluster: patch minors monthly.
7. PG 19 reindex duty (FTS, pg_trgm) matters for the legal text search; also `max_locks_per_transaction` doubling. Never move to x.0 within 3 months.
8. Qdrant 1.20 default internal auth with API key can lock internal calls out after upgrade; test on a copy first. TEI 1.9 GeLU change can shift embeddings vs stored vectors: re-embed/compat check.
9. Redis licence trap on a floating tag: a later `redis:7` digest or `redis:8` bump silently moves us to RSAL/SSPL/AGPL. Pin by digest with a licence check in CI.
10. Public repo: pinned vulnerable versions in compose files are visible to attackers; lag in patching is public.
11. LiteLLM enterprise-gated code and fast release cadence (stable 1.110, LTS 1.108): pinned 1.105.6 misses memory-leak and auth fixes; gateway is on the key path for every call.
12. Single 7.7 GB host at ~80% disk: any extra daemon (Prometheus, Vector, extra pooler) competes for RAM; measure headroom before adding observability.
13. Supply chain: npm/PyPI install of unpinned packages (docling unpinned, orjson unpinned) in prod images; use lockfiles/hash pins and `uv`.
14. Two Python versions in play (3.11 image, >=3.13 pyproject) hide type/syntax drift; CI passing on a different interpreter than production.
15. Docker Engine 28 EOL 2026-05-13; unknown engine version on hosts. Graph driver deprecation affects image-store migration.

### 3. Decision pack (ranked)

| # | Proposal | Expected gain | Effort | Cost | Rollback | Measure first / metric | When |
|---|---|---|---|---|---|---|---|
| 1 | Patch sweep: rebuild nginx (1.30.7/1.31.9), Node base (26.13.1), PG 17.12, Valkey/Redis, Qdrant 1.20.2 candidates on box; weekly rebuild job | closes 7 High Node + 10 nginx CVEs | 3-5 h | 0 | previous digest, <5 min | Trivy HIGH+CRITICAL count before/after; owner OKs prod restart | now |
| 2 | Drift fix: one Node (26) in `engines`, CI, Dockerfiles; Python image 3.13; one `openai` pin; one cache engine decision | removes "works in CI only" class | 4-6 h | 0 | git revert | CI green on identical versions; image size, cold start | now |
| 3 | Cache licence + speed decision: Valkey 8.1.12 or 9.1.4 vs Redis 7.2 pinned | licence safety; possible gain | 4 h | 0 | switch image tag (same RDB) | `valkey-benchmark`/`redis-benchmark` on our BullMQ+limit mix: ops/s, p99 | now |
| 4 | NestJS 10 to 11 to 12 (+ ESLint 10, Jest 30), Express stays 4 until Nest says | security support | 2-4 days | 0 | branch + revert; staging first | test suite pass; p95 of top 10 endpoints, RSS | 3 months |
| 5 | LiteLLM to LTS 1.108.14 | auth/mem fixes | 3 h | 0 | previous tag | gateway RSS over 24 h, 429/err rate, cost log parity | 3 months |
| 6 | Qdrant 1.20.2 + TurboQuant trial | RAM drop, maybe p95 | 1 day | 0 | snapshot restore | `replay_benchmark.py` recall@10, p50/p95, RSS | 3 months |
| 7 | Postgres 18.x | async I/O gains (unmeasured by us) | 1-2 days | 0 | pg_dump/WAL-G restore to 17 | pgbench + replay on restored copy; restore drill time | 6 months |
| 8 | Observability: Prometheus + node/postgres exporters | detect regressions | 1 day | RAM | stop container | RAM overhead <300 MB, scrape works | 6 months |
| 9 | TypeORM 1.x, Express 5, Vitest | maintenance | 3-5 days | 0 | revert | tests + query count | 12 months |
| 10 | Rust sidecar for retrieval hot path | only if profile says so | 2-3 weeks | 0 | feature flag | stage >30% of p95 and prototype >2x | 12 months, conditional |
| 11 | PG 19 | features | 2 days | 0 | as 7 | after 19.2+, FTS reindex time | 12 months |

Revisit triggers: new CVE in a pinned image; EOL within 6 months; benchmark shows a stage >30% of p95.

### 4. Open questions (default in brackets)

1. Which OS/Docker Engine version runs on the production host? [read-only check by owner or via inspect-only ssh, report in PR]
2. Is Redis in prod really 7.2 (BSD) or 7.4? [assume unknown, resolve digest, move to Valkey 8.1 if not 7.2]
3. Do we accept MPL-2.0 binaries (Vector) in the runtime? [no for now; use journald + restic]
4. Nest 12 requirements (Node minimum, Express 5, ESM)? [read the official migration guide before starting]
5. Is Twenty CRM upgradable independently (Node, PG 16.9)? [bump to PG 16.16 minor only]
6. Staging environment to rehearse upgrades? [use the box with restored backup]
