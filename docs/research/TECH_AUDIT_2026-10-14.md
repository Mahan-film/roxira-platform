# Technology Audit — Roxira Platform (2026-10-14)

Concise, evidence-based inventory of every runtime image, Python/Node library, AI model and
tool in the Roxira stack. Versions below are **exactly what was read in the repo** on the files
listed at the end. Where a version is not declared anywhere in the audited files it is written
as `verify` — never guessed.

Legend: effort **S/M/L**; priority **P0** (do now) / **P1** (soon) / **P2** (backlog).
Every image using an unpinned `:latest` tag is flagged **P0** (supply-chain risk).

## 1. Runtime & infrastructure images

| Component | Pinned/current version in repo | Purpose | Risk | Upgrade candidate | Effort | Pri |
| --- | --- | --- | --- | --- | --- | --- |
| postgres (main) | `17-alpine`, digest `sha256:18cfe3…` | Main DB `enterprise_db` | Low; major upgrade needs dump/restore | `postgres:18-alpine` (verify version) | M | P2 |
| postgres (Twenty) | `16.9-alpine` (tag only, no digest) | Twenty CRM DB | Two PG majors to maintain; mutable tag | align to 17 + pin digest (verify) | M | P1 |
| edoburu/pgbouncer | **`:latest`** @ digest `sha256:4c1ca2…` | Postgres connection pooling (:6432) | **`:latest` tag = supply-chain P0**; digest mitigates but tag is drifting | pin to an explicit version tag (verify) | S | P0 |
| redis (main) | `7-alpine`, digest `sha256:ff02b5…` | Cache / BullMQ | Low; v7 stable | `redis:8-alpine` / Valkey (verify) | M | P2 |
| redis (Twenty) | `7.4.11-alpine` (no digest) | Twenty cache/queue | Minor-version drift; mutable tag | align to main + pin digest | S | P1 |
| qdrant/qdrant | `v1.19.0`, digest `sha256:057ee3…` | Vector store | Low; explicit tag + digest | track latest v1.x (verify) | S | P2 |
| nginx | `alpine`, digest `sha256:db35bf…` | TLS gateway (80/443) | Floating `alpine` tag, no explicit nginx version | pin `nginx:1.x-alpine` + digest (verify) | S | P1 |
| twentycrm/twenty | `v2.41.0` (tag only) | CRM app (:3002) | No digest; version drift | current v2.x (verify) | S | P1 |
| tecnativa/docker-socket-proxy | `v0.5.0`, digest `sha256:1f5038…` | Read-only Docker API proxy | Low; correct hardened pattern | none | S | P2 |
| searxng/searxng | **`:latest`** (no digest) | Research metasearch (:8888) | **`:latest` = supply-chain P0**; non-reproducible | pin a tagged release + digest (verify) | S | P0 |
| valkey/valkey | `8-alpine` (no digest) | Research-stack cache | Mutable tag, no digest | pin digest (verify) | S | P2 |
| unclecode/crawl4ai | `0.9.4` (no digest) | Research crawler (:11235) | No digest | pin digest (verify) | S | P2 |
| python (AI core base) | `3.11-slim` (builder + runtime, no digest) | AI-core image base | Unpinned patch; contradicts `pyproject.toml` `requires-python >=3.13` | `python:3.13-slim` + digest (verify) | M | P1 |
| node (backend/frontend base) | `20-alpine` (no digest) | NestJS + Next base | Unpinned patch; Node 20 nearing EOL | `node:22-alpine` LTS + digest (verify) | S | P1 |
| ghcr.io/berriai/litellm | `main-v1.77.7-stable` | Key-pool gateway (:4000) | Moving `main-…-stable` branch tag | pin by digest (verify) | S | P1 |
| xray-core | `v25.8.3` + `sha256:7bcc35…` (`install_xray_reality.sh`) | Emergency VLESS+REALITY VPN | Pinning is exemplary (version + SHA, fail-closed) | keep; refresh quarterly | S | P2 |

## 2. Python dependencies (AI core — `Dockerfile.prod` / `pyproject.toml` / CI)

