Read `docs/AI_HANDOFF.md`, then `AGENTS.md`. Follow both. Also read `docs/agents/LESSONS.md` before every task.

# Antigravity standing rules (lane workers)

You are a stateless queue worker: each session starts with no memory. State lives in git, GitHub issues/PRs and issue 592 only.

## How to work
- Do your lane's queue with the skill `process-queue` (`.agents/skills/process-queue/SKILL.md`). The prompt gives the lane, e.g. "Use skill process-queue for lane L5". Follow the skill exactly; it is the single loop (claim, worktree, implement, test, PR, `merge-queue` label, Handoff, next row).
- Queue = open issues with labels `agent` + your lane label, else your lane's rows in the newest `## WAVE` comment on issue 592. Rule details: `docs/antigravity/LANE_RULES.md`.
- Per run: 8-12 PRs, then stop cleanly. Empty queue = stop, do not invent work.
- WIP cap: 8 open PRs per lane (not counting `WAITING-OWNER`). At the cap, only repair your own PRs.

## Never
- Never merge a PR, use `gh pr merge` / `--auto` / `--admin`, push to `main`, or use `--no-verify`. The box merge gate merges PRs labelled `merge-queue`.
- Never write a `Cross-family review` comment or a `Verdict:` line (all lanes are Gemini; the review desk is another family).
- Never run `pytest` over `src/` or the repo root. Run only tests that `.github/workflows/ci.yml` collects, only for files you touched.
- Never read `repomix-output.xml`, `database_snapshots/`, `*.sql`, `*.tar.gz`. Never print env vars. Never put a key, token or password in code, tests, PR text or frontend.
- Never edit a migration already on `main`; new migrations get a timestamp after the newest on `main` and every open PR.
- Never hardcode a model id; use `config/models.yaml`.
- Never touch production servers or databases.
- Never use `/teamwork`, `/goal` or `/schedule` (dies with its chat). `/automation` is allowed only as defined in `docs/antigravity/AUTOMATIONS.md`; `/compact <next instruction>` when the context is full; `/plan` only for lane P1.

## Protected paths -> label `needs-human`, no `merge-queue`
Migrations, payment, auth, `Dockerfile.prod`, deploy scripts, `.github/workflows`, nginx, production compose, and B1 core (Smart Judge core prompts/algorithms, billing, pricing, tax rules, all `country_packs/**`). Open the PR as draft or ready, add `needs-human`, post the Handoff block, move on. Never label `merge-queue` on `needs-human`, `do-not-merge`, `[needs owner]` or draft PRs.

## Quality bar
- Open the real file before naming any field, route, label or file; never invent one.
- Money is bigint minor units via `output_apps/enterprise_hub/modules/accounting/money.ts`. Every tenant table: `tenant_id`, FORCE RLS, `TenantScope`, and a `*.pg.spec.ts` run as `roxira_app`. Fail closed.
- Small PRs (about 400 lines, 8 files). Specs assert what the PR body claims; do not report anything you did not run.
- Review noise: do not reply to or push for ruff/ESLint inline comments. Act only on a red required check, desk `Verdict: blocker` at the current head, or hub `BLOCKER:`. One push per PR per round; never push on a head with a `no blocker` verdict and green CI.
- After 2 failed CI-fix pushes on a PR: stop, post the Handoff block, mark BLOCKED, move on.
- Do not dispatch `review-desk.yml` by hand.

## Environment
- `source scripts/dev/lane_env.sh` first (worktrees and caches on the work disk). One worktree per PR; remove only your own with `git worktree remove <path>`; never bulk delete. Use `claim.sh`, never share a working directory.
- Push: `LOCAL_CI_SKIP_PYTEST=1 FRESH_DB_PORT=<unique port> git push`. The hook can take up to 20 minutes; wait once.
- Do not bind reserved ports (AGENTS.md section 7).

## Report
Before the final REPORT run `python3 scripts/dev/verify_agent_report.py --since <date> <file>` until `RESULT: OK`, then post it on issue 592 (first line `REPORT <WAVE> <date> <lane>`).

Agent Skills live in `.agents/skills/<name>/SKILL.md` (loaded on demand).
