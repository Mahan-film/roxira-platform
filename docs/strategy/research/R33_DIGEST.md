# R33 digest: technology radar (2026-11-21)

Full evidence and STAGE 2: `R33_RAW.md`. Tags: VERIFIED (primary page read 2026-11-21), CHANGED, UNVERIFIED.
Calendars partly come from the endoflife.date aggregator; vendor pages used where fetched.

## Verified facts
- Node 26 is LTS since 2026-10-28 (EOL 2029-04-30); 24 EOL 2028-04-30; 22 EOL 2027-04-30; 20 EOL. Our `node:26-alpine` is correct.
  CHANGED: R12/T162 "Node 22 to 24" is stale. Backend `engines >=20.9.0` still allows an EOL line. (nodejs/Release schedule.json)
- Node security release 2026-11-11: 16 CVEs, 7 High (HTTP/2, TLS mTLS bypass); fixed in 22.23.5 / 24.22.3 / 26.13.1.
- Node 27 (alpha) starts an annual cadence where every major becomes LTS: 27 releases 2027-04-22, LTS 2027-10-20.
- nginx 1.31.9 (2026-11-18) fixed 10 flaws (try_files+alias overflow, HTTP/2 and HTTP/3 use-after-free); 14 security releases in 2026.
  A digest-pinned `nginx:alpine` older than that is vulnerable (pin age UNVERIFIED).
- PostgreSQL: 14 EOL 2026-11-12; 17 EOL 2029-11-08; 18 (18.7) EOL 2030-11-14; 19 released 2026-11-19 (EOL 2031-11-19).
  PG 19 needs FTS/pg_trgm reindex and has changed defaults. PgBouncer 1.26.1 is current and fixes 3 CVEs (we match).