| Component | Pinned/current version in repo | Purpose | Risk | Upgrade candidate | Effort | Pri |
| --- | --- | --- | --- | --- | --- | --- |
| torch / torchvision | `2.14.1` / `0.29.1` (exact, CPU index) | Embeddings + Whisper on CPU | Good exact pin; large image | newer CPU wheels (verify version) | S | P2 |
| lightrag-hku / openai | `1.5.7` / `3.22.1` (exact) | Legal knowledge-graph RAG | Good exact pin | keep; revisit on RAG change | S | P2 |
| fastapi | unpinned (`Dockerfile.prod`) | AI-core web framework | Reproducibility + security drift | pin exact (verify) | S | P0 |
| uvicorn | unpinned | ASGI server | Same as above | pin exact | S | P0 |
| langgraph | unpinned | Agent/RAG orchestration | Fast-churning API, unpinned | pin exact (verify) | M | P0 |
| sentence-transformers | unpinned | bge-m3 embeddings runtime | Unpinned; weights are a separate artifact | pin exact | M | P1 |
| faster-whisper | unpinned | Local STT | Unpinned | pin exact | M | P1 |
| docling | unpinned (image) / `>=2.5.0` (pyproject) | PDF/Word/image → Markdown OCR | Fast-moving, unpinned in the image | pin exact | M | P1 |
| pydantic | `>=2.13.4` / `>=2.13` (CI) | Validation | Range, no lock | pin exact | S | P1 |
| psycopg | unpinned (image) / `>=3.3.4` (pyproject) / `>=3.3` (CI) | Postgres driver | Three different specs, none pinned | unify + pin | S | P1 |
| httpx | `>=0.28.1` | HTTP client | Range | pin | S | P2 |
| pymupdf | `>=1.24.0` | PDF parsing | Range | pin via lock | S | P2 |
| python-docx | `>=1.1.0` | DOCX parsing | Range | pin | S | P2 |
| pillow / pillow-heif | `>=10.0` / `>=0.18` | Image + HEIC case files | Ranges | pin | S | P2 |
| redis (py) | unpinned | Redis client | Unpinned | pin | S | P2 |
| sqlalchemy | unpinned | ORM | Unpinned | pin | S | P2 |
| python-multipart | `>=0.0.12` (CI) / unpinned | Multipart uploads | Range | pin | S | P2 |
| edge-tts | unpinned | Persian TTS (free) | Unpinned; external service dependency | pin | S | P2 |
| google-genai | unpinned | Optional Gemini live voice | Unpinned preview API | pin | M | P2 |
| django | `==5.2.16` (pyproject) | Legacy (STRATEGY: "do not build on it") | Lock-in to unused subsystem | plan removal (not upgrade) | M | P1 |
| crawlee[...] | `>=1.8.3,<2` | Research crawler | Range | pin | S | P2 |
| mcp | `>=1.2.0` | Radar MCP server | Range | pin | S | P2 |
| ruff | `>=0.16.2` | Linter | Range | pin | S | P2 |
| mypy | `>=2.3.0` | Type checker | Range | pin | S | P2 |
| pytest / pytest-timeout / pytest-django | `>=9.1.1` / `>=2.3` / `>=4.13.0` | Test tooling | Ranges | pin | S | P2 |

## 3. Node / frontend / backend frameworks

| Component | Pinned/current version in repo | Purpose | Risk | Upgrade candidate | Effort | Pri |
| --- | --- | --- | --- | --- | --- | --- |
| NestJS `@nestjs/core` | `^10.4.4` | Enterprise API | Caret range; v10 is a major behind | `@nestjs/core` v11 (verify version) | M | P1 |
| TypeORM | `^0.3.20` | Backend ORM | Caret range | latest `0.3.x` (verify) | M | P2 |
| BullMQ / `@nestjs/bullmq` | `^5.12.0` / `^10.2.0` | Job queues | Caret ranges | latest 5.x (verify) | S | P2 |
| ioredis | `^5.11.1` | Redis client | Caret range | keep | S | P2 |
| pg | `^8.13.0` | Postgres driver | Caret range | keep | S | P2 |
| class-validator / class-transformer | `^0.14.1` / `^0.5.1` | DTO validation | Caret ranges | keep | S | P2 |
| TypeScript | `^5.9.3` (backend) / `^5` (frontend) | TS compiler | Caret ranges | keep | S | P2 |
| Node engine | `>=18` (engines) but image is `node:20-alpine` | Runtime | Engine/image drift; Node 20 nearing EOL | declare `>=22`, `node:22-alpine` | S | P1 |
| Next.js | `16.3.4` (exact) | Frontend App Router | Good exact pin | track latest 16.x | S | P2 |
| React / react-dom | `19.2.8` (exact) | UI runtime | Good exact pin | keep | S | P2 |
| Tailwind CSS | `^4` | Styling | Caret range | keep | S | P2 |
| shadcn | `^4.21.0` | UI components (vendored) | Caret range | keep | S | P2 |
| `@base-ui/react` | `^1.8.0` | Headless UI primitives | Caret range | keep | S | P2 |
| lucide-react | `^1.43.0` | Icons | Caret range | keep | S | P2 |
| ESLint | `^9` (frontend) / `^8.57.1` (backend) | Linting | Backend on old major + `eslint-config-prettier` | align backend to ESLint 9 flat config | M | P2 |

