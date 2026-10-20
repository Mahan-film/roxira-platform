# System map (what exists)

Canonical inventory for a fresh chat. Written 2026-09-30 by the hub; payments/auth/CRM/mail rows refreshed 2026-10-20 (other rows still reflect 2026-09-30). Current status lives in `docs/STATE.md`;
the derivable facts (compose, nginx, workflows, versions, model ids) are in `docs/SYSTEM_INVENTORY.generated.md`
(regenerate: `python3 scripts/gen_system_inventory.py`). Anything not checked is marked UNVERIFIED. Key NAMES only, never values.

## 1. Products and domains
| Product | Domain | What it is | Served by |
| --- | --- | --- | --- |
| Smart Judge | ghazihoushmand.ir (+www) | Legal-AI: RAG over Qdrant + LightRAG, petitions, damages, voice, Zibal payments, SMS OTP login | nginx -> frontend (3001) + AI core (8000) |
| Roxira OS | roxira.net, roxira.ir (+www) | Multi-tenant enterprise SaaS (tax/Moadian, accounting, ERP, CRM); Smart Judge runs on it | nginx -> frontend/backend |
| Other names | roxirad.ir, roxirad.net | Appear only in `nginx_split.conf`, NOT in the live config (see below) | UNVERIFIED whether DNS points here |

- Live nginx config is the compose mount `output_apps/nginx_config/nginx.conf` (server_names: ghazihoushmand.ir, roxira.ir, roxira.net, localhost + www). `nginx.conf`, `nginx_split.conf`, `production_bundle/nginx/nginx.conf` at repo root/bundle are older variants.
- Priority (STRATEGY §1): Smart Judge earns revenue; Roxira OS is the platform. Reliability of Smart Judge comes first.
- Owner-facing FAQ in Persian: `docs/OWNER_GUIDE_FA.md`.

## 2. Production server
| Item | Value |
| --- | --- |
| Host | `roxira-prod` = `91.107.248.99` (srv1.roxira.net, Ubuntu 26.04 arm64; old host 5.75.200.67 until decommission) |
| Repo | `/opt/roxira_platform`; deployed commit 64478f3 on 2026-09-30 |
| Drift | main is ahead: #135, #149, #150, #151 and later are merged but NOT deployed |
| Exposed ports | 22, 80, 443 only (ufw; `roxira-docker-firewall.service` blocks 6432/3000/4000/4001 on eth0). Compose publishes app ports on 127.0.0.1 only |
| Secrets | `/opt/roxira_platform/.env`; backups of it in `/root/env-backups/` (never in repo) |

Running containers (13):
| Container | Image / origin | Role |
| --- | --- | --- |
| roxira_nginx_prod | nginx:alpine (compose `nginx_gateway`) | TLS gateway, routes both domains; run `nginx -s reload` after any recreate |
| roxira_app_prod | enterprise_app image (compose) | Python AI core (FastAPI, port 8000) |
| roxira_enterprise_frontend | started with `docker run`, NOT compose (W8 to migrate) | Next.js site (3001) |
| roxira_enterprise_backend | compose | NestJS enterprise API (3000) |
| roxira_pgbouncer | edoburu/pgbouncer (compose) | Postgres pooling, port 6432 |
| roxira_postgres_prod | postgres:17-alpine (compose) | Main DB `enterprise_db` |
| roxira_redis_prod | redis:7-alpine (compose) | Cache/queues |
| roxira_qdrant_prod | qdrant/qdrant (compose) | Vector store |
| roxira_twenty_crm, roxira_twenty_db (postgres:16-alpine), roxira_twenty_redis | not in `docker-compose.prod.yml` | Twenty CRM stack, 0 workspaces as of 2026-10-20; nightly sync from our DB built in `scripts/ops/crm/` (`docs/ops/CRM_SYNC.md`). Compose file for it: UNVERIFIED |
| roxira_mail | not in `docker-compose.prod.yml` (2026-10-20) | Postfix + DKIM (selector rx1) for account-verification mail from `mail.ghazihoushmand.ir` |
| roxira_sandbox_saas-portal-v2, roxira_sandbox_smart-accounting | not in compose; sources in `data/sandboxes/` | Auto-generated sandbox apps (Software Foundry) |

