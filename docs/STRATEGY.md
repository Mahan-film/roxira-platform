# Roxira OS & Smart Judge — Master Strategy

Single source of truth for every Claude Code session. Read this first, then work only on the workstream you were given. Last updated: 2026-09-25 (hub: W6/W8/W9/W10 status, agents moved to GitHub Actions).

## Role rule (hard rule, 2026-09-28)

Claude Opus 5.5 is strategist and architect only: plans, specs, reviews, merge and deploy decisions. It never implements.

Implementation lanes, in order:
1. **GitHub agent issues** — OpenCode + DeepSeek V4.1 Flash via OpenRouter, reviewed by `agent-review`.
2. **Local OpenCode** on the owner's Mac via the `rx` helper and the LiteLLM key pool at `127.0.0.1:4000` (`codestral` = Mistral ×4, `qwen` = Groq ×3, `dsflash` = DeepSeek via OpenRouter, `glm`/`dspro` = SiliconFlow ×3 needs credit).
3. **Claude Sonnet** only as a last resort, one at a time, with owner approval.

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

**Brain expensive, hands cheap, memory open** (adopted from the owner's 2026-09 solo-developer strategy brief):
- Claude Code stays on the **Pro subscription**. Do not set `ANTHROPIC_BASE_URL` / a gateway key locally: that switches billing to per-token and bypasses the plan. Opus plans and reviews diffs; it does not type.
- Execution of well-scoped tasks goes to **OpenCode on GitHub Actions** (W10 phase 2) with the `executor` model from `config/models.yaml` (W12). The reviewer is a **different model family** from the executor.
- All model IDs live in `config/models.yaml` only. A newer model (DeepSeek V4.1 Flash, Qwen3.8, GLM-5.x, Kimi K3...) replaces the current one only after `scripts/check_models.py` shows it is live and the evals (W6 legal eval, one coding smoke task) do not regress. "Newer" is not a reason by itself: the 2026-09-25 audit found `deepseek-v4-flash-0731` about 10x cheaper than `v4.1-flash`.
- Not adopted: BMAD / SuperClaude / claude-flow / spec-kit (token overhead), agent teams on Pro, Graphify/Serena (codebase-memory MCP already covers it), LiteLLM (our router already has fallbacks + cost log), Chinese personal coding plans for CI (their terms usually forbid automated use).

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
- **Parallel chats:** at most 2 Sonnet chats at once (all chats, Opus and Sonnet, share one plan limit: three parallel agents hit it on 2026-09-24), each in its own worktree. More parallelism mostly creates merge conflicts on this file.

### Builder toolchain decisions (hub, 2026-09-26)

Source: the owner's end-of-September tooling brief. It is adapted to our stack: FastAPI + NestJS + Next.js + self-hosted Postgres/Redis/Qdrant. We do not use Supabase or Vercel.

| Tool / idea | Decision | Why |
| --- | --- | --- |
| Context7 MCP | ✅ in use (`.mcp.json`) | Current library docs, no code access |
| codebase-memory-mcp | ✅ in use | Code graph; published result: ~10x fewer tokens for ~9 points less answer quality |
| Claude Code subagents `implementer` (Sonnet), `tester` (Haiku), `reviewer` (Opus) | ✅ adopt (`.claude/agents/`) | 1 main agent + 3 locked subagents. Agent Teams stay **off** (~7x tokens in plan mode) |
| Impeccable (+ `DESIGN.md`) | ✅ adopt, vendored markdown only | Frontend quality for `enterprise_hub/frontend` |
| engram (local memory) | 🟨 owner installs locally (optional) | Local SQLite, no LLM. Store only verified decisions, never secrets. `docs/` + `progress.md` remain the source of truth |
| OpenCode as the vendor-neutral harness | ✅ in CI (agent-task); 🟨 optional locally | `opencode.json` agents: `plan`, `build`, `free` |
| Executor model | ✅ `deepseek-v4.1-flash` (eval 7/7). GLM-5.3 / Kimi K3 are candidates | Swap only via `model-eval.yml` + a PR |
| `openrouter/free` as the last free-tier fallback | ✅ adopt | The free list changes weekly; never pin a single `:free` id |
| RTK (Bash output compressor) | ❌ skip for now | Independent JetBrains test: +7.6% cost at low effort, ±0 at high; hook covers only Bash |
| Playwright E2E | 🟨 next workstream | Smoke flows: Smart Judge chat, payment invoice |
| Chrome DevTools MCP | ❌ not needed | The Claude Code browser pane already covers it |
| Supabase MCP / Vercel MCP | ❌ n/a | Not our stack. Never connect a DB MCP to production |
| OmniRoute, treg | ❌ reject | ToS risk (subscription OAuth) and third-party credential custody |
| agency-agents (full), OpenMontage, Hyperresearch, Hindsight, Graft | ❌ reject | Token overhead, overlap, or unrelated to our work |
| Jev (typed classifier) | 🟨 product backlog | For in-app intent routing with a confidence threshold ≥0.95; signups closed as of 2026-09-22 |

### Repository visibility & auto-merge (decided 2026-09-25)

- **The repo stays private.** Keys are still in git history and have not been rotated; making it public would leak them within minutes. It would also publish the legal corpus work and business logic.
- On GitHub Free, a private repo has no branch protection or rulesets (API: "Upgrade to GitHub Pro"). **Buy GitHub Pro ($4/month)** instead: rulesets on `main`, required checks, and 3,000 Actions minutes.
- Auto-merge is allowed only for `agent/*` PRs that pass CI + a cross-model `agent-review` (risk low) and touch no sensitive path (auth, payments, secrets, `.github/`, compose, nginx, migrations, `config/models.yaml`, `scripts/ops/`). Everything else waits for the owner. Owner checklist: `docs/ops/AUTO_MERGE.md`.

## 5. Workstreams

Status: ⬜ todo · 🟨 in progress · ✅ done. Each chat updates its own row when it finishes.

| # | Workstream | Needs server | Depends on | Status |
| --- | --- | --- | --- | --- |
| W0 | Root README | no | — | ✅ PR #1 |
| W1 | Secrets to `.env` + ports to loopback | deploy step | — | ✅ PR #2 (deployed 2026-09-24) |
| W2 | Centralize DB/API config: ~55 files embed the DB password in DSNs | no | W1 merged | ✅ PR #4 |
| W3 | Repo hygiene: remove committed `venv/`, stop daemon audit commits to main, move one-off root scripts, remove dumps/snapshots from git, history-rewrite plan | no | W1 merged | ✅ PR #13 (venv/scripts/dumps removed + rewrite plan) + PR #18/W10 (daemon-commit stop). Server's local `main` had diverged from `origin/main` since PR #5 (~30min daemon commits never pushed) — hard-reset to `origin/main` on 2026-09-24 during W8; the `roxira-autodaemon`/`roxira-worker` oneshot timers pick up the no-git-push code on their next scheduled run automatically. `roxira-dispatcher.service` (long-running) still needs a manual restart to bind loopback-only — that's W10 phase 2, owner sign-off pending. |
| W4 | CI: GitHub Actions for ruff, pytest, `compose config`, gitleaks secret scan, then deploy-on-merge | no | W3 | ✅ PR #6 |
| W5 | LLM router with tiers, fallbacks, Redis cache and cost log (section 3b) | no | W2 | ✅ PR #5 (flag off) |
| W6 | Legal corpus gap: article-level chunking and ingestion of the missing codes (Qdrant shows 1,305 points vs 1,335 articles in the Civil Code alone) | yes | — | 🟨 PR #23 merged: `scripts/w6_ingest_dotic.py` parses the DOTIC snapshot and takes owner-supplied files for the 3 missing laws. **Not yet run on the server.** The upsert into `iran_laws_v2` and the eval are owner-run or need an ssh permission rule; commands are in `docs/W6_legal_corpus_diagnosis.md`. The owner still has to supply Civil Procedure 1379, Cheque Law 1397 and Dispute Councils 1402 |
| W7 | Voice latency: measure STT/LLM/TTS p50 first, then streaming TTS, target p50 < 2 s | yes | W5 | 🟨 PR #33: per-stage timing logs (`VOICE_TIMING_LOG`, no transcript text), `scripts/voice_latency_bench.py` (offline + server mode), sentence-level streaming TTS behind `VOICE_STREAM_TTS` (default off), `VOICE_LLM_MODEL`. **Owner-run next:** deploy, run the bench on the server, read `voice.timing` logs, then try `VOICE_STREAM_TTS=1`. See `docs/W7_voice_latency.md` |
| W8 | Server hardening: sandbox ports 4000/4001 to loopback, DOCKER-USER firewall chain, apply updates + reboot window, off-git backups | yes | W1 deployed | ✅ PR #14 deployed (see history in PR #20). Off-site backup: PR #22, a daily 10:00 pull to the owner's Mac (`~/RoxiraBackups`, launchd `net.roxira.backup-pull`, 30 days). It also covers the Twenty CRM DB, which the hourly job misses. The owner declined paid Hetzner backups |
| W9 | Autonomous deep-research agent: pre-project stack recommender (multilingual sourcing, OpenRouter-only, agentic/modular) — see docs/research/bakeoff.md | no | — | 🟨 PR #24: `--report-lang fa` (Persian report, multilingual queries), `--max-usd` budget guard via OpenRouter `/api/v1/key`, DEGRADED status for fallback-only runs, offline zero-cost test mode, fixed key names (`BRAVE_API_KEY`/`TAVILY_KEYS`), and a new radar entrypoint that writes outside the repo (proposed units in `docs/ops/`). **Live run on the 3 briefs still pending** (owner-run, `docs/research/LIVE_RUN.md`, ≤ $1.50). The old radar timer dirties the server checkout (`TECH_RADAR_PROPOSALS.md`, `tech_radar_report.json`): revert those files and swap the timer before the live run. `/tmp/w9run` on the server is a leftover from an interrupted run |
| W10 | Safe, cheap agent workforce: inventory of factory dispatcher/daemon/OpenCode/Goose, stop agents pushing to `main` (worktree + PR + CI per task), GitHub-issue task intake with a $/day budget and concurrency limit — see docs/AGENTS_WORKFORCE.md | yes (design shown, implementation pending owner go-ahead) | W4 (CI), W5 (cost log) | 🟨 Phase 1 live (no daemon pushes). Phase 2, PR #25: agent tasks run **only on GitHub Actions ephemeral runners** (`.github/workflows/agent-task.yml`), never on the prod host. Guards: actor allowlist, `AGENT_ENABLED` repo variable, concurrency cap, built-in `GITHUB_TOKEN` (no PAT) with `persist-credentials: false`, a minimal env for OpenCode, and pushes only to `agent/*` branches. The $ cap is a dedicated OpenRouter key with a daily `limit_reset`. Owner steps: that key as secret `OPENROUTER_AGENT_KEY`, the repo variables, the labels, and branch protection on `main`. The server dispatcher is token-gated and dry-run only; restarting it is owner-run |
| W11 | Project Factory (section 8): owner brief → W9 research → Persian proposal as a GitHub issue → owner approves → planner splits into tasks → W10 agents build in worktrees → PR → CI → Claude review → merge. Works for any new project and stack, in its own repo | yes | W9 live run, W10 phase 2 | 🟨 PR #28: pipeline workflows merged (`factory-*.yml`). Waits for the W9 live run and the W10 owner setup before a first real project |
| W12 | Self-updating model & tool registry: one `config/models.yaml` read by the product router, the research agent and the coding agents. A weekly job reads the OpenRouter `/models` catalogue and prices plus the W9 radar, then opens a PR proposing swaps. A swap merges only if the evals do not regress (W6 legal eval, one coding smoke task) | no | W5, W9 | ✅ PR #30 (`config/models.yaml` + loader; router and provider_base read it), PR #32 (weekly `model-registry-check.yml` opens an issue on drift; OpenCode `--agent build` wired), PR #34 (`scripts/eval_coding_smoke.py` + manual `model-eval.yml` gate). Model swaps: run `model-eval.yml` + the W6 legal eval, then a normal PR |
| W13 | Builder token & cost control: one cost ledger for product calls, research runs and agent tasks; a daily $ cap per agent task and per day; cheap-model-first routing with escalation; prompt caching; a weekly cost report in Persian | no | W5, W10 | 🟨 PR #31: cross-model `agent-review.yml`, `agent-automerge.yml` (off until `AUTO_MERGE_ENABLED=true`; needs GitHub Pro + ruleset), JSONL cost ledger + `scripts/cost_report.py` (Persian output). Left: wire the product router cost log into the same weekly report, prompt caching |

### Priority order (hub, 2026-09-26)

Live status, the owner queue and the next workstreams are in **`docs/STATE.md`** (kept current via `/handoff`). The parallel-chat operating model is in **`docs/PARALLEL_CHATS.md`**: 1 Opus hub, up to 2 Sonnet workstream chats, and unlimited cheap `agent` issues on the OpenRouter key.

Order: (1) owner-approved server steps: W6 eval, W7 bench, cleanup; (2) W14 Playwright E2E and W15 STT robustness in parallel Sonnet chats; (3) W5 router `cheap` tier on, after the W6 eval passes; (4) W16 nginx `/health`; (5) W11 first real Project Factory run.

## 6. Known facts (verified 2026-09-24)

- The server `5.75.200.67` (root) runs the repo at `/opt/roxira_platform`. Its working tree is clean and matches `origin/main`, so no hand edits are in place.
- The daemon/worker git pushes to `main` stopped with PR #18 (verified 2026-09-24: the autodaemon ran at 19:26 UTC and did not commit). `venv/` and the dumps were removed in PR #13.
- API keys in the server `.env` (names only): `OPENROUTER_API_KEY`, `BRAVE_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `JINA_API_KEY`, `KAVENEGAR_API_KEY`, `SMS_IR_API_KEY`. There is no Anthropic key on the server. Research and agent runs that need keys run on the server, not in a local sandbox.
- Agent runtimes installed on the server: OpenCode 1.18 (`/usr/bin/opencode`, DeepSeek via OpenRouter, `"permission": "allow"`) and Goose 1.50. `gh` is not installed.
- Before starting work, always run `git fetch && git checkout origin/main`. A local clone can be hundreds of commits behind.
- Qdrant did not answer the audit script. `/judge/health` returns 405 and `/judge/chat` returns 422 on an empty body.
- W6 (2026-09-24): Qdrant `iran_laws_bge_m3` (1,308 points) is reachable and healthy; the audit script's earlier no-answer was a network-reachability issue outside the container, not a Qdrant outage. The real defect: 1,305 of 1,308 points are synthetic range-summary placeholders (49 distinct texts reused across whole article ranges, e.g. "ماده ۱۱ تا ۱۸۲"), not real per-article text; only 3 points have the correct schema. See `docs/W6_legal_corpus_diagnosis.md`.
- Port 8005 (`roxira-dispatcher`, no auth) listens on `0.0.0.0`, but `ufw` (default DROP, only 22/tcp allowed) blocks it from outside — verified with an external probe 2026-09-24. Still bind it to loopback (W10 phase 1): one ufw change would expose it.
- 2026-09-25: the repo moved to the **Mahan-film** organization (GitHub Team, rulesets available). The server pulls with a repo deploy key, so the org setting *Allow deploy keys* must stay on.
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

## 8. Target: Roxira Project Factory (owner's vision)

For any new project of the owner's, whatever the app or framework, Roxira researches the stack, proposes it in Persian, waits for approval, then agent teams build it. It keeps its own models and tools current. Research runs in English, German, Japanese, Chinese (and ko/ru). The owner sees results **in Persian only**.

| Stage | What happens | Built by | State (2026-09-24) |
| --- | --- | --- | --- |
| 1. Brief | Owner writes a short brief (Persian is fine) as a GitHub issue labelled `brief` | W11 | ⬜ |
| 2. Research | `tech_radar.py --project-brief`: per-layer (backend, frontend, data, infra, AI) multilingual search → crawl → rerank → scored options | W9 | 🟨 built, never run live |
| 3. Proposal | A Persian report with 2–3 stack options, cost, risks and a task breakdown, posted on the issue | W9 + W11 | ⬜ |
| 4. Approval | Owner adds the `approved` label or picks an option. Nothing is built before this | W11 | ⬜ |
| 5. Build | Planner (Claude Sonnet) splits the work into small issues labelled `agent`. Workers (OpenCode + cheap OpenRouter models) do each in its own worktree and open a PR. CI runs. Claude reviews. The owner or a rule merges | W10 phase 2 + W11 | ⬜ (phase 1 done) |
| 6. Self-update | Weekly: the model/tool registry proposes swaps as a PR, gated by evals | W12 | ⬜ |
| 7. Cost control | Every call is logged against a daily cap. Weekly Persian cost report | W13 | ⬜ (product router has a cost log, flag off) |

Rules that keep this safe and cheap:
- Agents never push to `main` and never touch production directly. Every change is a PR with CI. Deploys follow section 7.
- Cheapest model that passes first, escalate only on failure: `free`/`cheap` OpenRouter models for research gathering and mechanical code; Sonnet for planning and review; Opus only in the hub chat. Customer data never goes to `:free` endpoints (section 3b).
- Adopt frameworks only through the hype filter (section 4). W9's bake-off chose to extend our own `tech_radar.py` rather than adopt DeerFlow/MiroFlow/GPT Researcher.
- Every autonomous job has a $/day cap, a concurrency cap and a kill switch in `.env`.
