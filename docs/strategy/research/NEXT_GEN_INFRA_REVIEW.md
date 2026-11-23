# Next-gen infrastructure report: box hub review (2026-11-22)

Source: `docs/strategy/research/NEXT_GEN_INFRA_REPORT_2026-11-22.fa.md` (owner report, Persian, stored unchanged).
Scope: docs only. Each row was checked against `origin/main` on 2026-11-22 plus the open PR list. External claims in the report (release dates, EOL dates, version numbers of third-party projects) were NOT re-verified here; they need a source check before anything is built on them.

Status: **done** = on main, **in PR #N** = open, **not started** = nothing found by grep.
Verdict: **adopt now**, **later** (with trigger), **reject**.

## Section 1: versions

| Item | Status in repo | Verdict | Reason |
|---|---|---|---|
| Node 26 | done: CI `NODE_VERSION: "26"`; #1309 aligns the rest | adopt now (finish #1309) | `output_apps/enterprise_hub/package.json` still says `>=20.9.0`; #1309 is the cleanup. |
| Python 3.14 (not 3.15) | CI `PYTHON_VERSION: "3.13"`, `requires-python >=3.13`, ruff `py313`; `Dockerfile.prod` still `python:3.11-slim`; #1309 pins 3.13 | later, target 3.14 | 3.15 is too new: torch/onnxruntime wheels lag. Trigger: all heavy wheels ship cp314 and the Smart Judge suite is green on 3.14 in a CI matrix job. Fix the 3.11 prod image first (separate issue), it is the bigger gap. |
| Docker rootless | done for the CI runner user (box brief: runner has rootless Docker). Prod compose has `read_only: true` on 2 services; `Dockerfile.prod` has no `USER` | adopt now for the runner (done); later for prod | Prod needs a non-root `USER` and read-only on the rest; the production server is out of scope for this PR. |
| PostgreSQL 18 | not started: CI and prod compose use `postgres:17` | later, new deployments only | Prod upgrade is a hub decision (needs pg_upgrade rehearsal and the PITR drill). New deployments and a CI matrix leg can use 18. |
| gh version, macOS | n/a | reject (not repo scope) | Mac host details; box gh is 2.46 and workflows do not depend on it. |

## Section 2: lockdown

| Item | Status | Verdict | Reason |
|---|---|---|---|
| FORCE RLS on all tenant tables, non-superuser app role | partly done: `rls-coverage-gate.pg.spec.ts` exists, `roxira_app` role used in compose/CI; 100% coverage enforcement in PR #1312 | adopt now | Already the direction; merge #1312. |
| Qdrant strict mode + tenant filter | not started (no `strict_mode`, `unindexed_filtering_retrieve` or `max_query_limit` in repo); image pinned at v1.19.0; layout audit in PR #1300; tenancy tests exist in smartjudge | adopt now | Cheap config; do after #1300 lands so it matches the audited collection layout. Note: `is_tenant` is already in the R25 design. |
| Actions pinned to SHA | done: all `uses:` in workflows are 40-char SHA pinned (87), and a CI hardening check fails on unpinned ones | adopt now (done) | The three non-matching grep lines were comments and `permissions:` keys. |
| gitleaks, trivy, OSV, agent guards | done in `ci.yml`; #1303 (checksummed Trivy, ZAP) and #1302 (OSV triage) open | adopt now (done / in PR #1302, #1303) | Nothing to add. |

## Section 3: technologies

| Item | Status | Verdict | Reason |
|---|---|---|---|
| Valkey | in PR #1158 (licence audit, Valkey/Redis 7.2 pin, image licence gate); research stack already uses `valkey/valkey:8`; prod compose and CI use `redis:7`; ARCHITECTURE_DECISIONS parked it "until next Redis major" | adopt now | Licence risk is the reason; the 7.x line is BSD so there is no emergency, but the gate in #1158 should land and the switch should ride it. |
| Qdrant 1.16+ tiered multitenancy, hybrid search | v1.19.0 pinned; R25 design covers `is_tenant`; hybrid search not started | adopt later | Trigger: golden-set shows Recall@5 gain from sparse+dense on legal queries. |
| Langfuse + OTel | not started; only mentions in research docs | later | Langfuse needs ClickHouse (plus Postgres, Redis, S3): too heavy for one laptop. Start with OTel to a file or Jaeger; add Langfuse when a server exists. The key-pool gateway already writes a cost/latency log (no prompts). |
| pypdfium2 replacing PyMuPDF | in PR #1298 (`pdf_backend` module, #1235) | adopt now | AGPL removal. Mac comparison test needs the fixtures in section 9 item 4. |

## Section 5: dev/CI accelerators

