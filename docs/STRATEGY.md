# Roxira OS & Smart Judge — Master Strategy

Single source of truth for every Claude Code session. Read this first, then work only on the workstream you were given. Last updated: 2026-09-24.

## 1. What we are building

- **Roxira OS** (`roxira.net` / `roxira.ir`): multi-tenant enterprise SaaS. It covers INTA/Moadian tax compliance, accounting, ERP, CRM/HR/inventory and Zibal payments.
- **Smart Judge** (`ghazihoushmand.ir`): the flagship legal-AI product. It does legal RAG over Qdrant + LightRAG, drafts petitions and complaints, calculates damages, and runs a real-time voice consultation.

Smart Judge generates the revenue and the traction. Roxira OS is the platform it runs on. When priorities conflict, work that makes Smart Judge reliable, fast and cheap to run comes first.

## 2. Architecture (target)

| Layer | Tech | Location | Owns |
| --- | --- | --- | --- |
| Gateway | Nginx | `output_apps/nginx_config/nginx.conf` | TLS and routing. **The only public ports are 80/443.** |
| AI core | FastAPI | `run_unified_server.py`, `output_apps/generated_modules/` | LLM, RAG, voice, legal inference |
| Enterprise API | NestJS | `output_apps/enterprise_hub/` | Tenants, accounting, tax, CRM (Controller-Service-DTO-Repository, see `AGENTS.md`) |
| UI | Next.js | `output_apps/enterprise_hub/frontend/` | All user-facing screens |
| Data | Postgres (via PgBouncer), Redis, Qdrant | compose | Bound to `127.0.0.1` / `roxira_net` only |

Rules:
- Secrets live only in the server's `.env` (chmod 600). Code reads them from the environment. Never commit a real value, never add a default value for a secret.
- The repo is the source of truth for the server. Deploy with `git pull` plus `docker compose up -d`. Never hand-edit files on the server.
- Django in `pyproject.toml` is legacy. Do not build new features on it.

## 3. Model & cost strategy

### 3a. Claude Code (building the product)
| Task | Model |
| --- | --- |
| Strategy, architecture, security review (this hub chat) | Opus |
| Normal implementation chats (one per workstream) | **Sonnet 5**, the default |
| Mechanical edits, renames, formatting | Haiku |

Claude Code can run through OpenRouter (`ANTHROPIC_BASE_URL=https://openrouter.ai/api`), but only Anthropic models are supported there. Non-Claude models break on tool use, so do not use them to drive Claude Code on production code.

### 3b. Product runtime (what the app spends per user request)
All LLM calls go through **one router module** with tiers, configured from `.env`:

| Tier | Use for | Models (via OpenRouter) |
| --- | --- | --- |
| `free` | Non-sensitive background work: crawler summaries, SEO text, tagging, tech radar | `:free` models, with a fallback list |
| `cheap` | Default chat, classification, query rewriting | DeepSeek chat / Gemini Flash-class |
| `strong` | Final legal drafting and reasoning shown to the customer | Best-value frontier model, chosen per benchmark in `scripts/` |
| `stt` / `tts` | Voice | Whisper-turbo via OpenRouter or AssemblyAI; Edge-TTS (free) |

Hard rules:
- **Customer case data never goes to `:free` endpoints.** Free providers may log or train on prompts.
- Buy **$10 of OpenRouter credit once**. It raises the free-model cap from 50 to 1,000 requests/day.
- Use OpenRouter's `models: [...]` fallback list so a retired free model never causes an outage.
- Embeddings stay local (`bge-m3`), so they cost nothing per request.
- Cache identical prompts in Redis. Log token cost per tenant per day.

## 4. Claude Code token hygiene

- **One chat per workstream.** Start a new chat (+) instead of continuing a long one. Use `/compact` when a chat gets long and `/clear` between unrelated tasks.
- Use the **codebase-memory MCP** (`search_graph`, `trace_path`) for "where / who calls" questions instead of reading whole files.
- Never read `repomix-output.xml`, `database_snapshots/`, `*.sql` or `*.tar.gz`. They are huge and add nothing.
- Keep `CLAUDE.md` short. Put detail here and link to it.

## 5. Workstreams

Status: ⬜ todo · 🟨 in progress · ✅ done. Each chat updates its own row when it finishes.

| # | Workstream | Needs server | Depends on | Status |
| --- | --- | --- | --- | --- |
| W0 | Root README | no | — | ✅ PR #1 |
| W1 | Secrets to `.env` + ports to loopback | deploy step | — | 🟨 PR #2 (draft, needs server run) |
| W2 | Centralize DB/API config: ~55 files embed the DB password in DSNs | no | W1 merged | 🟨 PR #4 (merge after PR #2; root compose + smartjudge_module.py left to W1) |
| W3 | Repo hygiene: remove committed `venv/`, stop daemon audit commits to main, move one-off root scripts, remove dumps/snapshots from git, history-rewrite plan | no | W1 merged | ⬜ |
| W4 | CI: GitHub Actions for ruff, pytest, `compose config`, gitleaks secret scan, then deploy-on-merge | no | W3 | ⬜ |
| W5 | LLM router with tiers, fallbacks, Redis cache and cost log (section 3b) | no | W2 | ⬜ |
| W6 | Legal corpus gap: article-level chunking and ingestion of the missing codes (Qdrant shows 1,305 points vs 1,335 articles in the Civil Code alone) | yes | — | ⬜ |
| W7 | Voice latency: measure STT/LLM/TTS p50 first, then streaming TTS, target p50 < 2 s | yes | W5 | ⬜ |
| W8 | Server hardening: sandbox ports 4000/4001 to loopback, DOCKER-USER firewall chain, apply updates + reboot window, off-git backups | yes | W1 deployed | ⬜ |

## 6. Known facts (verified 2026-09-24)

- The server `5.75.200.67` (root) runs the repo at `/opt/roxira_platform`. Its working tree is clean and matches `origin/main`, so no hand edits are in place.
- A server daemon commits and pushes `chore(daemon): automated audit pass ... all green` to `main` about every 30 minutes, which is ~48 commits a day. CI must not run on those commits, and the audit output should be moved out of git (W3).
- `venv/` (~2,900 files, >1M lines) is committed to `main`. Removing it and adding it to `.gitignore` is the first W3 item.
- Before starting work, always run `git fetch && git checkout origin/main`. A local clone can be hundreds of commits behind.
- Qdrant did not answer the audit script. `/judge/health` returns 405 and `/judge/chat` returns 422 on an empty body.
- Keys are in git history. The owner chose not to rotate them for now.
