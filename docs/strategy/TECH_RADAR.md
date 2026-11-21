# Tech radar: stack inventory and how the radar works

Status: draft for issue #1096 (PR #1097). Written 2026-11-21 from files in this repo only; nothing
here was checked against an external source unless it says "verified" and names the repo doc that
did so. "unknown" means the repo does not pin or state it. Versions are the pins found in the files
listed in the notes column, not what runs in production right now.

Existing radar pieces (not replaced by this document): `scripts/ops/radar/radar.py` (weekly
server-side run, hard cap 0.05 USD per run, append-only `docs/radar/DECISIONS.md`),
`TECH_RADAR_REPORT.md` and `TECH_RADAR_PROPOSALS.md` at the repo root (auto-generated, 2026-09-24),
`.github/workflows/tech-radar-weekly.yml` (retired, manual dispatch only).

## 1. Inventory by layer

Licence column: only what is visible in the repo (a package.json field, a compose comment or a
repo doc). "not stated" means no licence text was found in the files read; it does not mean
"proprietary". Our own code: backend package.json says `UNLICENSED`; no LICENSE file was found at
the repo root in this worktree.

### Runtime and language

| Component | Version found | Language | Licence | Where used | Notes |
|---|---|---|---|---|---|
| Node.js | `node:26-alpine` in both Dockerfiles; backend `engines` `>=20.9.0` | JS/TS runtime | not stated | `output_apps/enterprise_hub/Dockerfile`, `frontend/Dockerfile` | R12 (2026-11) says stages were `node:22-alpine` and T162 plans Node 24; the Dockerfiles now say 26. Reconcile before acting on R12's EOL dates. |
| TypeScript | `^5.9.3` backend, `^5` frontend; `typescript7` alias = 7.0.2 | TS | Apache-2.0 for 7.0.2 (R19) | type-check jobs `typecheck:ts7` beside TS 5.9 | T202 |
| Python | `python:3.11-slim` in `Dockerfile.prod`; `pyproject.toml` `requires-python >=3.13`, ruff target py313 | Python | not stated | AI core, Smart Judge, `src/` | Mismatch between image (3.11) and pyproject (3.13). R12: 3.11 EOL Oct 2027 (verified there). |

### Web framework and API

| Component | Version found | Language | Licence | Where used | Notes |
|---|---|---|---|---|---|
| NestJS | `@nestjs/*` `^10.4.4` (core, common, platform-express) | TS | not stated | `output_apps/enterprise_hub` | R12 mentions NestJS 11/12; repo pins 10. |
| Express (via Nest) | `@types/express ^4.17.21` | TS | not stated | backend | runtime version unknown (transitive) |
| TypeORM + pg | typeorm `^0.3.20`, pg `^8.23.1` | TS | not stated | backend persistence, `migrations/` | |
| class-validator / class-transformer | `^0.15.1` / `^0.5.1` | TS | not stated | DTO validation (AGENTS.md rule) | |
| FastAPI + Uvicorn | fastapi 0.143.0, uvicorn 0.54.0 | Python | not stated | `run_unified_server.py` (:8000), Smart Judge | pins from `Dockerfile.prod` |
| Django / django-ninja | django 5.2.19, django-ninja `>=1.6.2` | Python | not stated | `pyproject.toml` main deps | where Django is used at runtime: unknown |
| Pydantic | `>=2.13.4` | Python | not stated | AI core, retrieval contract | |
| MCP SDK | `@modelcontextprotocol/sdk ^1.32.2` | TS | not stated | `output_apps/enterprise_hub/mcp` | |

### Frontend

| Component | Version found | Language | Licence | Where used | Notes |
|---|---|---|---|---|---|
| Next.js (App Router) | 16.4.6 | TS | not stated | `output_apps/enterprise_hub/frontend` | R12: Next 16 LTS to about Oct 2027 |
| React / React DOM | 19.3.1 | TS | not stated | frontend | |
| Tailwind CSS | `^4` (+ `@tailwindcss/postcss`, tw-animate-css) | CSS | not stated | frontend | |
| shadcn CLI, Base UI, CVA, lucide-react | `^4.23.0`, `^1.9.0`, `^0.7.1`, `^1.73.0` | TS | not stated | UI components | |
| next-intl | 4.15.1 | TS | not stated | i18n (messages/) | |
| TanStack Table / Virtual | `^9.3.1` / `^3.14.26` | TS | not stated | data grids | |
| Vazirmatn font | 33.0.3 (backend dep, used for PDFs) | font | not stated | pdfkit output | |