## 4. AI models (`config/models.yaml`) & inference

| Component | Pinned/current version in repo | Purpose | Risk | Upgrade candidate | Effort | Pri |
| --- | --- | --- | --- | --- | --- | --- |
| bge-m3 (embedding) | not declared in audited files — `verify` | Local embeddings, zero per-request cost | Low; weight provenance to verify | keep local; pin weights hash | S | P2 |
| reranker | Tavily (managed, per `SYSTEM_MAP.md`) — unpinned; `verify` | Rerank search/crawl results | Managed vendor + missing secret (no TAVILY secret exists) | self-host `bge-reranker` (verify version) | M | P2 |
| deepseek/deepseek-v4.1-flash | `models.yaml` (cheap + executor primary) | Default chat, classification, coding | Vendor concentration (DeepSeek across many roles) | eval GLM-5.3 / Kimi K3 via `model-eval.yml` | S | P1 |
| deepseek/deepseek-v4-pro | `models.yaml` (`strong` primary) | Final legal drafting | Vendor lock-in | keep; keep evals running | S | P2 |
| deepseek-v4-flash-0731 / v4-flash | `models.yaml` (cheap/executor fallback) | Cheaper fallback | Older; slower in eval | keep as fallback | S | P2 |
| qwen/qwen3.8-27b:free | `models.yaml` (`free`, `reviewer`) | Non-sensitive background only | `:free` may log/train — data-policy risk if misrouted | keep; never for customer data | S | P2 |
| google/gemini-3.1-flash-lite | `models.yaml` (`mechanical`, cheap fallback) | Trivial edits, formatting | Low | keep | S | P2 |
| google/gemini-3.8-flash | `models.yaml` (strong fallback + `vision`) | Persian OCR of case files | Vision path receives customer data (paid, allowed) | keep | S | P2 |
| z-ai/glm-5.3 / moonshotai/kimi-k3 | `models.yaml` (strong fallback / executor candidates) | Drafting / coding candidates | Provider terms; eval pending | eval before promoting | M | P2 |
| anthropic/claude-opus-5 | `models.yaml` (`architect`) | Builder strategy (subscription) | `billed_via_api: false` | keep | S | P2 |
| anthropic/claude-haiku-4.5 | `models.yaml` (`mechanical`) | Cheap mechanical edits | Low | keep | S | P2 |
| openai/whisper-large-v3 / -turbo | `models.yaml` (`stt`) | Voice STT | Not in OpenRouter catalogue; 429 history; network hop | self-host `faster-whisper large-v3-turbo` (already in image) | M | P1 |
| edge-tts:fa-IR-FaridNeural | `models.yaml` (`tts`) | Persian TTS (free) | Free external service, no SLA | keep; consider local TTS | M | P2 |
| gemini-3.8-live / gemini-3.1-flash-live-preview | `models.yaml` (`voice_realtime`, off by default) | Optional live speech-to-speech | Preview stability | keep behind the off flag | S | P2 |
| openai/gpt-oss-120b / -20b | `models.yaml` (`agent_runner`, Groq) | Cheap server-side agents | Free-tier `may_log`; limits unverified | keep | S | P2 |
| glm-5.3-free / kira-mini-1.0 | Kira defaults in `docker-compose.prod.yml` env | KIRA fallback engine | External, `verify` | verify ids/pricing | S | P2 |

## 5. Agent tooling & developer platform

