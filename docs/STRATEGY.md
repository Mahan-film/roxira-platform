# Roxira OS & Smart Judge — Master Strategy

Single source of truth for every Claude Code session. Read this first, then work only on the workstream you were given. Last updated: 2026-09-24 (hub: priorities, tooling).

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

## 4. Claude Code token hygiene & tooling

- **One chat per workstream.** Start a new chat (+) instead of continuing a long one. Use `/compact` when a chat gets long and `/clear` between unrelated tasks.
- Use the **codebase-memory MCP** (`search_graph`, `trace_path`) for "where / who calls" questions instead of reading whole files.
- Never read `repomix-output.xml`, `database_snapshots/`, `*.sql` or `*.tar.gz`. They are huge and add nothing.
- Keep `CLAUDE.md` short. Put detail here and link to it.
- **Project skills** (`.claude/skills/`, invoke with `/name`): `/start-workstream` (sync, read strategy, claim a row) and `/deploy-prod` (section 7 runbook, asks before every restart). Use them instead of re-explaining the procedure in each chat.
- **MCP servers — keep the set small.** Every server adds tool schemas to every chat. Approved: `codebase-memory` (code structure), `context7` (current library docs for NestJS/Next.js/FastAPI/Qdrant, instead of pasting docs or guessing APIs). Not approved for now: a production Postgres/Qdrant MCP (use `ssh` read-only instead), extra GitHub MCP (`gh` already covers it).
- **Hype filter.** A new tool/skill/repo seen on social media is adopted only if it (a) removes a step we repeat every week, or (b) measurably cuts tokens or $ per task, and (c) does not push to `main` or run unattended with shell access. "Agent swarm" frameworks usually fail (b). Proposals go to the hub chat, not straight into a workstream.
- **Parallel chats:** at most 3 Sonnet chats at once, each in its own worktree. More parallelism mostly creates merge conflicts on this file.

## 5. Workstreams

Status: ⬜ todo · 🟨 in progress · ✅ done. Each chat updates its own row when it finishes.

| # | Workstream | Needs server | Depends on | Status |
| --- | --- | --- | --- | --- |
| W0 | Root README | no | — | ✅ PR #1 |
| W1 | Secrets to `.env` + ports to loopback | deploy step | — | ✅ PR #2 (deployed 2026-09-24) |
| W2 | Centralize DB/API config: ~55 files embed the DB password in DSNs | no | W1 merged | ✅ PR #4 |
| W3 | Repo hygiene: remove committed `venv/`, stop daemon audit commits to main, move one-off root scripts, remove dumps/snapshots from git, history-rewrite plan | no | W1 merged | 🟨 PR #13 (venv/scripts/dumps removed + rewrite plan; daemon-commit stop is separate/W8-adjacent, not yet done) |
| W4 | CI: GitHub Actions for ruff, pytest, `compose config`, gitleaks secret scan, then deploy-on-merge | no | W3 | ✅ PR #6 |
| W5 | LLM router with tiers, fallbacks, Redis cache and cost log (section 3b) | no | W2 | ✅ PR #5 (flag off) |
| W6 | Legal corpus gap: article-level chunking and ingestion of the missing codes (Qdrant shows 1,305 points vs 1,335 articles in the Civil Code alone) | yes | — | 🟨 diagnosed + proof-of-concept; baseline re-confirmed 2026-09-24 (citation_accuracy still 16.7%, no drift); official-text scrape from qavanin.ir/rc.majlis.ir blocked (network unreachable from all available infra) — owner will supply article text directly, see `docs/W6_legal_corpus_diagnosis.md` §4b |
| W7 | Voice latency: measure STT/LLM/TTS p50 first, then streaming TTS, target p50 < 2 s | yes | W5 | ⬜ |
| W8 | Server hardening: sandbox ports 4000/4001 to loopback, DOCKER-USER firewall chain, apply updates + reboot window, off-git backups | yes | W1 deployed | ⬜ |
| W9 | Autonomous deep-research agent: pre-project stack recommender (multilingual sourcing, OpenRouter-only, agentic/modular) — see docs/research/bakeoff.md | no | — | 🟨 Phase B built (tech_radar now routes through llm_router, multilingual zh/ja/de/ko/ru sourcing, `project-brief` mode, stdio MCP server — see docs/research/mcp-server.md) — **live run on the 3 bake-off briefs still pending**, this sandbox has no OpenRouter/search-provider keys or network egress to run them |
| W10 | Safe, cheap agent workforce: inventory of factory dispatcher/daemon/OpenCode/Goose, stop agents pushing to `main` (worktree + PR + CI per task), GitHub-issue task intake with a $/day budget and concurrency limit — see docs/AGENTS_WORKFORCE.md | yes (design shown, implementation pending owner go-ahead) | W4 (CI), W5 (cost log) | 🟨 design written, PR pending — awaiting owner sign-off before touching systemd/cron/firewall |

