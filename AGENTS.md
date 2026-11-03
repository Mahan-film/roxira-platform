> Any AI assistant: read `docs/AI_HANDOFF.md` first.

# ROXIRA AUTONOMOUS ENGINEERING STANDARD (AGENTS.md)

## 1. System Architecture & Boundaries
- **AI Core Layer (Python / FastAPI)**: Strictly located under `output_apps/generated_modules/smartjudge/`. Handles NLP, Qdrant vectors, PostgreSQL LightRAG graph CTE, and legal inference. Exposes OpenAPI/REST.
- **Enterprise App Layer (NestJS / TypeScript)**: Strictly adheres to modular Controller-Service-DTO-Repository pattern.
- **UI/UX Layer**: Next.js App Router with Tailwind CSS and shadcn/ui composable components.

## 2. Mandatory NestJS Engineering Rules (agent-nestjs-skills)
1. **No Circular Dependencies**: Never import modules in a circular cycle; use forwardRef() only when strictly unavoidable.
2. **Strict DTO Validation**: Every HTTP endpoint must have a dedicated class with `class-validator` and `class-transformer` decorators.
3. **Repository Pattern**: Never query database directly from controllers. Business logic belongs to Services, persistence to Repositories.
4. **Contract-First Synchronization**: Always generate OpenAPI/Swagger schemas before writing client API hooks.
5. **Zero Hardware Waste**: Optimize asynchronous tasks using Redis Streams / BullMQ.

## 3. Tool & Model Orchestration
Model ids and prices live in one place now: `config/models.yaml` (the W12 model
registry, docs/STRATEGY.md §3/§5). Roles: `architect`, `executor`, `reviewer`,
`mechanical` (builder agents) and `free`/`cheap`/`strong`/`stt`/`tts` (product
runtime). Read it via `output_apps/generated_modules/smartjudge/model_registry.py`,
or run `python3 scripts/check_models.py` to check every id against the live
OpenRouter catalogue. Do not hardcode a model id anywhere else — add or change
it in `config/models.yaml`.

## 4. Hard rules
- Never put a service key or token in frontend code (`output_apps/enterprise_hub/frontend/`).
  It ships to the browser.
- Every new Postgres table needs an ownership/tenant column, with access checks enforced in
  the NestJS repository layer — never trust a client-supplied tenant id alone.
- Migrations only land via reviewed PRs. No direct migration on the production database.
- Free models first, paid as fallback (owner decision 2026-10-14). All current customers are test
  accounts and the data is not confidential, so `:free` / may-log providers MAY be used for product
  and customer data too: route free tiers first, paid models only when the free ones fail or hit a
  limit. Revisit this rule (and the privacy page) before onboarding real paying customers with
  confidential data. Never send secrets/keys to any model.
- Subagent roles for this repo are defined in `.claude/agents/` (`implementer`, `tester`,
  `reviewer`); use them instead of re-deriving the same scope/model split ad hoc.

## 5. Context selection

For “where is X?” or “who calls Y?” questions, use the codebase-memory MCP and qmd first.
Use `scripts/dev/pack_agent_context.sh` to pack a file list only for a documented cross-cutting task.
Never pack the whole repository, `data/`, `database_snapshots/`, or customer data, and never put a secret in a pack.

## 6. Zero-Destruction & Mandatory Pre-Flight Audit Policy (STRICT GUARDRAIL)

Every agent, LLM, or automated script operating in this repository MUST strictly follow these rules:

1. **Mandatory Read-Only Discovery Phase First**:
   - Before executing ANY action, migration, file edit, or cleanup, you MUST conduct a comprehensive research/audit phase using ONLY read-only commands (e.g., git status, git branch --no-merged, find, grep, sed, head, python read-only scripts).
   - Never assume directory structure, unmerged branches, or database states without verifying live evidence first.

2. **Absolute Ban on Bulk Destructive Commands**:
   - NEVER suggest or execute bulk destructive commands (rm -rf, git reset --hard on remote/shared heads, git clean -fdx, or dropping database tables).
   - Worktree cleanup MUST be selective and per-branch verified; NEVER execute bulk directory wipes on .claude/worktrees/, ~/Developer/rx-wt/, or any staging backup directory.
   - Files in ~/Backups/ and ./data/ are strictly IMMUTABLE. Any data hygiene or deduplication must be output to a NEW, isolated destination file.

3. **Deterministic 4-Step Safety Lifecycle**:
   - Step 1 (Audit & Research): Inspect dependencies, unmerged commits, and configuration schemas.
   - Step 2 (Dry Run / Validation): Test using --dry-run, validate, or sandbox fixtures without writing to prod/git state.
   - Step 3 (Explicit Impact Report): Print exact filenames, line counts, and revert strategies to the owner.
   - Step 4 (Targeted Execution): Only apply surgical, reversible changes after the owner explicitly approves.

## 7. Port Reservation & Network Map Policy (STRICT GUARDRAIL)

To prevent breaking existing live services, background workers, or proxies on the host:
1. **Never Bind to Active Reserved Ports**:
   - Web / Apps: 80, 443 (Nginx Gateway), 8000 (Python AI Core), 3000 (NestJS Enterprise Hub), 3001 (Next.js Frontend), 3002 (Twenty CRM).
   - Data / Cache: 5432 (Postgres), 6432 (PgBouncer), 6379 (Redis), 6333 (Qdrant).
   - Research / Automation: 8888 (SearXNG API), 8005 (Factory Dispatcher), 4000/4001 (Gateways).
   - Tunneling & Proxies: 2053, 2096, 8443, 11111, 62789.
2. **Pre-Allocation Verification**:
   - Any new tool, container, or background process MUST explicitly run `ss -tulnp | grep <PORT>` first.
   - If a port is occupied, binding without owner-approved reconfiguration is strictly prohibited.

## 8. Working with other agents and people

- Before starting, run `bash scripts/dev/whoswhat.sh` to see what is claimed.
- Claim the task with `bash scripts/dev/claim.sh <n>`. The draft PR is the lock.
- One worktree per agent. Never share a working directory.
- Branch names: `<login>/<issue>-<slug>` for people, `agent/<agent-id>/<issue>-<slug>` for agents (`claim.sh --agent <id>`). Agent ids: `claude-<login>`, `opencode`, `antigravity`, `server-<lane>`.
- When you stop or are blocked, post the Handoff block from `.github/pull_request_template.md` as a PR comment.
- Push or comment at least every 2 h while working. Otherwise the claim may be released by `scripts/dev/team_status.py --release-stale`.
- At most 2-3 active agents per person.
- Never use `--no-verify`. Never bypass the pre-push guard (`scripts/dev/guard_old_history.sh`) or GitHub push protection.
- The reviewer must be another model family (`scripts/dev/check_reviewer_family.py`).
- Keep PRs small. Rebase on origin/main daily.
- The repo is PUBLIC. Never commit .env files, keys or customer data.