| Component | Pinned/current version in repo | Purpose | Risk | Upgrade candidate | Effort | Pri |
| --- | --- | --- | --- | --- | --- | --- |
| OpenCode | `1.18` (server, per `SYSTEM_MAP.md`) | Vendor-neutral agent harness (CI + server) | Version not pinned in CI/workflows | pin version in CI | S | P1 |
| Goose | `1.50` (server, per `SYSTEM_MAP.md`) | Secondary agent runtime on server | Appears legacy/unused | remove or pin | S | P2 |
| Docker Engine + compose plugin | official apt repo, unpinned (`bootstrap_new_server.sh`) | Container runtime | Unpinned major/minor drift | pin + enable security auto-updates | M | P1 |
| Host OS | `Ubuntu 26.04 arm64` (`SYSTEM_MAP.md`) vs bootstrap targets Ubuntu 24.04 / Debian 12+ | Base host | Documentation contradiction | reconcile docs | S | P2 |

## Top 10 upgrades (ordered by value / effort)

1. **Pin the `:latest` images** — `edoburu/pgbouncer:latest` and `searxng/searxng:latest` → explicit version tags + digests. Closes the two P0 supply-chain holes. **S, P0**
2. **Pin the unpinned AI-core web deps** — `fastapi`, `uvicorn`, `langgraph`, `sentence-transformers`, `faster-whisper`, `sqlalchemy`, `redis` in `Dockerfile.prod`. Makes prod builds reproducible. **S, P0**
3. **Add digests to tag-only images** — `twentycrm/twenty:v2.41.0`, `valkey:8-alpine`, `crawl4ai:0.9.4`, `postgres:16.9-alpine`, `redis:7.4.11-alpine`. Cheap, high-value immutability. **S, P1**
4. **Pin `litellm` by digest and OpenCode version in CI** — remove the drifting `main-…-stable` and unpinned agent harness. **S, P1**
5. **Unify `psycopg`** across `pyproject.toml`, CI and the image, then pin. Three conflicting specs today. **S, P1**
6. **Pin base images and resolve the Python contradiction** — `python:3.11-slim` (image) vs `>=3.13` (pyproject); `node:20-alpine` → `node:22-alpine`, both + digest. **M, P1**
7. **Upgrade NestJS 10 → 11 and align backend ESLint to v9 flat config.** **M, P1**
8. **Self-host Whisper (`faster-whisper large-v3-turbo`)** for STT — removes the OpenRouter hop, 429 failures and per-call cost; the dependency is already installed. **M, P1**
9. **Consolidate Postgres majors** — move Twenty's `16.9` DB onto the main `17` image and pin digests. **M, P1**
10. **Schedule removal of legacy Django** (`==5.2.16`) — it is frozen and unused per STRATEGY §2. **M, P1**

## Do NOT change

- **`postgres:17-alpine` (digest-pinned)** — correct current major for the main DB.
- **`qdrant/qdrant:v1.19.0` (digest-pinned)** — right vector store, explicit version.
- **`nginx:alpine` (digest-pinned)** — correct gateway for the two-domain TLS setup.
- **`tecnativa/docker-socket-proxy:v0.5.0`** — the read-only proxy with `POST=0` is the right hardened pattern.
- **`torch==2.14.1` / `torchvision==0.29.1` exact CPU pins** — correct for the CPU-only host, with the CUDA-slip guard.
- **`lightrag-hku==1.5.7` + `openai==3.22.1`** — exact pins of the legal-RAG core.
- **Next.js `16.3.4` + React `19.2.8`** — exact pins, keep tracking 16.x.
- **Local `bge-m3` embeddings** — keeping embeddings local is the right cost/lock-in choice (STRATEGY §3b).
- **Self-hosted Postgres/Redis/Qdrant/Twenty** — correct versus Supabase/Vercel/SaaS lock-in.
- **`deepseek/deepseek-v4.1-flash` as executor/cheap primary** — eval-backed (7/7) owner decision; replace only via `model-eval.yml`.
- **`xray-core v25.8.3` with SHA-256 verification** — exemplary pinning; only refresh, never loosen.
- **OpenCode as the vendor-neutral harness** — the right choice for cross-vendor models.

---

*Sources read (read-only): `docs/SYSTEM_MAP.md`, `docs/STRATEGY.md`, `docker-compose.prod.yml`,
`docker-compose.modern-stack.yml`, `docker/research-stack/docker-compose.yml`, `Dockerfile.prod`,
`output_apps/enterprise_hub/Dockerfile`, `output_apps/enterprise_hub/frontend/Dockerfile`,
`ci/requirements-test.txt`, `pyproject.toml`, `output_apps/enterprise_hub/package.json`,
`output_apps/enterprise_hub/frontend/package.json`, `config/models.yaml`, `config/key_pool.yaml`,
`scripts/infra/**/*.sh` (headers). No other files were read or modified.*