### Priority order (set by the hub, 2026-09-24)

1. **W6 — real legal text into Qdrant.** Retrieval cites the right article only 16.7% of the time because 1,305 of 1,308 points are placeholders. This is the biggest product-quality problem. Next step: full ingestion into `iran_laws_v2`, re-run `scripts/eval_legal_rag.py`, switch only if citation accuracy clearly beats baseline.
2. **W10 phase 1 only — stop daemon/worker pushes to `main`.** Remove the `git add/commit/push` from `autonomous_master_daemon.py` and `task_worker.py`, bind the dispatcher (8005) to `127.0.0.1`. This closes the last W3 item and removes the risk that took ~50 routes down on 2026-09-23. Worktree+PR agent flow (phase 2) waits.
3. **W5 flag on (cheap tier) after W6 eval passes** — the router is built but off, so product LLM spend is still unmanaged.
4. **W7 voice latency.**
5. **W9 Phase B** — finish PR #15, then park. It is not on the Smart Judge revenue path.

## 6. Known facts (verified 2026-09-24)

- The server `5.75.200.67` (root) runs the repo at `/opt/roxira_platform`. Its working tree is clean and matches `origin/main`, so no hand edits are in place.
- A server daemon commits and pushes `chore(daemon): automated audit pass ... all green` to `main` about every 30 minutes, which is ~48 commits a day. CI must not run on those commits, and the audit output should be moved out of git (W3).
- `venv/` (~2,900 files, >1M lines) is committed to `main`. Removing it and adding it to `.gitignore` is the first W3 item.
- Before starting work, always run `git fetch && git checkout origin/main`. A local clone can be hundreds of commits behind.
- Qdrant did not answer the audit script. `/judge/health` returns 405 and `/judge/chat` returns 422 on an empty body.
- W6 (2026-09-24): Qdrant `iran_laws_bge_m3` (1,308 points) is reachable and healthy; the audit script's earlier no-answer was a network-reachability issue outside the container, not a Qdrant outage. The real defect: 1,305 of 1,308 points are synthetic range-summary placeholders (49 distinct texts reused across whole article ranges, e.g. "ماده ۱۱ تا ۱۸۲"), not real per-article text; only 3 points have the correct schema. See `docs/W6_legal_corpus_diagnosis.md`.
- Port 8005 (`roxira-dispatcher`, no auth) listens on `0.0.0.0`, but `ufw` (default DROP, only 22/tcp allowed) blocks it from outside — verified with an external probe 2026-09-24. Still bind it to loopback (W10 phase 1): one ufw change would expose it.
- Keys are in git history. The owner chose not to rotate them for now.

## 7. Deploy runbook (production)

1. `ssh 5.75.200.67` → `cd /opt/roxira_platform && git pull --ff-only origin main`
2. `docker compose -f docker-compose.prod.yml config -q` must pass (secrets are required from `.env`).
3. Dry-import before restarting: `docker exec --env-file .env -w /app roxira_app_prod python3 -c "import run_unified_server"`. Compare the `LOAD-FAIL` list with the previous run.
4. Recreate only the services whose config changed: `docker compose -f docker-compose.prod.yml up -d --no-deps <services>`.
   `roxira_enterprise_frontend` was started with `docker run`, not compose, so do **not** include it until it is migrated (W8).
5. **Always** run `docker exec roxira_nginx_prod nginx -s reload` afterwards. nginx caches upstream container IPs, and a recreated container gets a new IP, which causes a 502 until reload.
6. Verify: `/health`, `POST /api/v1/apps/judge/payments/create-invoice` (not 404), a real chat through `https://ghazihoushmand.ir`, and external ports closed.

Host notes:
- `.env` backups go to `/root/env-backups/`, never inside the repo. The daemon runs `git add -A`.
- Host cron jobs must run through `scripts/ops/with_env.py` so they see `.env`.
- Firewall: `roxira-docker-firewall.service` (DOCKER-USER chain) blocks 6432/3000/4000/4001 on eth0.
