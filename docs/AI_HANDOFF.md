# AI handoff: how any assistant continues this project

Works for Claude, Gemini, DeepSeek, Codex, OpenCode or a person. Read this first, then `AGENTS.md`.

## What this project is

Roxira is a modular accounting and ERP suite, Iran first, sold on roxira.ir and roxira.net. Smart Judge is a separate
product on ghazihoushmand.ir. Stack: NestJS (`output_apps/enterprise_hub`), Next.js (`.../frontend`), Python and FastAPI
AI core (`output_apps/generated_modules`), PostgreSQL through PgBouncer, Redis, Qdrant.

## Sources of truth

| Question | File |
|---|---|
| What is done, partial or missing | `docs/strategy/REQUIREMENTS_STATUS.md` |
| Plan and order | `docs/strategy/MASTER_PLAN_2026-10-31.md`, `docs/strategy/IRAN_FIRST_ROADMAP_2026-10-31.md` |
| Current state | `docs/STATE.md` |
| What exists | `docs/SYSTEM_MAP.md` |
| Laws and statutory figures | `docs/legal_sources/iran/`, `docs/hr/STATUTORY_OPEN_ITEMS.md` |
| Research input (not verified fact) | `docs/research/2026-10-31/` |
| Deploy and server | `docs/ops/AUTODEPLOY.md`, `docs/ops/DEPLOY_LOCAL.md`, `docs/ops/APP_DB_ROLE.md` |
| Model ids | `config/models.yaml` |

## Picking up work

1. `git fetch origin`, then branch from `origin/main`. Never work on `main`.
2. Run `bash scripts/dev/whoswhat.sh`, then claim with `bash scripts/dev/claim.sh <issue>`.
3. Pick a row marked missing or partial in `REQUIREMENTS_STATUS.md` that no one has claimed.
4. Stay in one lane below. If you need a shared file, keep that edit small and merge it first.
5. Test, then open a PR. Update the row in `REQUIREMENTS_STATUS.md` in the same PR, with evidence.

## Lanes

One writer at a time per lane.

| Lane | Paths |
|---|---|
| Accounting | `modules/accounting`, `frontend/src/app/app/accounting` |
| Sales and stock | `modules/invoicing`, `modules/inventory` and their pages |
| CRM | `modules/crm` and its pages |
| HR and payroll | `modules/hr` and its pages |
| Tax | `modules/tax_compliance` and its pages |
| Import | `modules/data_import`, `modules/invoice_capture` and their pages |
| Access and security | `modules/access`, `modules/auth`, `modules/tenants` |
| Factory | `scripts/`, `config/`, `docs/ops/` |

Shared files, one change at a time: `package.json`, lockfiles, `app.module.ts`, `app-shell.tsx`, `permission-matrix.snapshot.json`,
and any new file in `migrations/`. Take the next free migration timestamp, keep migrations self-contained, and put seed
data in `migrations/data/`.

## Rules that cannot be skipped

- Reply to the owner in Persian; code, commits and docs in English.
- Never run `pytest` over `src/` or the repo root. Never read `*.sql`, `repomix-output.xml` or `database_snapshots/`.
- Secrets come from the environment only. Never print or commit a key.
- Every new tenant table has `tenant_id`, an access policy and FORCE RLS.
- Money uses `modules/accounting/money.ts`, never JS floats. Legal rates live in statutory parameters, never in code.
- AI output is a proposal. Rules post to the ledger, not models.
- Prices and business decisions belong to the owner. Migrations land only through PRs.
- Run local CI through the pre-push hook. Never skip it. Do not use `--admin`.
- The server is `ssh roxira-prod`: read freely, but ask the owner before changing anything there.

## Leaving work for the next assistant

Before stopping, push your branch and add this to the PR or issue:

```
Done:
Not done:
Tests run and result:
Not verified:
Next step:
```

Do not call work finished without test evidence. If a result is unknown, say so.