### Database

| Component | Version found | Language | Licence | Where used | Notes |
|---|---|---|---|---|---|
| PostgreSQL | `postgres:17-alpine` (digest-pinned) prod; `16.9-alpine` for Twenty CRM | C | not stated | `postgres_prod` in `docker-compose.prod.yml` | R12: PG 17 supported to Nov 2029 |
| PgBouncer | `edoburu/pgbouncer:v1.26.1-p0` | C | not stated | `pgbouncer_prod`, transaction pooling | R12: 1.26.1 fixes two CVEs |
| WAL-G (custom image) | `roxira-postgres-walg:17-walg3.0.9`, built from Go image | Go | not stated | `docker/postgres-walg`, `docker-compose.walg.yml` | T204, needs owner approval to enable |
| SQLite (sql.js) | `^1.16.0` backend; AI core keeps a small SQLite auth file | C / JS | not stated | backend, AI core | |
| Twenty CRM | `twentycrm/twenty:v2.41.0` | TS | not stated | CRM on :3002 | separate Postgres 16.9 |

### Cache and queue

| Component | Version found | Language | Licence | Where used | Notes |
|---|---|---|---|---|---|
| Redis | `redis:7-alpine` (digest-pinned) prod | C | R12: Redis 7.4+ is RSAL/SSPL/AGPL (verified there); 7.x tag in use, exact patch unknown | `redis_prod`: cache, rate limits, BullMQ, embedding L2 cache | Internal only. |
| Valkey | `valkey/valkey:8` (`output_apps/docker-compose.prod.yml`), `8-alpine` (research stack) | C | BSD (R12) | research stack, one compose file | T253 |
| BullMQ + ioredis | `^5.81.5` / `^5.11.1` | TS | not stated | backend queues | |
| redis-py | 8.1.0 | Python | not stated | AI core | |

### Vector, search and embeddings

| Component | Version found | Language | Licence | Where used | Notes |
|---|---|---|---|---|---|
| Qdrant | `qdrant/qdrant:v1.19.0` (digest-pinned) | Rust | Apache-2.0 (R12) | `qdrant_prod`, legal vectors | |
| Text Embeddings Inference | `ghcr.io/huggingface/text-embeddings-inference` pinned by digest, tag unknown; model `BAAI/bge-m3` | Rust | not stated | `roxira_embeddings` | already a Rust service |
| LightRAG | `lightrag-hku==1.5.7` | Python | not stated | Smart Judge legal graph (Postgres graph CTE + vectors) | |
| sentence-transformers / torch | 6.1.0 / 2.14.1 (CPU wheels) | Python | not stated | AI core | |
| faster-whisper | 1.2.1 | Python | not stated | STT | |
| Docling, PyMuPDF | docling unpinned; pymupdf `>=1.24.0` | Python | not stated | document ingestion | |
| SearXNG, Crawl4AI, Crawlee | SearXNG digest-pinned (tag unknown); crawl4ai 0.9.4; crawlee `>=1.8.3,<2` | Python | not stated | research stack (:8888) | |
| orjson | unpinned, optional with fallback | Rust core | not stated | `chat_fast.py` (ADR_RUST_READY_HOT_PATH) | |

### LLM gateway and models

