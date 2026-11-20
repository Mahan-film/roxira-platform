# Upgrade plan 2026-11: runtimes, frameworks, Rust where it pays

Status 2026-11-20 (box hub, #1013). Every "latest" below was checked that day against nodejs.org, endoflife.date, PyPI, the npm registry and GitHub releases. This plan follows the rules of `INFRA_TARGET_2026-11-17.md`: free options first, Rust only for a measured hot path behind a contract, and no rewrite for its own sake.

## 1. Current vs latest

### Runtimes and data services

| Component | Where | Current | Latest (2026-11-20) | Support / EOL | Gap |
|---|---|---|---|---|---|
| Node.js (prod images) | `output_apps/enterprise_hub{,/frontend}/Dockerfile` | 22-alpine | **26.13.1 LTS "Lithium"** (LTS since 2026-10-28) | 22: EOL 2027-04-30 · 26: active to 2027-10, EOL 2029-04-30 | 2 LTS lines behind |
| Node.js (CI) | `ci.yml` `NODE_VERSION` | 22 | 26 | as above | CI must match the images |
| Node.js (other workflows) | `e2e-smoke`, `preview-e2e`, `project-pages`, `deps-audit-weekly` | **20** | 26 | **20 has been EOL since 2026-04-30** | out of support |
| Python (prod AI core) | `Dockerfile.prod` | **3.11** | 3.15.2 (GA 2026-10-09) | 3.11: EOL 2027-10 | prod is older than CI (3.13) and `requires-python >=3.13` |
| Python (CI, pyproject) | `ci.yml`, `pyproject.toml` | 3.13 | 3.15.2 | 3.13: EOL 2029-10 | fine |
| Python (research service) | `services/research/Dockerfile` | 3.12.11 | 3.15.2 | 3.12: EOL 2028-10 | pinned on purpose |
| Python (stragglers) | `review-desk.yml` 3.12, `model-tournament.yml` 3.11 | 3.11/3.12 | 3.13 | | align to 3.13 |
| PostgreSQL | `docker-compose.prod.yml` | 17-alpine | 19.0 (new), 18.7 | 17: EOL 2029-11 | no rush |
| PgBouncer | prod compose | 1.26.1 | 1.26.1 | | current |
| Redis | prod compose | 7-alpine | 8.10.3 · Valkey 9.2.0 | 7.4: EOL 2029-12 | licence choice at next major |
| Qdrant | prod compose | 1.19.0 | 1.20.2 | | 1 minor behind |
| TEI (embeddings) | prod compose | digest pin | 1.9.4 | | check the digest's version |
| LiveKit server / SIP | phone stack (#959, user `phone`) | per kit | server v1.13.11, sip v1.25.0 | | pin exact tags in the kit |

### Frameworks and tools

| Package | Where | Current | Latest | Major gap? | Notes |
|---|---|---|---|---|---|
| TypeScript | hub, frontend | 5.9.3 (+ `typescript7@7.0.2` report-only) | **7.0.2** | yes | TS 7 (native compiler) already runs report-only (T202). Flip it to blocking once clean, then drop 5.9. |
| NestJS (`@nestjs/*`) | hub | **10.4** | 12.6.0 | 2 majors | **Security driver**: the open `@nestjs/core` advisory is fixed only in 11.1.18. `body-parser` and `multer` alerts come from Express 4 under `platform-express` 10. |
| TypeORM | hub | 0.3.x | 1.1.3 | yes | Do it after NestJS 11 (`@nestjs/typeorm` 11). |
| Jest / ts-jest | hub | 29 | 30.5 | yes | Low risk. Do it with NestJS 11. |
| ESLint | hub 8 / frontend 9 | 8 / 9 | 10.15 | yes | oxlint already does most of the work (T202). Hub ESLint 8 is EOL: move to flat config. |
| `@types/node` | hub 20, frontend 20, chassis 22 | 20 | 26.6 | yes | Bump with the Node 26 move. |
| Next.js | frontend | 16.4.5 → 16.4.6 (#881) | 16.4.6 | no | Current once #881 lands. |
| React | frontend | 19.3.1 | 19.3.1 | no | Current. |
| bullmq | hub | 5.81 | 6.7.8 | yes | Check the Redis 8 / Valkey choice first. |
| `@livekit/rtc-node` / `livekit-server-sdk` | voice agent | 1.2.2 / 2.19.3 | 1.2.3 / 2.20.1 | no | Patch/minor. |
| FastAPI | `Dockerfile.prod` | 0.143.0 | 0.165.0 | 0.x minors | Read the release notes. Pydantic v2 is already in use. |
| torch / torchvision (CPU) | `Dockerfile.prod` | 2.14.1 / 0.29.1 | 2.15.0 | no | Has cp313/cp314 wheels, **no cp315** yet. |
| sentence-transformers | `Dockerfile.prod` | 6.1.0 | 6.3.0 | no | |
| langgraph | `Dockerfile.prod` | 1.2.15 | 1.2.24 | no | |
| SQLAlchemy / psycopg | `Dockerfile.prod` | 2.1.4 / 3.3.6 | 2.1.9 / 3.3.9 | no | |
| openai (Python) | `Dockerfile.prod` **3.22.1**, `pyproject.toml` 3.46 → 3.51 (#880) | drift | 3.57.0 | no | Prod and tests use different SDK versions: align `Dockerfile.prod` to the pyproject pin. |
| pytest | pyproject | 9.1.1 | 9.2.0 | no | |

### Security alerts (Dependabot, open, 2026-11-20): 152

| Manifest | Count | Critical | Product code? |
|---|---|---|---|
| `projects/project/package-lock.json` (Next 15) | 40 | 3 | no: generated project |
| `output_apps/enterprise_hub/package-lock.json` | 31 | 0 (4 high) | **yes**: mostly fixed by NestJS 11 / Express 5 |
| `templates/saas-chassis/package-lock.json` | 24 | 0 (4 high: nodemailer 7) | template |
| `data/sandboxes/*` (4 apps, Next 16.3) | 52 | 12 | no: sandboxes |
| `templates/roxira-static-rtl` (Next 15) | 2 | 1 | template |
| `output_apps/enterprise_hub/frontend` | 3 | 0 | yes, medium only |

Most of the critical alerts sit in sandboxes and generated projects that never ship. The cheapest real win is to **exclude or delete** those manifests (`data/sandboxes/*`, `projects/project`) from Dependabot. That also removes most of the noise.

## 2. Upgrade order

Each step is one small PR with its own CI run and a review-desk verdict. Runtime steps that touch production images need a local image build on the box before merge, because autodeploy rebuilds on merge.

1. **Done 2026-11-20:** minor/patch groups queued: #966 (hub), #881 (Next 16.4.6), #880 (openai 3.51). Python 3.15 bumps #877 and #878 closed with reasons.
2. **Node 26 everywhere, one wave**: image bumps #875, #876, #879 plus CI parity #1016 (`ci.yml` `NODE_VERSION` 22 → 26, and the four Node 20 workflows → 26), so CI tests what the images run. Checked on the box 2026-11-20 under Node 26.13.1:
   - hub: `tsc --noEmit`, `nest build` and Jest unit specs all pass (318 suites, 3366 tests, 0 failures);
   - frontend: `next build` passes.
   - The frontend `npm test` script (node `--test`) is not run in CI and is already broken: 37 failures on Node 22, 4 on Node 26 (extensionless imports, a TS `enum` in strip-only mode). That is a separate cleanup, not a Node 26 regression.
   - npm 11 in Node 26 skips install scripts that have not been approved (`allowScripts`). Only optional scripts are affected: `msgpackr-extract` (bullmq falls back to pure JS) and the `unrs-resolver` postinstall. `agent-task.yml` stays on Node 20 until the `opencode-ai` global install is checked with approved scripts.
3. **Python 3.11 → 3.13 for `Dockerfile.prod`**: parity with CI and `requires-python`. In the same PR, align `openai` with pyproject and bump the pinned patch versions (torch 2.14.1 stays). Build the full image on the box and run the AI-core smoke test plus `answer_timing` before merge. Research service 3.12 → 3.13 together with its `smoke.sh`. Stragglers (`review-desk.yml`, `model-tournament.yml`) → 3.13.
4. **Dependabot hygiene**: ignore `data/sandboxes/**`, `projects/**` and the Next 15 static template, or delete them if dead. Close the 100+ alerts that never ship.
5. **NestJS 10 → 11** (then 12 in a later PR) with `@nestjs/typeorm` 11, Express 5, Jest 30 and `@types/node` 26. This is the main security fix for the hub. It is lane L5 work, sized at 1–2 PRs, gated by the 3366 unit specs plus the Postgres specs and the M1 Playwright gate.
6. **TypeScript 7 blocking** (T202), then drop TS 5.9 and move ESLint to 10 flat config, or retire ESLint where oxlint covers it.
7. **Data services, one per maintenance window**: Qdrant 1.19 → 1.20 (snapshot first, T213). Redis 7 → Valkey 9 (BSD, drop-in; settles the licence question parked in INFRA_TARGET) together with T217 AOF. Postgres 17 → 18 only with WAL-G in place (#886) and a restore drill, no earlier than Q1 2027. 19.0 waits for 19.2.
8. **Python 3.14** (CI and prod together) in Q1 2027. Every key wheel already has cp314 (skip 3.14.1: torchvision excludes it). **Python 3.15** once torch, tokenizers, onnxruntime and av ship cp315 wheels, expected Q2 2027.
9. **TypeORM 1.x** after NestJS 11 is stable. Expect migration-API changes. One PR plus a fresh-DB migration run.

Spending: none. Everything above is free software, runs on the existing box and server, and uses free CI minutes.

## 3. Rust where it pays

The rule from `INFRA_TARGET_2026-11-17.md` stands: a stage moves to Rust only when, after caching, it is above 30% of p95 in `answer_timing`, and only behind its contract (`ADR_RUST_READY_HOT_PATH.md`). The latency-critical parts are already Rust or C++: TEI, Qdrant, tokenizers, ctranslate2 (faster-whisper), Turbopack, oxlint, TS 7 and LiveKit's media core (`@livekit/rtc-node`).

| Candidate | Expected gain | Cost | Verdict |
|---|---|---|---|
| **uv (Rust) instead of pip** in `Dockerfile.prod` / research / CI | Image builds and CI Python setup 5–10× faster. Reproducible lockfile (`uv.lock`) | Small: 1 PR, no app code | **Do now** (with step 3) |
| **Retrieval service** (axum + qdrant-client + ort) behind `RetrievalBackend` | Removes Python overhead between TEI and Qdrant. Worth it only if retrieval is above 30% of p95 after the T211 cache | Medium: new service, contract tests, deploy | **Wait for the trigger.** Measure with the T211 replay benchmark |
| **Edge proxy** (Pingora / a Rust gateway instead of nginx) | Small: nginx is not a bottleneck at current traffic | Medium–high: ops risk, new config | **No** |
| **Agent orchestrator / lane runners** (`gemini_lanes.sh`, review desk, factory) | None: I/O and model-latency bound | Rewrite with no user-visible gain | **No.** Keep bash/Python |
| **CLI tools** (`claim.sh`, ops scripts) | None measurable | Rewrite | **No** |
| **Document pipeline** (PDF/OCR → Markdown, docling + tesseract) | Possibly large on big uploads, but the heavy part is already native (pymupdf, OCR) | High | **Measure first.** Profile one 200-page upload before deciding |
| **Print/PDF rendering** (invoices, payslips: pdfkit + HTML templates) | Typst (Rust) renders fast, deterministic PDFs with RTL/Persian support | Medium: template port | **Revisit** if PDF render p95 exceeds 1 s or RTL bugs pile up |
| **Phone stack media path** | Already Go (LiveKit) plus Rust (rtc-node core) | — | **No** |

Bottom line: the one Rust step worth doing now is tooling (uv). The product code stays TypeScript and Python until the `answer_timing` trigger fires.

## 4. Revisit dates

- 2027-01 (monthly radar): Python 3.15 wheels (torch, tokenizers, onnxruntime, av), Postgres 18.x maturity, NestJS 12 adoption.
- 2027-04-30: Node 22 EOL. Must be done by then (step 2).
- 2027-10-31: Python 3.11 EOL. Must be done by then (step 3).