| Item | Status | Verdict | Reason |
|---|---|---|---|
| Ruff | done: dev dependency, `[tool.ruff]` in `pyproject.toml` | adopt now (done) | - |
| uv | not started in CI, `Dockerfile.prod` or scripts (no `uv sync`/`uv pip` anywhere) | adopt later | Trigger: pin a `uv.lock` and measure CI install time; do it together with the Python 3.14 move so the lock is built once. |
| Oxlint | done: `lint:oxlint` runs before ESLint in CI (T202) | adopt now (done); Biome reject | Oxlint stays a fast pre-check next to ESLint; not a replacement yet. Biome would be a third tool for no extra coverage. |
| tsgo / TypeScript 7 | done, report-only job in `ci.yml` | adopt now (done); later make blocking | Trigger: two weeks with zero diff versus `tsc`. |
| Temporal / Restate | not started; explicitly parked in ARCHITECTURE_DECISIONS_2026-11-16 | later | Trigger already written there (agent workflow > 1 hour that must survive restarts, or > 3 hand-written saga retries). BullMQ + outbox covers today's load. |
| Firecracker / gVisor | not started | later | Not now. gVisor/runsc is the cheap first step for builder sandboxing: it is a Docker runtime switch, no new VM stack. Firecracker needs KVM and ops we do not have. |

## Section 6: languages

No code. Verdict: agree. It matches `INFRA_TARGET_2026-11-17.md` (no Rust rewrite; a stage moves to Rust only when it is above 30% of p95). Status: done as policy.

## Section 7: GraphRAG, chat and voice

| Item | Status | Verdict | Reason |
|---|---|---|---|
| HippoRAG, Graphiti, Cognee, agentic RAG | research mentions only (R25, agent-memory note); LightRAG is the current base | research row, no code | Smart Judge core is hub-only under B1, so box agents do not write it. Ideas go to the Smart Judge hub as a research item. Graphiti's as-of edges overlap the bitemporal design already in R25. |
| LiveKit Agents | done: phone agent runs on it (`services/voice_phone_agent`), CI guards default keys | adopt now (done) | Keep it. |
| Pipecat | not started (only in the tech radar) | reject for now | A second voice framework next to LiveKit Agents adds cost with no gap to fill. Revisit only if LiveKit Agents blocks a concrete need. |

## Section 8: modularity and companions

| Item | Status | Verdict | Reason |
|---|---|---|---|
| Ports and adapters | partly: `pdf_backend` (#1298), `served_collection` | adopt now | Continue per touched module, no sweeping refactor. |
| LiteLLM gateway | done: `config/key_pool.yaml` is the single source, `scripts/infra/key_pool/render_litellm.py` renders a LiteLLM proxy config, `docker-compose.prod.yml` wires `SMARTJUDGE_LLM_GATEWAY` | reject adding another | The box key-pool gateway already is LiteLLM. Portkey would duplicate it. Per-tenant budgets are the open piece; add them inside the existing gateway when tenant billing needs them. |
| Ragas / Promptfoo | not in CI (only research mentions); eval seed #1043 merged; phone eval #1281 open | adopt later | Tie to the existing nightly eval: reuse the #1043 seed and #1281 numbers as the baseline, add Ragas faithfulness/citation metrics as a report-only job first. |
| OpenFeature + flagd | done (T203): flagd in prod compose, `config/flags/flags.json`, feature-flags module | adopt now (done) | - |
| BullMQ on Valkey / NATS | BullMQ in use in enterprise_hub; NATS parked in ARCHITECTURE_DECISIONS | BullMQ done; NATS reject | BullMQ stays; it runs on Valkey once #1158 lands. |
| OTel Collector | not started | later | Same trigger as Langfuse: start with file/Jaeger export. |

## Section 9: prerequisites

Items 1 to 4 (Mac `uv` venv, Mac docker test stack on free ports, Mac `stat` fix branch, public-law fixtures) are Mac-specific or fixture work and stay with the Mac hub. Verdict: the `docker-compose.test.yml` idea (item 2) is useful on the box too; the box hub can reuse it if the Mac hub publishes it. Item 5 (owner review queue speed) is an owner process matter, not a repo change.

## Box hub bottom line

- Do now: land #1158, #1298, #1312, #1300, #1309; then Qdrant strict mode.
- Do later with trigger: Python 3.14 (and fix the 3.11 prod image), uv, PG 18 for new deployments, Ragas report-only job, tsgo blocking, OTel to file/Jaeger.
- Not now: Langfuse, Temporal/Restate, Firecracker, Pipecat, Portkey, Biome, NATS.
- Research row only: HippoRAG, Graphiti, Cognee (Smart Judge core, hub-only under B1).