| Component | Version found | Language | Licence | Where used | Notes |
|---|---|---|---|---|---|
| LiteLLM proxy | `ghcr.io/berriai/litellm:v1.105.6` | Python | MIT core, enterprise-gated parts disputed (R12) | `config/key_pool.yaml`, 127.0.0.1:4000 | pinned, enterprise features off |
| Provider pool | groq, sambanova, mistral, gemini, openrouter (free/paid/private), nvidia-nim, cloudflare-ai, deepseek, chutes, together, fireworks, more | n/a | n/a | `config/key_pool.yaml` | free first, paid fallback (AGENTS.md) |
| Model registry | roles architect/executor/reviewer/mechanical, free/cheap/strong/stt/tts | YAML | n/a | `config/models.yaml`, `model_registry.py` | ids live only here |
| LangGraph, OpenAI SDK, google-genai, edge-tts | langgraph 1.2.15; openai 3.22.1 (Dockerfile) vs 3.51.0 (pyproject legal-graph extra); unpinned | Python | not stated | AI core | two different `openai` pins |
| Flagd + OpenFeature | flagd `v0.18.2`; SDK 1.23.0, provider 0.18.0 | Go / TS | Apache-2.0 (R19) | `flagd` container, per-tenant flags (T203) | |

### Reverse proxy and edge

| Component | Version found | Language | Licence | Where used | Notes |
|---|---|---|---|---|---|
| nginx | `nginx:alpine` (digest-pinned), tag unknown | C | not stated | `nginx_gateway`, `nginx.conf`, `nginx_split.conf`, `nginx/` | |
| Cloudflare params | `nginx/cloudflare_params.conf` | n/a | n/a | real-IP handling | CDN/tunnel details: unknown from files read |
| docker-socket-proxy | `tecnativa/docker-socket-proxy:v0.5.0` | Go/HAProxy | not stated | restricts Docker socket access | |

### CI and test tooling

| Component | Version found | Language | Licence | Where used | Notes |
|---|---|---|---|---|---|
| GitHub Actions | `ci.yml` plus 20 other workflows; runner picker with `ubuntu-latest` fallback | YAML | n/a | `.github/workflows/` | only `ci.yml` is the required suite |
| Jest | `^29.7.0`, ts-jest `^29.4.15` | TS | not stated | backend tests | R19: Vitest stays a trial |
| node:test | built in | JS | n/a | frontend unit tests (long file list in `frontend/package.json`) | |
| Playwright + axe | `^1.65.1` / `^4.14.0` | TS | not stated | e2e, preview-e2e, e2e-smoke | |
| pytest, hypothesis, pytest-timeout | `>=9.1`, `>=6.170.15,<7`, `>=2.4.0` | Python | not stated | `ci/requirements-test.txt`; never run over `src/` locally | |
| fast-check | `^3.23.2` | TS | not stated | property tests | |
| ESLint | 8.57.1 backend, 9 frontend | JS | not stated | lint | |
| oxlint | 1.94.0 | Rust | MIT (R19) | `lint:oxlint` | T202 |
| ruff, mypy | `>=0.16.2`, `>=2.3.0` | Rust / Python | not stated | Python lint/type | |
| Semgrep CE | 1.178.0 | OCaml/Python | not stated | `ci.yml` semgrep job | required, nightly |
| gitleaks, Trivy, CodeQL | versions in `ci.yml` / `codeql.yml`, not re-read | Go / Go / n/a | not stated | secret and vuln scans | |
| Squawk | version unknown | Rust | Apache-2.0 (R19) | migration lint (T170) | |
| Prettier | `^3.10.1` | JS | not stated | format | |

### Agent tooling

| Component | Version found | Language | Licence | Where used | Notes |
|---|---|---|---|---|---|
| OpenCode | config `opencode.json`, version unknown | n/a | not stated | `build`/`plan` agents, model from `executor` role | |
| Factory scripts | `factory_engine.py`, `factory_dispatch_api.py` (:8005), `autonomous_master_daemon.py`, `task_queue.json` | Python | not stated | repo root | |
| Agent workflows | `agent-task`, `agent-review`, `agent-automerge`, `factory-*`, `review-desk`, `model-eval`, `model-tournament`, `model-registry-check` | YAML | n/a | `.github/workflows/` | |
| Collaboration scripts | `scripts/dev/whoswhat.sh`, `claim.sh`, `team_status.py`, `guard_old_history.sh` | bash/Python | n/a | `scripts/dev/` | |
| Codebase memory, qmd | MCP servers | n/a | n/a | local agent sessions | |
| Tech radar | `scripts/ops/radar/radar.py` | Python | n/a | server timer | cap 0.05 USD per run |