Timers and cron (on the host):
| What | When | Notes |
| --- | --- | --- |
| roxira-autodaemon.timer | every 30 min | Health audit only; a server daemon pushes to `main` about every 30 min (fetch before work) |
| roxira-radar.timer | every 6 h | Tech radar scan (`docs/ops/roxira-radar.*`) |
| roxira-worker.timer | disabled | Removed for security |
| cron 03:30 | daily | Legal crawler `scripts/run_periodic_crawler.py` via `scripts/ops/with_env.py` |
| cron hourly | hourly | `scripts/auto_backup_daemon.sh` (backup); a daily pull copies backups to the Mac (`scripts/ops/pull_backups_to_mac.sh`) |
| cron 04:30 | daily | `scripts/daily_tech_scout.sh` |
| roxira-usdt-poll.timer | every minute | USDT-TRC20 payment poller, runs in the app container |
| roxira-crm-sync.timer | daily 03:30 UTC | Twenty CRM sync; built, owner must create the API key first |

Deploy: STRATEGY §7 (git pull --ff-only, `compose config -q`, dry import, `up -d --no-deps <svc>`, nginx reload, verify). Merged but NOT installed on prod: `scripts/ops/deploy.sh` (auto-rollback), `rollback.sh`, `backup.sh`, `deploy/systemd/roxira-backup.*`, compose healthchecks (#81). Restore drill: `docs/ops/RESTORE_DRILL.md`.

NOT automated: deploys (owner yes, then hub-run), DB migrations, kernel reboot, `.env` changes, systemd installs, frontend container (docker run), Twenty/sandbox stacks, backup restore tests (monthly by hand), key rotation, uptime alerts beyond the `uptime.yml` GitHub issue.

## 3. Architecture
| Layer | Tech | Where | Versions (repo) |
| --- | --- | --- | --- |
| AI core | Python FastAPI, LightRAG, langgraph, sentence-transformers (bge-m3 embeddings), faster-whisper, edge-tts, docling | `output_apps/generated_modules/smartjudge/`, `src/`, `run_unified_server.py`; image `Dockerfile.prod` | Image `python:3.11-slim`; `pyproject.toml` says `>=3.13` (see contradictions); pydantic >=2.13.4, httpx >=0.28.1; fastapi and qdrant-client unpinned |
| Enterprise backend | NestJS (Controller-Service-DTO-Repository), TypeORM, BullMQ | `output_apps/enterprise_hub/` (`@roxira/enterprise-hub` 1.0.0) | @nestjs/core ^10.4.4, typeorm ^0.3.20, bullmq ^5.12.0, typescript ^5.9.3 |
| Frontend | Next.js App Router, Tailwind, shadcn/ui, standalone build | `output_apps/enterprise_hub/frontend/` (`@roxira/enterprise-hub-frontend` 0.1.0) | next 16.3.4, react 19.2.8, tailwindcss ^4, typescript ^5 |
| Gateway | nginx | `output_apps/nginx_config/nginx.conf` | nginx:alpine |
| CI | GitHub Actions | `.github/workflows/` | Python 3.13, Node 20 |

Data stores:
| Store | Detail |
| --- | --- |
| Postgres 17 | `enterprise_db` via PgBouncer (transaction pool); every new table needs a tenant/owner column |
| SQLite | `roxira_auth.db` (`ROXIRA_AUTH_DB_URL`, in the AI-core container) |
| Redis 7 | cache, BullMQ |
| Qdrant | `iran_laws_v2`: 4,243 points, 8 laws, used for answers (env `LIGHTRAG_QDRANT_COLLECTION`). `iran_laws_bge_m3`: 1,308 points, 1,305 placeholders (old). Code reading for #117/#151: the citation guard's real lookup follows `LIGHTRAG_QDRANT_COLLECTION`; `iran_laws_bge_m3` was only the label in its report (now env `ROXIRA_CITATION_QDRANT_COLLECTION`). Not yet confirmed on prod. Other collections: UNVERIFIED |

Other components:
| Area | Detail |
| --- | --- |
| Voice | STT `openai/whisper-large-v3-turbo` (OpenRouter; AssemblyAI keys in template), TTS edge-tts `fa-IR-FaridNeural`; optional Gemini Live realtime (`voice_realtime` role, off by default, W20/#84). Docs `docs/W20_realtime_voice.md` |
| Payments | Zibal live (`ZIBAL_MERCHANT` env-only, `ZIBAL_CALLBACK_URL`, `PAYMENTS_LIVE`; result page with receipts, activation retry, verify rate limits); verify via `payment_orders`. USDT-TRC20 self-custody checkout live (`CRYPTO_PAY_ENABLED=1`, poller `roxira-usdt-poll.timer` inside the app container, `docs/ops/CRYPTO_PAYMENTS.md`). Pricing (2026-10-20): Free / Basic $4 / Pro $10 / Premium $29, annual = 10x, toman = USD x max(Tetherland rate, 280,000 floor) + optional margin; older `PRICE_TOMAN_*` values are historical. Token packs are "coming soon" |
| SMS / OTP | Kavenegar (templates `ghazi-verify`, `roxira-verify`); sms.ir key also wired |
| Auth | JWT, Google OAuth (optional), WebAuthn passkeys in the NestJS backend; Smart Judge: phone OTP (auto-submit, WebOTP) and email+password accounts with verification via the self-hosted mail relay `roxira_mail` (Postfix + DKIM rx1) |
| Model routing | Tiered per plan (free-only for free users; vip-product / vip-pro / vip-premium paid ladders, all ending in the free ladder): `docs/strategy/MODEL_ROUTING_DECISION_2026-10-17.md`; bake-off `scripts/eval/model_bakeoff.py` on srv1 |
| Search/crawl | Brave, Exa, Firecrawl, Jina, Tavily used by radar/crawlers (keys below) |

## 4. Models and keys
Roles (`config/models.yaml`, first model of each role; see the generated inventory for full fallback lists):
| Role | First model | Used for |
| --- | --- | --- |
| free | qwen/qwen3.8-27b:free | non-sensitive background only, never customer data |
| cheap | deepseek/deepseek-v4.1-flash | default chat, classification (sends `reasoning: {enabled:false}` since #135, not deployed) |
| strong | deepseek/deepseek-v4-pro | final legal drafting |
| stt / tts | openai/whisper-large-v3-turbo / edge-tts:fa-IR-FaridNeural | voice |
| architect | anthropic/claude-opus-5 | builder: decisions only |
| executor | deepseek/deepseek-v4.1-flash | builder: implementation (OpenCode) |
| reviewer | anthropic/claude-sonnet-5 | builder: review |
| mechanical | google/gemini-3.1-flash-lite | builder: trivial edits |
| voice_realtime | gemini-3.8-live | optional live voice |

Keys and secrets by NAME (values are never in this repo or in chat):
| Name | Lives in | Purpose | Cap |
| --- | --- | --- | --- |
| OPENROUTER_API_KEY | prod `.env` (OpenRouter key label `roxira-prod-chat`) | product LLM calls | $3/day |
| OPENROUTER_AGENT_KEY | GitHub Actions secret (only secret that exists); same OpenRouter key `roxira-agent` also in the Mac LiteLLM pool | GitHub agents, rx on the Mac | $4/day now; owner should set back to $2 |
| OPENROUTER_RESEARCH_KEY | referenced by workflows, no such secret exists | radar/research workflows | n/a (gap) |
| GEMINI_API_KEY, KIRA_API_KEY | prod `.env` | Gemini voice/LLM, Kira fallback engine | UNVERIFIED |
| ZIBAL_MERCHANT, ZIBAL_CALLBACK_URL, PAYMENTS_LIVE | prod `.env` | payments | n/a |
| CRYPTO_PAY_ENABLED, CRYPTO_USDT_TRC20_ADDRESS, TRONGRID_API_KEY | prod `.env` | USDT checkout | n/a |
| CHAT_PREMIUM_TOP_DAILY_LIMIT, SMARTJUDGE_ADMIN_PHONES | prod `.env` (config) | Opus answers/day for Premium; owner console admins | n/a |
| TWENTY_API_KEY, TWENTY_API_URL | `/etc/roxira-crm.env` (not yet created) | CRM sync | n/a |
| KAVENEGAR_API_KEY, SMS_IR_API_KEY | prod `.env` | OTP SMS | UNVERIFIED |
| JWT_SECRET, JWT_SECRET_KEY | prod `.env` | token signing | n/a |
| POSTGRES_PASSWORD | prod `.env` | Postgres, PgBouncer | n/a |
| BRAVE_API_KEY, EXA_API_KEY, FIRECRAWL_API_KEY, JINA_API_KEY, TAVILY_KEYS | prod `.env`; workflows reference them as GitHub secrets that do NOT exist | search/crawl/rerank | UNVERIFIED |
| TWENTY_APP_SECRET, TWENTY_ENCRYPTION_KEY | prod `.env` | Twenty CRM | n/a |
| DEFAULT_LLM_MODEL, LIGHTRAG_QDRANT_COLLECTION, USD_TO_TOMAN_RATE | prod `.env` (config, not secrets) | model default, Qdrant collection, FX rate | n/a |
| SiliconFlow, Groq, Mistral keys | Mac LiteLLM pool (`~/.config/litellm`) | dspro/glm, gptoss/qwen, codestral/mmedium | key names and caps UNVERIFIED |

Known gap: only ONE Actions secret exists, so workflows that read BRAVE_API_KEY, EXA_API_KEY, FIRECRAWL_API_KEY, JINA_API_KEY, TAVILY_KEYS (and OPENROUTER_RESEARCH_KEY) get empty values. Keys remain in git history (owner chose not to rotate); old keys were revoked.

## 5. Builder toolchain
Lanes (ADR 0003, `docs/decisions/0003-agent-operating-model.md`, status proposed):
| Step | Who | For |
| --- | --- | --- |
| 1 | `rx`/`rxall` (OpenCode on the LiteLLM pool) or GitHub `agent` label | one issue, <= ~80 changed lines, <= 3 files, spec inline. GitHub lane is unreliable (#99, #77) |
| 2 | Claude subagent `implementer` (Sonnet); the hub runs git | fix a failed step 1; legal core, auth, payments |
| 3 | separate Sonnet workstream chat | design/investigation |
| 4 | Opus | ADRs only |
Caps: 3 rx workers, 2 Claude subagents, 1 extra chat. Hub = Sonnet; `/handoff` at ~60% context. Hub never implements product code.

Mac toolchain:
| Tool | Detail |
| --- | --- |
| rx / rxall | `scripts/dev/` (README there): `rx <issue> [model] [base]`, max 3 parallel, fallback dsflash -> dspro -> codestral, ruff F821/F811/E9 gate, logs `~/rx-logs/` |
| LiteLLM pool | Docker, `127.0.0.1:4000`, config `~/.config/litellm`. Names: dsflash (OpenRouter deepseek-v4.1-flash), dspro and glm (SiliconFlow), gptoss and qwen (Groq), codestral and mmedium (Mistral) |
| OpenCode | `~/.opencode/bin`, config `~/.config/opencode/opencode.json`; repo `opencode.json` has agents plan/free/build; no shell tool |
| Other CLIs | gemini CLI, agy, rtk (wraps git/pytest; use `rtk proxy <cmd>` or `python3 -m pytest <file>`), qmd, engram, uv, node, docker |
| MCP in Claude Code | engram (memory), qmd (docs search), codebase-memory (code graph), context7 (library docs; `.mcp.json`) |
| Claude subagents | `.claude/agents/`: implementer (sonnet), tester (haiku), reviewer (opus) |
| Network | Mac is flaky to GitHub/OpenRouter (retry); OpenRouter may 403 the Mac IP (VPN); Iranian official sites reachable only intermittently |

GitHub: org `Mahan-film`, repo `roxira-platform`, private, Team plan; squash merge, delete branch on merge, `allow_auto_merge=true`. Ruleset `main-protection` requires a PR plus checks Detect changes, Secret scan, Pytest (unit), Frontend gate. Hub merges reviewed PRs with `gh pr merge <n> --auto --squash`. Server pulls via a deploy key (org "Allow deploy keys" must stay on). Advanced Security (paid) deliberately off.

Workflows (`.github/workflows/`, triggers in the generated inventory):
| File | Purpose |
| --- | --- |
| ci.yml | Main CI (change detection, secret scan, unit pytest, frontend gate) |
| agent-task.yml | OpenCode agent does one labelled issue on an ephemeral runner, opens a PR |
| agent-review.yml | AI reviewer verdict on `agent/*` PRs |
| agent-automerge.yml | Auto-merge `agent/*` PRs when gates hold; only if var AUTO_MERGE_ENABLED is "true" (`docs/ops/AUTO_MERGE.md`) |
| factory-research/plan/build/status.yml | Project Factory pipeline (brief, approve, build, status) |
| deps-audit-weekly.yml | Weekly npm + pip-audit sweep, opens one issue |
| e2e-smoke.yml | Daily production smoke |
| uptime.yml | Production uptime check every 15 min, opens an `incident` issue |
| model-registry-check.yml | Weekly diff of `config/models.yaml` against the OpenRouter catalogue |
| model-eval.yml | Manual coding-smoke eval for a candidate model |
| tech-radar-weekly.yml | Weekly tech radar on `cheap`/`strong` roles |

## 6. Hard rules and permissions
| Actor | Allowed alone | Needs owner's explicit yes | Blocked |
| --- | --- | --- | --- |
| Hub (Sonnet) | write issues, review PRs, merge green PRs (`--auto --squash`), read-only ssh inspection, update docs | any prod deploy (one question), restart containers, change files on prod, spend beyond caps, DB migration or data fix, install systemd units, enable paid GitHub features, rotate keys | implementing product code, running model/agent code on prod, direct ssh writes without owner OK, entering or pasting keys, pytest over `src/`/repo root |
| Workers (rx, agents) | branch + PR only | n/a | prod access, secrets, migrations |
- Migrations land only via reviewed PRs; never directly on the production DB. Customer/case data never goes to `:free` models.
- Never put a service key in frontend code. Secrets from the environment only; no defaults in code.
- Run only CI-collected tests (`src/ci_quarantine.py`); many `src/test_*.py` run git or paid APIs at import.
- Never read `repomix-output.xml`, `database_snapshots/`, `*.sql`, `*.tar.gz`. `git fetch && git checkout origin/main` before work.
- Owner replies in Persian; code, commits, docs in English.

## 7. Legal corpus and source policy
| Pointer | Content |
| --- | --- |
| `docs/LEGAL_COVERAGE_ROADMAP.md` | Measured gap (8 laws, no circulars/opinions/rulings) and the W25 plan |
| `docs/LEGAL_COVERAGE_MANIFEST.md` | Auto-generated coverage (`scripts/legal_coverage_report.py`, `data/legal/coverage_manifest.json`): 8 laws, 4,216 article rows |
| `docs/W25_phase1_acquisition.md` | Phase 1 acquisition; written when no official site was reachable from the agent sandbox |
- Source policy: `rc.majlis.ir` first (official; reachable from the owner's Mac on 2026-09-30 afternoon, unreachable from the earlier agent sandbox probe). `ekhtebar.ir` is tier `secondary` (crawler `src/legal_intelligence/ekhtebar_crawler.py`; the tier label itself is UNVERIFIED in code). Never ingest invented or unofficial text as primary.
- Open risk: `لایحه اصلاحی قانون تجارت` may be a bill stored as active; lawyer review pending.

## 8. How this file stays true
- Regenerate the derivable part after any change to compose, nginx, workflows, package.json or `config/models.yaml`: `python3 scripts/gen_system_inventory.py` (`--check` exits 1 on drift).
- Hand-maintained parts (sections 2 host facts, 4 key table, 5, 6) are updated on every `/handoff`; put the date of any prod re-check in the change.
- Facts about prod were observed by the hub on 2026-09-30; re-verify with read-only ssh before relying on them.