- Redis 7.4 is RSAL/SSPL and 8.0+ adds AGPL: none allowed. Valkey 9.2.0 GA 2026-11-19; 8.1.12/9.1.4 patched a use-after-free (CVE-2026-130822). Valkey 8.1 EOL 2030-03-31.
- Python 3.11 EOL 2027-10-31; 3.13 2029-10-31; 3.14 2030-10-31. Image 3.11 vs `requires-python >=3.13` is a real defect.
- NestJS latest is 12.6.0; we pin ^10.4.4 (support ended 2025-01-16 per aggregator, Nest's own page not read). ESLint 8 and Jest 29 are old lines (latest 10.15.0 / 30.5.2). TypeORM latest 1.1.3 (we ^0.3).
- Already latest: Next 16.4.6, React 19.3.1, TypeScript 7.0.2 (typescript-go repo archived 2026-09-01; follow the npm package).
- Qdrant 1.20.2 latest (we 1.19.0); 1.20 turns internal auth on by default when an API key is set. TEI 1.9.4 (Apache-2.0). LiteLLM stable 1.110.2, LTS 1.108.14 (we 1.105.6). openai 3.57.0 (repo has 3.22.1 and 3.51.0).
- PgDog (Rust pooler) is AGPL-3.0: refused. Pingora Apache-2.0 but a framework, not a drop-in. Vector is MPL-2.0 (needs owner view).

## EOL / upgrade calendar (what we run)
| Item | Now | Key dates |
|---|---|---|
| Node | 26 | 22 EOL 2027-04-30; 26 maintenance 2027-10-20, EOL 2029-04-30; next LTS 27 on 2027-10-20 |
| Python | 3.11 image (bug) | target 3.13 now; 3.11 EOL 2027-10-31 |
| PostgreSQL | 17 (Twenty: 16.9) | 15 EOL 2027-11-11; 16 2028-11-09; 17 2029-11-08; move to 18 in 2027 H1; 19 after 19.2 |
| Cache | Redis 7 / Valkey 8 mixed | Redis 8.0 EOL 2026-12-01; Valkey 8.0 EOL 2027-09-15; Valkey 8.1 2030-03-31 |
| Next.js / NestJS | 16.4.6 / 10 | Next 15 EOL 2027-01-31; Nest 11 support ended 2026-08-27 |
| nginx | unknown pin | only newest lines get fixes: patch monthly |
| Ubuntu | CI box 26.04 | 22.04 EOL 2027-06-01; 24.04 2029-05-31; 26.04 2031-05-29 |
| Docker Engine | unknown | 28 EOL 2026-05-13; 29 current |

## Ranked proposals (do not adopt without the metric)
1. Now: patch sweep (nginx, Node base, PG minor, cache, restore-checked) with weekly rebuild job. Metric: Trivy HIGH/CRITICAL count. Owner OKs prod restarts.
2. Now: kill drift (one Node, Python 3.13 image, one openai pin, one cache engine). Metric: CI on identical versions.
3. Now: cache decision, Valkey 8.1/9.1 vs Redis 7.2 pinned by digest. Metric: valkey-benchmark vs redis-benchmark on our BullMQ+rate-limit mix (no neutral benchmark exists).
4. 3 months: NestJS 10 to 12 with ESLint 10, Jest 30; LiteLLM to 1.108 LTS; Qdrant 1.20.2 plus TurboQuant trial.
5. 6 months: PostgreSQL 18; Prometheus + exporters (RAM budget first).
6. 12 months: TypeORM 1.x, Express 5, Vitest, PG 19, Node 27 LTS; Rust sidecar only if a stage exceeds 30% of p95 and a prototype is >2x.
Rust verdict: consume Rust binaries (Qdrant, TEI, ruff, oxlint, uv); no rewrite of CRUD/ledger (network-bound).

## Owner decisions needed
1. Approve prod restarts for the patch sweep (default: yes, in a quiet window, previous digest as rollback).
2. Cache engine (default: Valkey, BSD, since Redis 7.4+/8 are not allowed).
3. Accept MPL-2.0 binaries such as Vector in the runtime (default: no).
4. NestJS 12 upgrade lane and timing (default: 3 months, staging on the box first).

## NOT verified
- No neutral 2026 benchmark found for Valkey vs Redis, Qdrant vs pgvector (only vendor/competitor runs), or Node framework speed (TechEmpower page did not render). All "faster" claims are open until measured by us.
- Prod host OS and Docker version, nginx and Redis digests/patch levels, Twenty CRM stack.
- NestJS official EOL and v12 migration requirements (Node minimum, Express 5, ESM); TypeORM 1.x breaking changes; LiteLLM 1.105.x exposure to the `/key/info` fix; python.org EOL page; Caddy/Dragonfly licences; edge and queue pilots beyond the table.

## Proposed GitHub rows
| Lane | Title | Measurement | Done when |
|---|---|---|---|
| L1 | Patch sweep: nginx 1.30.7+/Node 26.13.1/PG 17.12/Valkey digests | Trivy HIGH+CRITICAL per image before/after | all prod images scan clean or have accepted exceptions; rollback digests listed |
| L1 | Weekly image rebuild and digest-refresh job with licence check | count of images older than 14 days | job runs on the box, PR opened with new digests, no AGPL/SSPL/RSAL image passes |
| L1 | Align runtimes: Node 26 engines, Python 3.13 image, single openai pin | CI matrix versions equal to Dockerfile versions | one version per runtime in repo; CI green |
| L1 | Cache engine bake-off: Valkey 8.1/9.1 vs Redis 7.2 | ops/s and p99 via benchmark tools on our command mix; BullMQ suite | decision doc with numbers; compose uses one engine |
| L1 | NestJS 10 to 12 upgrade plan and staging run (with ESLint 10, Jest 30) | test pass, p95 top-10 endpoints, RSS | staging green, rollback tag recorded, owner approves deploy |
| L1 | Qdrant 1.20.2 + TurboQuant trial on a collection copy | recall@10, p50/p95 via `eval/replay_benchmark.py`, RSS | recall loss <=1 point or rejected; internal-auth impact documented |
| L1 | LiteLLM to LTS 1.108.14 | gateway RSS over 24 h, error rate, cost-log parity | 24 h soak clean; previous tag kept |
| L1 | Postgres 18 rehearsal on restored backup | pgbench and replay p95, migration time, restore time | rehearsal report; go/no-go for 2027 H1 |
| L2 | Prometheus + exporters on the box, RAM budget check | added RSS (<300 MB), scrape success | dashboard of p95 and RSS exists; stop switch documented |
| L1 | Rust hot-path gate: profile retrieval stages | share of p95 per stage in `replay_benchmark.py` | written threshold (>30% and >2x prototype) and result; no rewrite without it |