### Observability

| Component | Version found | Language | Licence | Where used | Notes |
|---|---|---|---|---|---|
| Umami | in `docker-compose.prod.yml` (service names not re-read), version unknown | TS | not stated | web analytics | STATE.md lists it |
| Uptime check | `.github/workflows/uptime.yml`, `scripts/ops/monitor/` | YAML / bash | n/a | availability | |
| LiteLLM cost log | `cost_log: true` in `key_pool.yaml` | Python | n/a | per-call LLM cost | |
| Error tracking | done without a container (T199, R19) | n/a | n/a | in-app | |
| Metrics/logs stack | none found in prod compose | n/a | n/a | n/a | R12 notes Prometheus (Apache-2.0) and Grafana/Loki/Tempo (AGPL) as options only |
| Replay benchmark | `eval/replay_benchmark.py` (p50/p95 per retrieval stage) | Python | n/a | Smart Judge | ADR T211 |

### Backup

| Component | Version found | Language | Licence | Where used | Notes |
|---|---|---|---|---|---|
| restic | version unknown | Go | not stated | `scripts/ops/backup/server_backup.sh`: encrypted, to Hetzner Storage Box (sftp) and optional S3-compatible | |
| age (public recipient only on server) | unknown | Go | not stated | backup encryption (R19) | |
| WAL-G | 3.0.9 | Go | not stated | PITR, T204 | not enabled in prod without owner go-ahead |
| Offsite helpers | Neon, Telegram, email, R2, Codeberg mirror (stopped) | bash/Python | n/a | `scripts/ops/backup/` | |
| Restore drills | `restore_drill.sh`, `mac_restore_rehearsal.sh` | bash | n/a | same dir | T164 monthly drill |

### OS and containers

| Component | Version found | Language | Licence | Where used | Notes |
|---|---|---|---|---|---|
| Docker Compose | `docker-compose.prod.yml`, `.walg.yml`, `.modern-stack.yml`, `docker/research-stack` | YAML | n/a | production and research | engine version unknown |
| Production host | Ubuntu or Debian: unknown; STATE.md: ~7.7 GB RAM, disk 80% | n/a | n/a | srv1 | RAM and disk figures from docs, dated |
| CI box | OS version unknown; rootless Docker for the runner (`10_runner_rootless_docker.sh`) | n/a | n/a | `scripts/ops/ci_box/` | |
| Base images | digest-pinned for postgres, redis, qdrant, TEI, nginx, flagd, socket-proxy | n/a | n/a | prod compose | pins are good practice; tags sometimes unreadable |
| systemd timers | backup, radar, offsite, autodeploy | n/a | n/a | `deploy/systemd`, `scripts/ops/` | |
| Python package manager | pip in Dockerfile; `uv.lock`/pyproject present or not: unknown | Python | n/a | | |
| JS package manager | npm (`package-lock.json` in both apps) | JS | n/a | | |

Discrepancies found while building this table (flagged, not fixed): Node 26 images vs R12's
Node 22/24 plan; Python 3.11 image vs `requires-python >=3.13`; two `openai` pins (3.22.1 and
3.51.0); `docker-compose.prod.yml` Redis 7 vs `output_apps/docker-compose.prod.yml` Valkey 8.

## 2. How the radar works

Cadence: monthly review, first working week. The weekly `radar.py` run feeds raw candidates; the
monthly review turns at most a few of them into rows. Security advisories and EOL dates are handled
out of cycle.

Every proposal becomes one GitHub row (issue) with a lane label and these fields:

1. Measured current number on our own workload (latency p50/p95, RAM, build time, image size, cost,
   restore time). "Looks faster" does not count.
2. Expected gain, as a number with the same unit.
3. Licence check. Runtime dependencies: MIT, Apache-2.0, BSD, ISC or CC0 only. AGPL, SSPL, BSL, RSAL,
   Commons Clause or unknown: refused (R12/T163 rule). Dev-only and internal tools may differ but
   must say so.
