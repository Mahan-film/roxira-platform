# Fleet rules for laptop agents (claude-win, owner mahansudo)

Source of truth: issue #116 (body + comments) in Mahan-film/roxira-platform. Repo: /home/mahan/Developer/roxira-platform.
Read the repo's CLAUDE.md and AGENTS.md before coding. Code, commits, docs in English.

## Priority (owner, #230, 2026-11-04)
Accounting comes first: core ledger, subledgers, fixed assets. Issues that the Mac opens with the `claude-win` label to hook into
the posting-rules engine (`modules/posting_rules`) or treasury are the TOP priority. The Mac owns posting_rules and treasury,
so only consume their public services and never edit those modules. No hardcoded account codes in new posting code.

## Owner UI rules (strategist, #227, 2026-11-04 evening): every page you touch
- Dates are Jalali everywhere (never 23/10/2026).
- Money is shown in rials or tomans as the tenant sets it. A foreign currency only when the document really is in it, and then with the rial equivalent beside it.
- Show real party names; never a placeholder like «طرف حساب 2322».
- Leave the dashboard as it is until the design-audit issues (#294-#307) specify it.
- Demo seed numbers must look like a small Iranian business (reference: e2e/fixtures/sample-company/).
- T3 statutory terms: StatutoryService.contractTermsOn(tenantId, asOf). A term with unclear:true has rate:null and must NEVER be read as 0: block posting or let the org set it. Check `verified` before presenting a figure as legal fact.

## Your one job
You own exactly ONE issue/PR, given in your prompt. Work only in its worktree under
/home/mahan/Developer/roxira-wt/. Never touch another agent's worktree or the main checkout's files.

- Existing PR: `cd` into its worktree (see `git -C /home/mahan/Developer/roxira-platform worktree list`).
  If it has none, `git worktree add ../roxira-wt/<n>-<slug> <branch>` from the main checkout.
- New issue: from the main checkout run `bash scripts/dev/whoswhat.sh`, then
  `bash scripts/dev/claim.sh <n> --agent claude-win` (or `claim.sh new "<title>" --agent claude-win`).
  The draft PR is the lock. If someone else claimed it, stop and report.

## Hard rules
1. **Push a WIP commit to your PR branch at least every 30 minutes**, even mid-work. Never `--no-verify`, never bypass the pre-push guard.
2. Before every push: `git fetch origin && git rebase origin/main`. Resolve conflicts (REQUIREMENTS_STATUS.md conflicts: keep both rows' updates).
3. **Hotspots** = `package.json`, any lockfile, `app.module.ts`, `app-shell.tsx`, `permission-matrix.snapshot.json`, any new migration.
   Only the agent whose prompt says "YOU HOLD THE HOTSPOT" may touch them. If you discover you need one and you do not hold it,
   stop and report back "NEEDS HOTSPOT: <file> because <reason>" — do not edit it.
4. Never edit CI/workflow files (`.github/workflows/*`) — those stay on the Mac. Never run `gh pr merge`. Never touch prod.
5. Never run pytest over `src/` or repo root. No secrets in code. The repo is PUBLIC.
6. PR size about 400 changed lines max excluding tests/fixtures; split if larger (open a follow-up issue with claim.sh new).

## Local Postgres (issue #227 step 0 — done by the coordinator)
A shared Postgres 17 runs on 127.0.0.1:55433 (container `rx-pgspec`, trust auth). Run pg specs locally before every `gh pr ready`:
`cd output_apps/enterprise_hub && ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55433 ROXIRA_TEST_PG_USER=postgres npx jest --runInBand --testPathPattern '\.pg\.spec\.ts$'`
(Run only the specs your PR touches if the full set is slow; the full set runs in CI.) For migrations (hotspot holder only):
`FRESH_DB_PORT=<free port 55440+> bash ../../scripts/dev/fresh_db_migrate.sh`. Never use reserved ports (AGENTS.md §7); check with `ss -tln` first.
Each worktree needs its own `npm ci` in output_apps/enterprise_hub if node_modules is missing. Never commit node_modules or data/*.db-*.
Issue #227 rules also apply: work only in your lanes (accounting, invoicing, inventory, crm, data_import, frontend pages);
money is integer rials via money.ts; every new tenant table gets FORCE RLS + an isolation spec; synthetic data only; Iran / roxira.ir only.

## Memory (IMPORTANT — the laptop crashed twice from OOM with 5 agents)
WSL has about 5 GB of RAM for five agents. Every heavy command must go through the shared lock, one at a time:
`/home/mahan/Developer/roxira-wt/_fleet/heavy.sh <cmd>` (2 slots once WSL has 5 GB, else 1; the old `flock .../heavy.lock` still works and takes slot 1). Heavy means npm ci, tsc, jest, playwright, next build and fresh_db_migrate.
Always run jest with `--maxWorkers=2` (for pg specs use `--runInBand` alone; jest rejects the two flags together), and run only the specs your change touches (CI runs the full set).
The pre-push hook already takes the same lock, so a push may wait for another agent's CI. That is expected; do not bypass it.
Use per-agent scratch/log file names (e.g. a3-161-push.log), never a shared push.log.
Never start long-running dev servers and leave them running.

## Definition of done (all in the same PR)
- Specs pass locally (jest). Any new table: tenant-isolation test. Any repository: a `*.pg.spec.ts` (runs in CI
  job `Backend (tsc + jest + Postgres specs)`, a required check — read its log if red and fix).
- `docs/strategy/REQUIREMENTS_STATUS.md`: update the matching row with file paths + test names as evidence.
- `e2e/tests/m1-shop-month.spec.ts`: if your feature covers a `test.fixme` step, implement it and turn it into `test`.
  Note: `scripts/ci/mint_e2e_session.js` inserts only tenants + users; AccessGuard also needs a `tenant_memberships` row —
  add it if your step is the first real one.
- CI green on the current head. Then `gh pr ready <n>` (also edit the title to drop "WIP").
- The Mac review desk posts a `Cross-family review` comment hourly. If it says `Verdict: blocker`, fix and push.
  If you are done and waiting only for that comment, you are DONE — report back, do not wait.

## Report back (your final message)
One short block: PR number + URL, state (ready / blocked / needs hotspot), head sha, CI result, tests run and result,
REQUIREMENTS row updated (yes/no), M1 gate steps turned green, anything not verified, follow-up issues opened.
If stuck for ~30 min without progress: post the Handoff block from `.github/pull_request_template.md` as a PR comment, push, and report "STUCK".
