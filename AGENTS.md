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
- Customer/case data never goes to a `:free`-tier model (`config/models.yaml`'s `free` role
  and the `free` agent in `opencode.json`) — those providers may log or train on prompts.
- Subagent roles for this repo are defined in `.claude/agents/` (`implementer`, `tester`,
  `reviewer`); use them instead of re-deriving the same scope/model split ad hoc.

## 5. Context selection

For “where is X?” or “who calls Y?” questions, use the codebase-memory MCP and qmd first.
Use `scripts/dev/pack_agent_context.sh` to pack a file list only for a documented cross-cutting task.
Never pack the whole repository, `data/`, `database_snapshots/`, or customer data, and never put a secret in a pack.
