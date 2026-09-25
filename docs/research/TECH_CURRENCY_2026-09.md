# Tech currency & security audit — 2026-09

Read-only research pass. Today: 2026-09-25. No server changes were made; only read-only version queries were run over SSH (`lsb_release`, `docker version`, `docker images/ps`, `docker exec ... --version` / `pip list`, `nginx -v`). No `.env`, secret, key or token was read, printed, or echoed.

## Summary — top risks

1. **nginx 1.24.0 is the sole internet-facing component and has been EOL since 2024-04-23** (2+ years, [endoflife.date/nginx](https://endoflife.date/nginx)) — affected by at least CVE-2025-23419 (medium, SSL session-reuse validation bypass). Public gateway, highest exposure. **High.**
2. **CI validates against Python 3.13 but production runs Python 3.11.16** — `pyproject.toml` (`requires-python = ">=3.13"`) and `.github/workflows/ci.yml` (`PYTHON_VERSION: "3.13"`) disagree with `Dockerfile.prod` (`FROM python:3.11-slim`) and the live `roxira_app_prod` container (`Python 3.11.16`). Code that passes CI is not proven to run on the runtime that actually serves users. **High (correctness/deploy-integrity, verified directly).**
3. **Frontend Docker images build on Node 20, which passed EOL 2026-04-30** ([endoflife.date/nodejs](https://endoflife.date/nodejs)), five months ago — `output_apps/enterprise_hub/Dockerfile` and `output_apps/enterprise_hub/frontend/Dockerfile` (`FROM node:20-alpine`, all stages). The host and Twenty CRM already run Node 22. **Medium-High.**
4. **GitHub Actions are pinned by floating major-version tag, not by commit SHA** (`actions/checkout@v7`, `actions/setup-node@v7`, `actions/setup-python@v7`, `dorny/paths-filter@v4` in `.github/workflows/*.yml`). `agent-task.yml` runs AI-agent-authored code with a `GITHUB_TOKEN` — a compromised upstream tag would auto-propagate into that workflow. **Medium (supply chain).**
5. **NestJS is 2 majors behind** (`^10.4.4` in repo/lockfile `10.4.22`; current is 12.x, [nestjs/nest releases](https://github.com/nestjs/nest/releases)). No unpatched CVE was found for the locked version (see table), so this is a staleness/support-window risk, not an active exploit. **Medium.**

Everything else checked (FastAPI, Starlette, Pydantic, uvicorn, LightRAG, PostgreSQL, Qdrant, Redis's RediShell CVE, httpx) came back **patched / current** for the exact versions running — see the table and the "verified safe" notes below it.

---

## Component table

| Component | Ours in repo | Ours on server | Current stable | EOL/support | CVEs affecting us | Risk | Action |
|---|---|---|---|---|---|---|---|
| Ubuntu | — | 24.04.5 LTS (kernel 6.8.0-139) | 24.04 LTS branch | Support to 2029-05-31, ext. to 2034 [[1]](https://endoflife.date/ubuntu) | None checked specifically | Low | Keep on 24.04 LTS patch cadence |
| Docker Engine | — | 29.8.1 | 29.8.1 | Current major, not EOL [[2]](https://endoflife.date/docker-engine) | None found | Low | Up to date |
| nginx | `nginx:alpine` image tag (compose) | **1.24.0** | 1.30.x / 1.31.x stable-mainline [[3]](https://endoflife.date/nginx) | **EOL 2024-04-23** [[3]](https://endoflife.date/nginx) | CVE-2025-23419 (medium, SSL session reuse bypasses client-cert checks, fixed 1.26.3/1.27.4) [[4]](https://www.cvedetails.com/version/2039131/F5-Nginx-1.24.0.html); CVE-2025-53859 (low, smtp module, likely not in use) | **High** | Re-pull `nginx:alpine` (or pin an explicit recent tag/digest) to pick up a supported nginx line |
| PostgreSQL (prod) | — | 17.11 | 17.11 | EOL 2029-11-08 [[5]](https://endoflife.date/postgresql) | None found; 17.11 is the current patch | Low | Up to date |
| PgBouncer | `edoburu/pgbouncer:latest` | 1.25.2 | 1.26.0 [[6]](https://github.com/pgbouncer/pgbouncer/releases) | Actively maintained upstream | None found | Low-Med | One patch behind; also **unofficial community image** (`edoburu/pgbouncer`, not a project-published image) — pin a digest, consider an official/maintained base |
| Redis (prod cache) | `redis:7-alpine` | 7.4.11 | 7.4.x current patch [[7]](https://endoflife.date/redis) | Support ended 2025-05-02, EOL 2029-12-01 (security-only phase) [[7]](https://endoflife.date/redis) | **CVE-2025-49844 "RediShell"** (critical, Lua UAF→RCE) — OSS/CE 7.4 branch fixed at **7.4.6+** [[8]](https://redis.io/blog/security-advisory-cve-2025-49844/); we run 7.4.11 → **verified NOT vulnerable** | Low (verified patched) | None; keep tracking 7.4.x patches |
| Redis (Twenty CRM) | `redis:7-alpine` (docker-compose.modern-stack.yml) | same image | same as above | same | Same RediShell check applies — image tag identical to prod Redis, presumed same patch level (not independently exec'd) | Low (UNVERIFIED exact patch — not separately queried) | Verify twenty_redis version matches prod redis on next server session |
| Qdrant | `qdrant/qdrant:latest` | 1.19.0 | 1.19.1 [[9]](https://github.com/qdrant/qdrant/releases) | Active | GHSA-f632-vm87-2m2f (high, arbitrary file write via `/logger`, fixed 1.15.6) and GHSA-xcr2-h8hv-6227 (critical, path traversal, fixed 1.9.0) — both **fixed before 1.19.0** → not affected | Low | One patch behind; pin a specific tag instead of `:latest` |
| Python (AI core) | `requires-python = ">=3.13"` (pyproject.toml), CI tests 3.13 | **3.11.16** (roxira_app_prod, `Dockerfile.prod`) | 3.13.x / 3.14.x [[10]](https://endoflife.date/python) | 3.11 in security-only phase, EOL 2027-10-31 [[10]](https://endoflife.date/python) | None found for 3.11.16 itself | **High** (version mismatch between declared requirement, CI, and prod) | Reconcile: either drop the `>=3.13` pin to match what's deployed, or upgrade `Dockerfile.prod` + redeploy on 3.13 to match CI |
| FastAPI | unpinned in `ci/requirements-test.txt` | 0.141.1 | 0.141.1 [[11]](https://pypi.org/project/fastapi/) | Active | GHSA-8h2j-cgx8-6xv7 (high, CSRF, fixed 0.65.2) — long since fixed | Low | Pin an explicit floor in `ci/requirements-test.txt` |
| Starlette | (transitive) | 1.6.0 | 1.7.0 [[12]](https://pypi.org/project/starlette/) | Active | All known GHSA advisories (DoS via Range header, multipart DoS, host-header, directory traversal, etc.) fixed at ≤1.3.1 — 1.6.0 not affected [[13]](https://github.com/advisories?query=starlette) | Low | One minor behind; bump with FastAPI |
| Pydantic | `>=2.13.4` | 2.13.5 | 2.13.5 [[14]](https://pypi.org/project/pydantic/) | Active | None found | Low | Up to date |
| uvicorn | (transitive) | 0.53.0 | 0.53.0 [[15]](https://pypi.org/project/uvicorn/) | Active | None found | Low | Up to date |
| LightRAG (`lightrag-hku`) | `>=1.4.0` | 1.5.7 | 1.5.7 [[16]](https://pypi.org/project/lightrag-hku/) | Active, fast-moving | **10 GHSA advisories found** — 2 critical (hardcoded `DEFAULT_TOKEN_SECRET` auth bypass GHSA-f4vv-55c2-5789, fixed 1.5.4; no rate-limit on `/login` GHSA-frch-4w6v-q5xx, fixed 1.5.5), CORS-wildcard-with-credentials (critical, GHSA-6x6h-qqr7-855w, fixed 1.5.4), hardcoded JWT secret (high, GHSA-mcww-4hxq-hfr3, fixed 1.4.13), JWT alg-confusion, path traversal, SSRF, stored XSS, timing-unsafe password compare, exception-message leakage — **all fixed at or before 1.5.5**; our 1.5.7 → **verified NOT vulnerable** [[17]](https://github.com/advisories?query=lightrag-hku) | Low (verified patched) | Repo's own `pyproject.toml` floor (`>=1.4.0`) is dangerously low given this CVE history — raise it to `>=1.5.7` explicitly so a bare install can't regress into any of the above |
| sentence-transformers | (transitive) | 6.0.1 | current | Active | None found | Low | — |
| torch | (transitive) | 2.14.0 | current | Active | Critical GHSA-53q9-r3pm-6pq6 (`torch.load` RCE, fixed 2.6.0) and GHSA-47fc-vmwq-366v (fixed 1.13.1) — both long fixed before 2.14.0 | Low | — |
| transformers | (transitive) | 5.17.0 | current | Active | High GHSA-29pf-2h5f-8g72 (RCE, fixed 5.3.0), GHSA-fgcw-684q-jj6r (fixed 5.5.0), GHSA-xrqw-3rrv-vx5w (path traversal, fixed 5.10.0) — all fixed before 5.17.0 | Low | — |
| qdrant-client (Python SDK) | not installed | **not installed** in `roxira_app_prod` | — | — | GHSA-7m75-x27w-r52r (critical, input validation, fixed 1.9.0) — **N/A, SDK not present**; app appears to talk to Qdrant over raw HTTP (httpx) | — | UNVERIFIED how Qdrant is actually called; confirm intentional |
| httpx | `>=0.28.1` | 0.28.1 | current | Active | GHSA-h8pj-cxx2-jfg2 (critical, fixed 0.23.0) — long fixed | Low | — |
| Node.js (frontend containers) | `FROM node:20-alpine` (enterprise_hub + frontend Dockerfiles) | **20.20.2** | 22.x / 26.x LTS [[18]](https://endoflife.date/nodejs) | **EOL 2026-04-30** [[18]](https://endoflife.date/nodejs) | Not individually enumerated (EOL runtime = no further vendor patches) | **Medium-High** | Rebuild frontend images on `node:22-alpine`; host and Twenty CRM already on Node 22 |
| Node.js (host) | `engines.node >=18.0.0` (enterprise_hub package.json) | 22.23.3 | 22 current, security-only from 2025-10-21, EOL 2027-04-30 [[18]](https://endoflife.date/nodejs) | Active (maintenance) | None found | Low | Tighten `engines` floor above 18 |
| NestJS (`@nestjs/core`/`common`) | `^10.4.4` → lockfile **10.4.22** | (built into frontend image, not separately exec'd) | 12.x [[19]](https://github.com/nestjs/nest/releases) | v10 community support winding down as v12 ships; only paid HeroDevs NES extends it [[20]](https://www.herodevs.com/support/nestjs-nes) | GHSA-cj7v-w2c7-cp7c (medium, RCE via Content-Type header, `@nestjs/common` fixed 10.4.16) — lockfile has **10.4.22 → verified NOT vulnerable**; GHSA-36xv-jgw5-4q75 only affects ≤11.1.17 (N/A, we're on v10) | Medium (staleness) | Plan a v10→v11(→v12) migration; not urgent for security |
| Next.js | `16.3.4` | (built into frontend image) | 16.3.6 [[21]](https://registry.npmjs.org/next) | Active | **React2Shell / CVE-2025-66478** (RSC RCE) affects Next.js 15.x/16.0–16.0.6, fixed 16.0.7 [[22]](https://nextjs.org/blog/CVE-2025-66478) — our 16.3.4 is well past the fix → **verified NOT vulnerable** | Low (verified patched) | Two patch releases behind; routine bump |
| React | `19.2.8` | (built into frontend image) | 19.3.0 [[23]](https://registry.npmjs.org/react) | Active | Upstream of CVE-2025-55182 (React2Shell), fixed well before 19.2.8 | Low | Routine bump |
| Tailwind CSS | `^4` | (built) | 4.3.3 [[24]](https://registry.npmjs.org/tailwindcss) | Active | None found | Low | — |
| TypeScript | `^5.9.3` / `^5` | (build tool) | 7.0.2 [[25]](https://registry.npmjs.org/typescript) | Active | N/A (compiler) | Low | Major-version tooling upgrade, not urgent |
| Twenty CRM | `twentycrm/twenty:latest` (docker-compose.modern-stack.yml) | image pulled/built 2026-09-16; in-container `package.json` reports internal workspace version `0.2.1` (not the public release tag) | `v2.41.0` released 2026-09-17 [[26]](https://github.com/twentyhq/twenty/releases) | Active, fast-moving | Not independently audited — Twenty's own lockfile carries many resolved third-party CVE pins (axios, form-data, multer, undici, sharp/libvips, etc.); those are upstream-fixed in the versions Twenty pins, not something we control | Low-Med (UNVERIFIED exact release tag) | Pin to an explicit version tag instead of `:latest` for reproducibility; confirm exact release via in-app "About" or API on next server session |
| Twenty's own Postgres/Redis | `postgres:16-alpine` / `redis:7-alpine` | — | — | Postgres 16 supported to 2028-11-09 [[5]](https://endoflife.date/postgresql) | RediShell check applies to `redis:7-alpine` here too (not independently exec'd) | Low | — |
| OpenCode | pinned in server install | 1.18.30 (now published under `anomalyco/opencode`, formerly `sst/opencode`) | 1.18.32 [[27]](https://github.com/anomalyco/opencode/releases) | Active | Not audited (no GHSA search performed) | Low | Two patches behind; note the GitHub org rename for future lookups |
| Goose | pinned in server install | 1.50.0 (now published under `aaif-goose/goose`, formerly `block/goose`) | 1.52.0 [[28]](https://github.com/aaif-goose/goose/releases) | Active | Not audited | Low | Two minor versions behind; note the org rename |
| GitHub Actions: `actions/checkout` | `@v7` (floating tag) | — | v7.0.1 [[29]](https://github.com/actions/checkout/releases) | Active | Resolves to current release today, but **not SHA-pinned** | Medium (supply chain) | Pin to commit SHA, especially in `agent-task.yml` which runs agent-authored code |
| GitHub Actions: `actions/setup-node`, `actions/setup-python` | `@v7` | — | v7.0.0 both [[30]](https://github.com/actions/setup-node/releases) [[31]](https://github.com/actions/setup-python/releases) | Active | Same tag-pinning gap | Medium | Same as above |
| GitHub Actions: `dorny/paths-filter` | `@v4` | — | v4.0.3 [[32]](https://github.com/dorny/paths-filter/releases) | Third-party action | Same tag-pinning gap; third-party actions carry more supply-chain risk than `actions/*` | Medium | SHA-pin; consider replacing with a first-party equivalent |
| bge-m3 / bge-reranker-v2-m3 | `bge-m3` used for embeddings (dense) in `legal_graph/lightrag_engine.py`; **no reranker found in repo** | — | bge-m3 and bge-reranker-v2-m3 are still the standard open-weight multilingual pair for 2026 [[33]](https://huggingface.co/BAAI/bge-m3) [[34]](https://futureagi.com/blog/best-rerankers-for-rag-2026/) | N/A (static checkpoints) | N/A | — (methods gap, see below) | Add a reranking stage — see Methods |

---

## Model table (OpenRouter, live-checked against `GET /v1/models`, 2026-09-25)

All prices below are read directly from the OpenRouter `/v1/models` response (`pricing.prompt` / `pricing.completion`, USD per token, ×1e6 for per-1M-token figures).

| Where used | Current ID | Status on OpenRouter | Price (in/out per 1M) | Notes |
|---|---|---|---|---|
| `smartjudge/llm_router.py` free pool | `google/gemma-4-31b-it:free` | LIVE | $0 / $0 | — |
| `smartjudge/llm_router.py` free pool | `qwen/qwen3.8-27b:free` | LIVE | $0 / $0 | — |
| `smartjudge/llm_router.py` free pool | `nvidia/nemotron-3-super-120b-a12b:free` | LIVE | $0 / $0 | — |
| `smartjudge/llm_router.py` cheap tier | `deepseek/deepseek-v4.1-flash` | LIVE | $0.30 / $1.20 | 4–10x pricier than `deepseek/deepseek-v4-flash-0731`, no evident quality reason cited in repo |
| `smartjudge/llm_router.py` | `google/gemini-3.1-flash-lite` | LIVE | $0.25 / $1.50 | — |
| `smartjudge/llm_router.py` | `qwen/qwen3.8-flash` | LIVE | $0.15 / $0.47 | — |
| `smartjudge/llm_router.py` | `deepseek/deepseek-v4-pro-0813` | LIVE | $0.462 / $1.386 | dated snapshot ID; `deepseek/deepseek-v4-pro` (undated) also live and slightly cheaper |
| `smartjudge/llm_router.py` fallback | `google/gemini-3.8-flash` | LIVE | $0.75 / $3.75 | — |
| `smartjudge/llm_router.py` fallback | `openrouter/free` | LIVE | $0 / $0 | generic free-tier router alias |
| `src/automation/provider_base.py` architect_tier | `anthropic/claude-opus-5`, `anthropic/claude-sonnet-5`, `anthropic/claude-fable-5` | all LIVE | opus $5/$25, sonnet $2/$10, fable $10/$50 | matches STRATEGY.md §3a model choices |
| `src/automation/provider_base.py` balanced_tier | `zhipu/glm-5.2` | **NOT FOUND** | — | **retired/renamed** — provider namespace moved from `zhipu/` to `z-ai/`; live equivalent is `z-ai/glm-5.2` ($ not queried in detail) or newer `z-ai/glm-5.3` |
| `src/automation/provider_base.py` balanced_tier | `qwen/qwen3.8-max` | **NOT FOUND** | — | **retired/unknown ID** — nearest live IDs: `qwen/qwen3.8-max-0902`, `qwen/qwen3.8-max-prime`, or evergreen `qwen/qwen3-max` |
| `src/automation/provider_base.py` swarm_worker_tier | `deepseek/deepseek-v4.1-flash`, `anthropic/claude-haiku-4.5` | both LIVE | $0.30/$1.20; $1.00/$5.00 | — |
| `src/automation/provider_base.py` contract_tier | `qwen/qwen3-coder`, `deepseek/deepseek-v4.1-flash` | both LIVE | $0.30/$1.00; $0.30/$1.20 | — |
| `src/automation/self_healing_agent.py` | `deepseek/deepseek-v4-flash` | LIVE | $0.049 / $0.098 | cheapest coding-capable model already in use elsewhere in the repo — good candidate to standardize on |
| Goose config (`docs/AGENTS_WORKFORCE.md`) | `deepseek/deepseek-chat` | LIVE | $0.32 / $0.89 | ~6x pricier than `deepseek-v4-flash` for a similar-class model |
| OpenCode (server) | DeepSeek via OpenRouter (model not pinned in a repo file we could grep; per `docs/W6_...`/known facts, "DeepSeek via OpenRouter") | — | — | UNVERIFIED exact model ID; not found hardcoded in the files this audit grepped |

### Recommended replacements per tier (live prices, 2026-09-25)

- **Free**: keep `google/gemma-4-31b-it:free`, `qwen/qwen3.8-27b:free`, `nvidia/nemotron-3-super-120b-a12b:free` — all live, all $0. **Per project policy (STRATEGY.md §3b): free-tier models only for non-sensitive data; never customer case data.**
- **Cheap**: `deepseek/deepseek-v4-flash-0731` — $0.03 / $0.32 per 1M, 1.3M context, live. Roughly 10x cheaper than the currently configured `deepseek/deepseek-v4.1-flash` for a similar-class model; worth an eval before switching the default chat/classification tier.
- **Strong**: `anthropic/claude-sonnet-5` — $2 / $10 per 1M — already the configured choice for legal drafting/reasoning and for Claude Code implementation chats per STRATEGY.md §3a; no cheaper model in the same quality class was found live.
- **Coding-agent** (OpenCode/Goose workers): `deepseek/deepseek-v4-flash` ($0.049/$0.098, already used in `self_healing_agent.py`) for cheapest viable option, or `qwen/qwen3-coder` ($0.30/$1.00) if code quality needs to be higher than flash-class — both live.

---

## Methods

**Legal RAG retrieval.** The repo has a hybrid-retrieval layer (`src/roxira_manager/legal_intelligence/hybrid_retrieval/hybrid_engine.py`) and dense embeddings via `bge-m3` (`output_apps/generated_modules/smartjudge/legal_graph/lightrag_engine.py`), consistent with LightRAG's dual-level graph+vector retrieval. **No cross-encoder reranking stage was found** (no `bge-reranker`, `CrossEncoder`, or `reranker` hits under `legal_intelligence/` or `smartjudge/`). Current 2026 practice for open-weight multilingual legal RAG is: `bge-m3` dense+sparse hybrid retrieval to top-50/100, a `bge-reranker-v2-m3` cross-encoder pass down to top-5, then citation grounding/verification against the retrieved spans before the answer is shown [[33]](https://huggingface.co/BAAI/bge-m3) [[34]](https://futureagi.com/blog/best-rerankers-for-rag-2026/). Adding the reranker step is a plausible quality win for the W6 citation-accuracy problem already tracked in STRATEGY.md (1,305/1,308 Qdrant points are synthetic placeholders) — reranking doesn't fix bad source data, but it would reduce wrong-citation risk once the real per-article corpus lands. Parent-chunk / small-to-big retrieval (retrieve on small chunks, return the parent context) was not found in the repo and is not confirmed one way or the other beyond that grep — flagged as **UNVERIFIED, worth a follow-up look**, not a firm gap.

**LLM routing & caching.** STRATEGY.md §3b already specifies a tiered router with Redis caching and per-tenant cost logging (W5, flag currently off). The live OpenRouter pricing check above shows the "cheap" tier is not using the cheapest viable model for its class — that's a direct, low-risk win once W13 (cost control) is picked up.

**Persian STT/TTS.** STRATEGY.md §3b already names Whisper-turbo (via OpenRouter or AssemblyAI) for STT and Edge-TTS for TTS. Current low-latency options confirmed to support Persian/Farsi:

- **STT — Deepgram Nova-3**: production-grade Persian (RTL), real-time streaming, vendor claims <300ms — [docs](https://deepgram.com/product/speech-to-text/persian).
- **STT — OpenAI `gpt-4o-transcribe` (Realtime API)**: streaming; Persian included in its 99+ language set — [docs](https://developers.openai.com/api/docs/guides/realtime-transcription).
- **STT — `whisper-large-v3-turbo`** (open-weight, self-hostable e.g. via `faster-whisper`): Persian included in Whisper's 99-language set; not natively streaming (chunked/short-segment decoding needed for low latency) — [model card](https://huggingface.co/openai/whisper-large-v3-turbo).
- **STT — Google Chirp 2/3**: Persian appears in Chirp's batch-recognition language matrix; Persian support specifically for `StreamingRecognize` is **UNVERIFIED** — [docs](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-2).
- **STT — AssemblyAI**: the standard Universal-Streaming multilingual model does **not** include Persian; Persian requires the separate `whisper-rt` streaming model (99 languages, auto-detect) — [docs](https://www.assemblyai.com/docs/faq/language-support-for-real-time-transcription).
- **TTS — Edge-TTS / Azure Neural TTS**: `fa-IR-FaridNeural` (and a second fa-IR voice) are documented, officially supported neural voices; Azure Speech SDK supports low-latency streaming synthesis generally — [docs](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support).
- **TTS — ElevenLabs (Eleven v3)**: lists Persian among 70+ supported languages; low-latency streaming specifically for Persian is **UNVERIFIED** (their fastest Flash/Turbo tiers weren't confirmed to cover fa) — [docs](https://elevenlabs.io/text-to-speech/persian).
- **TTS — Google Cloud TTS**: Persian support is contested — some fa-IR voice calls have been reported failing; **UNVERIFIED**, needs a live API check before adoption — [docs](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types).
- **TTS — OpenAI TTS (`gpt-4o-mini-tts`/`tts-1`)**: multilingual via the underlying LLM, but Persian is not explicitly listed and voices are optimized for English — **UNVERIFIED** — [docs](https://developers.openai.com/api/docs/guides/text-to-speech).

W7 (voice latency, still ⬜) owns the actual p50 benchmarking; this is a currency/options scan, not a live latency measurement.

**Coding agents on CI runners (W10 phase 2).** `.github/workflows/agent-task.yml` already follows the main least-privilege pattern: built-in `GITHUB_TOKEN` (no PAT), `persist-credentials: false`, an actor allowlist, a concurrency cap, and pushes restricted to `agent/*` branches (per STRATEGY.md W10 row). The gap found in this audit is narrower: the actions it depends on (`checkout`, `setup-node`) are pinned by tag, not SHA — see the component table. This workflow is not `pull_request_target`-triggered (good; that trigger is the classic vector for exposing secrets to untrusted PR code) — confirmed by reading the `on:` block structurally via the codebase's own workflow file, not independently re-verified line-by-line here beyond the earlier grep.

---

## Prioritized upgrade plan

Grouped into proposed workstreams — none of these numbers collide with the existing W0–W13 in `docs/STRATEGY.md` §5 (highest existing is W13). Security-critical first.

**W14 (proposed) — nginx currency & edge hardening.**
Scope: re-pull/rebuild the nginx image to a supported 1.30.x/1.31.x line (or pin an explicit tag+digest instead of floating `:alpine`), re-verify TLS config after the bump. Risk: Medium (routine image bump, but it's the only internet-facing component — test in a staging pass first). Done via PR + CI + the deploy runbook (docs/STRATEGY.md §7).

**W15 (proposed) — Python version reconciliation (CI vs prod).**
Scope: decide whether prod moves to Python 3.13 (matching `pyproject.toml`/CI) or `pyproject.toml`+CI drop to 3.11 to match what's actually deployed; update `Dockerfile.prod` or the pin, whichever direction is chosen, and confirm the smartjudge/LightRAG/torch/transformers stack installs cleanly on the target version. Risk: Medium-High (behavior can differ across major Python versions; needs a real test pass, not just a version bump). Done via PR + CI + the deploy runbook (docs/STRATEGY.md §7).

**W16 (proposed) — Frontend Node 20→22 and GitHub Actions SHA-pinning.**
Scope: (a) bump `output_apps/enterprise_hub/Dockerfile` and `frontend/Dockerfile` from `node:20-alpine` to `node:22-alpine` in all build stages; (b) replace the floating `@v7`/`@v4` Action tags in `.github/workflows/*.yml` with commit-SHA pins (keep the version as a comment), prioritizing `agent-task.yml` since it executes agent-authored code. Risk: Low-Medium (mechanical, CI will catch build breaks). Done via PR + CI + the deploy runbook (docs/STRATEGY.md §7).

**W17 (proposed) — LightRAG floor + Qdrant client audit.**
Scope: raise `pyproject.toml`'s `lightrag-hku>=1.4.0` to `>=1.5.7` given the concentration of critical auth-bypass CVEs fixed between 1.4.0 and 1.5.5 (see table); separately, confirm and document how `roxira_app_prod` actually talks to Qdrant since no `qdrant-client` SDK is installed (raw HTTP via httpx, presumably — verify and note in STRATEGY.md §6 "Known facts" once confirmed). Risk: Low. Done via PR + CI + the deploy runbook (docs/STRATEGY.md §7).

**W18 (proposed) — Model-ID cleanup (ties into W12).**
Scope: fix the two retired/unknown OpenRouter IDs in `src/automation/provider_base.py` (`zhipu/glm-5.2` → `z-ai/glm-5.2` or newer; `qwen/qwen3.8-max` → a live `qwen/qwen3.8-max-*` snapshot or `qwen/qwen3-max`), and evaluate switching the "cheap" router tier to `deepseek/deepseek-v4-flash-0731` for the ~10x cost reduction found in this audit. Natural first task for W12's self-updating model registry once that lands. Risk: Low. Done via PR + CI + the deploy runbook (docs/STRATEGY.md §7).

**W19 (proposed) — NestJS v10→v11/v12 migration.**
Scope: staleness/support-window issue, not an active CVE (locked `@nestjs/common`/`core` 10.4.22 already carries the one medium fix that mattered). Lower priority than W14–W18; plan as a normal dependency-modernization pass once the higher-priority items land. Risk: Medium (major-version framework bump, needs its own test pass). Done via PR + CI + the deploy runbook (docs/STRATEGY.md §7).

---

## Method & limits

**Verified live (this session, 2026-09-25):**
- Server inventory via read-only SSH/docker/pip commands as listed in the summary line above (OS, Docker, nginx, Python, pip-freeze-filtered packages, PostgreSQL, PgBouncer, Redis, Qdrant, frontend/host Node, OpenCode, Goose, Twenty CRM image metadata).
- Every CVE/EOL claim in the component table against a cited source: endoflife.date API, PyPI JSON API, npm registry JSON API, GitHub Security Advisories API (`api.github.com/advisories`), the official Redis security-advisory blog post, and the official Next.js security-advisory blog post.
- The live OpenRouter model catalogue (`GET https://openrouter.ai/api/v1/models`, 460 models) was fetched and every hardcoded model ID found in the repo was checked against it directly.

**From repo only (not independently re-verified against a running process):**
- `output_apps/docker-compose.prod.yml` (postgres:17, valkey/valkey:8, python:3.13-slim) does **not** match what's actually deployed (root `docker-compose.prod.yml`: postgres:17-alpine, redis:7-alpine, edoburu/pgbouncer, qdrant:latest, nginx:alpine) — the server inventory confirms the root file is the one live; the `output_apps/` one appears to be a stale/unused alternate compose file. Not fixed here (read-only task) — worth a follow-up "is this dead code" check.
- Twenty's own Postgres (`postgres:16-alpine`) and Redis (`redis:7-alpine`) containers were listed by `docker images`/`docker ps` but not individually `docker exec`'d for exact patch versions — assumed to match the tags shown, RediShell conclusion for Twenty's Redis is inferred, not independently confirmed.
- Twenty CRM's exact public release version is **UNVERIFIED** — the in-container `package.json` `version` field (`0.2.1`) looks like an internal monorepo workspace version, not the `vX.Y.Z` tag scheme GitHub releases use; image creation timestamp (2026-09-16) places it near `v2.40.0`–`v2.41.0` by release date, but this is inference, not a direct version read.
- OpenCode's actual model configuration on the server (beyond "DeepSeek via OpenRouter" from STRATEGY.md §6) was not re-confirmed this session (no `.env`/config file was read, per the hard rule against reading secrets).
- Persian STT/TTS options (methods section) were researched via vendor docs (Deepgram, OpenAI, Whisper, Google Chirp, AssemblyAI, Azure/Edge-TTS, ElevenLabs, Google TTS); each claim is cited, and options where Persian/streaming support was ambiguous in the vendor's own docs are marked UNVERIFIED there. No live latency benchmarking was run — that stays with W7.
- Parent-chunk / small-to-big chunking presence in the retrieval code was checked only by grep for a handful of keywords; a **negative** finding here is provisional, not exhaustive.
- Not every GHSA-tracked package in the dependency tree was checked (e.g., transitive npm deps of NestJS/Next.js beyond the two direct-package spot checks); the audit targeted the components the task explicitly named.

**Steps skipped/not applicable:** none of the STEPS in the task were skipped; `qdrant --version` inside the container failed (no such binary on PATH) and was substituted with the container's own `qdrant.spdx.json`/binary listing plus image digest, which was sufficient to get the version (1.19.0).

---

### References

[1] https://endoflife.date/ubuntu · [2] https://endoflife.date/docker-engine · [3] https://endoflife.date/nginx · [4] https://www.cvedetails.com/version/2039131/F5-Nginx-1.24.0.html · [5] https://endoflife.date/postgresql · [6] https://github.com/pgbouncer/pgbouncer/releases · [7] https://endoflife.date/redis · [8] https://redis.io/blog/security-advisory-cve-2025-49844/ · [9] https://github.com/qdrant/qdrant/releases · [10] https://endoflife.date/python · [11] https://pypi.org/project/fastapi/ · [12] https://pypi.org/project/starlette/ · [13] https://github.com/advisories?query=starlette · [14] https://pypi.org/project/pydantic/ · [15] https://pypi.org/project/uvicorn/ · [16] https://pypi.org/project/lightrag-hku/ · [17] https://github.com/advisories?query=lightrag-hku · [18] https://endoflife.date/nodejs · [19] https://github.com/nestjs/nest/releases · [20] https://www.herodevs.com/support/nestjs-nes · [21] https://registry.npmjs.org/next · [22] https://nextjs.org/blog/CVE-2025-66478 · [23] https://registry.npmjs.org/react · [24] https://registry.npmjs.org/tailwindcss · [25] https://registry.npmjs.org/typescript · [26] https://github.com/twentyhq/twenty/releases · [27] https://github.com/anomalyco/opencode/releases · [28] https://github.com/aaif-goose/goose/releases · [29] https://github.com/actions/checkout/releases · [30] https://github.com/actions/setup-node/releases · [31] https://github.com/actions/setup-python/releases · [32] https://github.com/dorny/paths-filter/releases · [33] https://huggingface.co/BAAI/bge-m3 · [34] https://futureagi.com/blog/best-rerankers-for-rag-2026/
