# Roxira context hub — start here (for any AI or person joining)

One page that points to everything: what Roxira is, where we are, what is decided, what is built,
what runs where, and how to review it. Keep it short; details live in the linked files.
Generate a single pasteable bundle with `bash scripts/dev/context_pack.sh` (see the end).

## 1. What this is
- **Owner**: Mahan (Persian speaker; replies to the owner in Persian, code/docs in English).
- **Products**
  - **Smart Judge / قاضی هوشمند** — ghazihoushmand.ir: Persian legal AI chat over Iranian law (RAG over
    Qdrant), payments (Zibal, USDT), subscriptions, voice, legal strategy, contract review.
  - **Roxira Business Suite** — roxira.ir/app: multi-tenant CRM, HR, accounting (multi-currency),
    inventory, invoicing + VAT, AI import (Excel/CSV/PDF/photo and whole databases: SQLite/.sql/.zip),
    MCP server for agents.
  - **Software factory** — server agents that build features from task files (taskq + OpenCode +
    workbench checks, optional Daytona sandboxes).
  - roxira.net — English B2B site.
- **Repo**: github.com/Mahan-film/roxira-platform (private); mirror on Codeberg.

## 2. Where we are (always current)
| Question | File |
| --- | --- |
| Current state, what shipped, next workstreams | [docs/STATE.md](STATE.md) |
| Inventory: server, containers, timers, keys (names only), architecture | [docs/SYSTEM_MAP.md](SYSTEM_MAP.md) |
| Long-term plan and owner decisions | [docs/strategy/MASTER_PLAN_2026-10-16.md](strategy/MASTER_PLAN_2026-10-16.md), [docs/STRATEGY.md](STRATEGY.md) |
| Rules for agents (hard rules, model policy, safety) | [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md) |
| Owner-facing overview (Persian) | [docs/OWNER_MASTER_OVERVIEW_FA.md](OWNER_MASTER_OVERVIEW_FA.md) |
| What changed recently | `git log --oneline -40 origin/main` (squash merges, one line per PR) |

## 3. Strategy documents (newest first) and status
| Document | Topic | Status |
| --- | --- | --- |
| [strategy/FACTORY_V2_2026-10-22.md](strategy/FACTORY_V2_2026-10-22.md) | Software factory v2: lanes, build/E2E/post-deploy gates, Daytona, budgets | Design; gates 2-4 next |
| [strategy/SUITE_V2_COMPOSABLE_2026-10-22.md](strategy/SUITE_V2_COMPOSABLE_2026-10-22.md) | Adopt/defer/reject: Docling, MCP, LangGraph, AG-UI, Blnk/Formance, ERPNext, Daytona, cloud accounts | MCP built; Daytona optional backend built; Docling-on-Modal next (Modal GPU verified) |
| [strategy/ROXIRA_BUSINESS_SUITE_2026-10-22.md](strategy/ROXIRA_BUSINESS_SUITE_2026-10-22.md) | Business suite on our own NestJS modules, AI import pipeline, phases | Phase 1 live; phase 2 partly (invoicing+VAT, multi-currency, DB import) |
| [strategy/LEAN_ARCHITECTURE_2026-10-22.md](strategy/LEAN_ARCHITECTURE_2026-10-22.md) | RAM/disk plan: Workers AI embeddings, disk guard, edge cache, memory caps | Done except slim app image |
| [strategy/MODEL_ROUTING_DECISION_2026-10-17.md](strategy/MODEL_ROUTING_DECISION_2026-10-17.md) | Free-first model ladders per plan | Live |
| [strategy/MASTER_PLAN_2026-10-16.md](strategy/MASTER_PLAN_2026-10-16.md) | Factory first, then global business | In progress |
| [eval/MODEL_BAKEOFF_2026-10-20.md](eval/MODEL_BAKEOFF_2026-10-20.md) | Model quality/cost ranks | Applied |

## 4. Infrastructure and tools (summary; details in SYSTEM_MAP §2)
- **srv1** 91.107.248.99 (Hetzner, 4 vCPU / 7.7 GB / 75 GB), Docker Compose, nginx, Cloudflare in front.
  Auto-deploy every 5 min from `main` with migrations (backup first), smoke tests and rollback.
- **Data**: Postgres 17 (+pgbouncer), Redis, Qdrant (laws v6 live, v7 built not switched),
  Cloudflare R2 bucket `roxira-uploads`, Neon (off-site restore), Qdrant Cloud replica, Codeberg mirror,
  encrypted daily DB backup to the owner's Telegram.
- **AI**: LiteLLM key pool (free-first ladders), Cloudflare Workers AI bge-m3 for query embeddings
  (TEI fallback), Modal GPU (`mahanpikasso` workspace, $30/month cap) for heavy embedding/doc jobs.
- **Agents/factory**: `roxira-taskq` queue on srv1 (`scripts/infra/server_agents/`), OpenCode + DeepSeek/
  free models, workbench checks, Daytona sandboxes (optional), MCP server at `/enterprise-hub/mcp`.
- **Monitoring**: synthetic + log monitors, disk guard, Telegram control bot alerts.

## 5. How to review or continue work
- Code layout: AI core `output_apps/generated_modules/smartjudge/` (FastAPI), business API
  `output_apps/enterprise_hub/modules/` (NestJS), frontend `output_apps/enterprise_hub/frontend/` (Next.js),
  ops scripts `scripts/ops/`, legal data pipeline `scripts/legal/`, factory `scripts/infra/server_agents/`.
- Never run pytest over `src/` or the repo root (tests there commit/checkout git and call paid APIs).
- Before claiming something is live: check `/root/deploy-state/autodeploy-last.json` and
  `autodeploy-failed-shas` on srv1 — a merge is not a deploy if the build or smoke test failed.
- Secrets: never in git or chat; set with `scripts/ops/set_server_env.sh NAME`.

## 6. Ready-to-paste prompt for another AI
> You are reviewing the Roxira platform. Read docs/CONTEXT_HUB.md, then docs/STATE.md and
> docs/SYSTEM_MAP.md, then the strategy files listed in CONTEXT_HUB §3. Summarise: (1) what was merged in
> the last 30 commits on main and what is actually deployed, (2) which strategy items are done / partial /
> not started, (3) the top risks and open bugs, (4) the next 5 steps with file paths. Answer in Persian.

## 7. One-file bundle
`bash scripts/dev/context_pack.sh` writes `context_pack_<date>.md` in the current directory (outside git)
containing this hub, STATE, SYSTEM_MAP, the strategy index, the last 40 commits and the open PR list —
upload that single file to any AI. It contains no secrets (docs only; key names, never values).