4. Rollback plan: the exact command or revert, and the time it takes. Anything that restarts a
   production container waits for owner approval.
5. Effort: hours, and which lane.

Adoption rule: adopt only with a measured benefit on our own workload, or for a security or EOL
reason. No churn for novelty. Pin by version and digest, one change per PR, before/after numbers in
the PR body (as T202 did for the toolchain).

Where a fast systems language (Rust, Go) fits:

- Good fit: small single-binary daemons (log shippers, health probes, file watchers, queue
  workers with a fixed protocol), and hot paths that profiling shows dominate p95. Our existing
  example is the typed `RetrievalBackend` contract in `docs/strategy/ADR_RUST_READY_HOT_PATH.md`: a
  Rust retrieval sidecar is allowed only behind that contract and only after `replay_benchmark.py`
  shows the Python path is the bottleneck. Several of our tools are already Rust or Go (Qdrant, TEI,
  oxlint, ruff, WAL-G, flagd) and we consume them as binaries, not rewrite them.
- Wasteful: rewriting CRUD and ledger logic in NestJS, anything that waits on Postgres or an LLM
  (network-bound, not CPU-bound), glue scripts, and anything below the noise floor of the measured
  numbers. A rewrite also costs a second toolchain in CI and on dev machines and the small server.

## 3. Candidates to evaluate (UNVERIFIED, requires primary check and a benchmark)

Each item is justified by a note in this repo. Every external claim is unverified until someone
checks the primary source and runs a benchmark on our workload.

| Candidate | Why it is on the list (repo source) | What to measure | Unverified claims |
|---|---|---|---|
| Valkey in place of Redis 7 (T253, #992) | R12: Redis 7.4+ licence change, Valkey BSD, one compose file already uses it; ARCHITECTURE.md lists "AOF, maxmemory, later Valkey" (T217) | BullMQ throughput, embedding cache hit latency, RAM, AOF recovery time | Wire compatibility with BullMQ and ioredis at our versions; BSD status |
| Node 24 (or the version actually in the Dockerfiles) timing | R12/T162: Node 22 EOL 30 Apr 2027. Dockerfiles already say 26, so first settle which is intended and whether 26 is an LTS | build time, cold start, jest and frontend build time, image size | EOL dates and LTS status of 24 and 26 |
| Postgres major upgrade | R12: PG 17 supported to Nov 2029, so not urgent; Twenty CRM runs 16.9 | query p95 on real tenant data, `pg_upgrade` time, WAL-G compatibility | Gains of any newer major; release dates |
| Python 3.11 to 3.13 image | image and `pyproject` disagree; R12: 3.11 EOL Oct 2027 | import time, RAM, wheel availability for torch/docling | Wheel availability for our pins |
| TypeScript 7 as main type-check (T202) | R19: TS 7.0.2 job exists next to 5.9 | `tsc` vs `tsgo` wall time on both apps | Compatibility with Nest decorators |
| oxlint replacing most ESLint rules (T202) | R19: adopted next to ESLint | lint wall time, rules lost | Rule coverage |
| Vitest in place of Jest | R19: trial only, Jest plus Nest decorators | suite time, decorator support | Compatibility |
| A faster Python package manager (for example uv) | `Dockerfile.prod` has many sequential `pip install` lines and a large torch layer | image build time, layer cache hits, CI install time | Everything about the tool, including licence |
| Faster JS package manager (pnpm or bun) | two `package-lock.json` apps, npm only | clean install time on CI box | Everything about the tools |
| Rust retrieval sidecar | ADR T211 contract exists | per-stage p95 from `replay_benchmark.py` | Any speed-up |
| GoRules ZEN for tax rules (T180) | R19: trial with a spike, MIT, Rust core | decision latency and RAM for Iran VAT and EU reverse-charge cases | Licence, binding maturity |
| pgBackRest vs WAL-G | R19: WAL-G chosen; pgBackRest repo active (checked 2026-11-17) | restore time, RPO | Feature comparison |

Not candidates (decided already in the repo): Unleash (AGPL, refused), Cube Core (deferred), MinIO
(archived), a bigger server (decide on the RAM trigger in R19, T205).
