# The agent factory: operating manual

How a task goes from an idea to production, who runs which lane, and what to do when it jams. Facts here come from [PARALLEL_CHATS.md](PARALLEL_CHATS.md), [COLLABORATION.md](COLLABORATION.md), [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) sections 7-8, [TEAM_SPLIT_2026-11-17.md](TEAM_SPLIT_2026-11-17.md), [agents/LESSONS.md](agents/LESSONS.md), `scripts/dev/claim.sh`, `scripts/dev/local_ci.sh`, `.github/workflows/review-desk.yml` and the WAVE/UNBLOCK/BOX comments on issue #592 (read 2026-11-20). The strategy behind it is in [STRATEGY_NOW.md](STRATEGY_NOW.md); the live state is in [STATE.md](STATE.md).

Hard rules for every agent: [AGENTS.md](../AGENTS.md) and [agents/LESSONS.md](agents/LESSONS.md) before every task. Never print environment values, `docker inspect` env or secrets (an agent leaked three on 2026-11-17). Never use `--no-verify`. Never run `pytest` over `src/` or the repo root.

## 1. How a task flows

```
issue (label lane:L1..L7, prio:1..3)
  -> WAVE comment on #592 sets the order per lane
  -> claim.sh <n> --agent <id>      (draft PR = the lock, own worktree)
  -> build + tests in the worktree
  -> git push  (pre-push local CI, 20-30 min)
  -> GitHub CI
  -> review desk verdict on the current head
  -> merge ("no blocker" + green)
  -> autodeploy on the server
```

1. **Issue.** One task, one issue, with a "Done when" spec. Queues are issues labelled `lane:L1`..`lane:L7` (plus `prio`, `research-row`, `filler`). Research rows T166 and up are issues too.
2. **WAVE.** The main hub posts a `## WAVE <n>` comment on #592 with the order for all seven lanes. The box hub posts `BOX:` reports there.
3. **Claim.** `bash scripts/dev/whoswhat.sh` first, then `bash scripts/dev/claim.sh <issue> --agent <id>`. It assigns you, labels the issue `in-progress`, creates `agent/<id>-<login>/<issue>-<slug>` in a new worktree and opens a draft PR with `Closes #<issue>`. Never take an issue that is already `in-progress`. Agent ids: `claude-<login>`, `opencode`, `antigravity`, `server-<lane>`.
4. **Build.** One PR per task, never draft after the work is done, one worktree per agent. Plan first (first PR comment, LESSONS rule 12). Migration ids must be above the newest on `origin/main` and above every open PR (`scripts/dev/check_migration_ids.py --open-prs` runs in CI).
5. **Pre-push local CI.** The hook runs `scripts/dev/local_ci.sh` (20-30 min). Give each session a unique port: `FRESH_DB_PORT=<port> git push`. Frontend-touching pushes can fail inside a sandbox that cannot bind a port; push from a normal terminal.
6. **GitHub CI.** Runs the full test suite, including pytest. Read `gh pr view <n> --json mergeable` before you call a PR ready (LESSONS rule 4).
7. **Review desk.** A different model family reviews the diff and posts one comment per PR head ending in `Verdict: no blocker` or `Verdict: blocker` (LESSONS rule 23).
8. **Merge.** Only with "no blocker" on the current head and green checks. See section 6.
9. **Autodeploy.** A server timer pulls and deploys `main` ([ops/AUTODEPLOY.md](ops/AUTODEPLOY.md)). Nobody deploys by hand. A dirty checkout on the server blocks it (the 2026-11-18 stall; fix tracked as T232, #961/#972).

## 2. Lanes and who runs them

| Lane | Scope | Runs on | Builder | Merged by |
|---|---|---|---|---|
| L1 | ops, CI, infra | Mac | Antigravity | main hub |
| L2 | frontend + currency | Mac | Antigravity | main hub |
| L3 | security, data | Mac | Antigravity | main hub |
| L4 | Smart Judge | Mac | Antigravity | main hub |
| L5 | core ledger | Linux box `roxira-ci` | Antigravity | box hub |
| L6 | DE pack, then Gulf | Linux box | Antigravity | box hub |
| L7 | box CI + phone kit | Linux box | Antigravity | box hub |

- **Fallback builder.** When Antigravity quota runs out, `bash scripts/ops/ci_box/gemini_lanes.sh start` (as the box user, from a login shell) opens tmux session `lanes` with Gemini CLI on L5, L6 and L7. `status|attach|stop` manage it. It never starts by itself. Antigravity cannot sign in on the box, so Gemini CLI is the box builder.
- **Hubs.** Main hub (Claude Code on the Mac): strategy, WAVE posts, review routing, merges for L1-L4 and hub PRs, all production steps. Box hub (Claude Code on the box, second account): L5-L7 reviews and merges, the phone stack, box upkeep; never touches production.
- **Claude subagents** (`.claude/agents/`: `implementer`, `tester`, `reviewer`) are for hub work only; the reviewer must be another model family than the author (`scripts/dev/check_reviewer_family.py`).
- **Hub-owned PRs** (infra rows such as WAL-G, flagd, error capture) are fixed by the hub. A lane takes one only if a blocker stays unfixed 12 h ([STATE.md](STATE.md)).
- Both hubs coordinate only through GitHub (issues, PRs, the latest WAVE). Both accounts push to the same repo.

## 3. WIP and CI rounds
- **WIP limit 3.** A lane with 3 or more of its own unmerged PRs takes no new row. It fixes blockers, rebases and stops (WAVE rule from [ARCHITECTURE_DECISIONS_2026-11-16.md](strategy/ARCHITECTURE_DECISIONS_2026-11-16.md)). Pushing fixes to those PRs is never blocked by the limit.
- **Two CI rounds.** If a PR is still red after two fix pushes, stop pushing. Post the Handoff block from `.github/pull_request_template.md` as a PR comment (Actor, Branch, Issue, Done, Next step, Blockers, Verification, Secrets), write the row as BLOCKED in your report and move on.
- Push or comment at least every 2 h while working, or the claim can be released (`scripts/dev/team_status.py --release-stale`, [COLLABORATION.md](COLLABORATION.md)).
- Rows marked "after T<n>" start only when that T's PR is merged. Do not wait on a merge when you are under WIP: stack and go on.

## 4. Prompts and reports
- **Prompts:** `docs/antigravity/prompts/L1.txt` .. `L7.txt` (plus `ALL_LANES.txt` and the shared [antigravity/LANE_PROMPT_FA.md](antigravity/LANE_PROMPT_FA.md)). A chat starts with `bash scripts/dev/lane_preflight.sh L<k>`, then reads LESSONS and the latest WAVE on #592. Prompts are in Persian; code, commits and docs stay English.
- **Report format** (posted on #592 when a lane runs out of work or gets stuck):

```
REPORT <WAVE> <date> L<k>
DONE:
T<n> | PR #<n> @ <head sha 8> | MERGEABLE|CONFLICTING|MERGED | CI green|red|pending | review: no blocker|blocker|none yet
  files: <1-3 main files>
  tests: <command> => <passed>/<total>
  not checked: <short>
SKIPPED:
T<n> | done in <path> (<spec name>)
BLOCKED:
T<n> | <what is needed, from whom>
NEW LESSONS:
QUESTIONS:
VERIFIER: RESULT: OK
```

- **Verify before you post:** save the report to a file and run `python3 scripts/dev/verify_agent_report.py --since <wave start date> <file>`. It checks every PR number, head SHA, mergeable state, CI state and cited path against live GitHub (exit 1 on problems). Fix the finding or move the row to BLOCKED until it prints `RESULT: OK`.
- A DONE row names only a PR you opened or pushed in this wave, with its current head SHA (LESSONS rules 21-23). List what you did not check (rule 13).
- A new Nest module must be wired in `app.module.ts` and a page in `nav-menu.ts`, or the PR body says "Coordinator must add" with the exact lines (rule 3).

## 5. Review desk
- Workflow: `.github/workflows/review-desk.yml` (cron every 2 h plus manual). Models come from `config/models.yaml` role `review_desk`; the author's own family is skipped. It only reads diffs via the API and never runs PR code.
- **Dispatch rule: once, with no `-f pr`.** `gh workflow run review-desk.yml -R Mahan-film/roxira-platform`. One run reviews every open PR whose head has no review yet (up to 8). Per-PR dispatches share one concurrency group and cancel each other.
- Dispatch again after lanes push new heads. A new head makes the old verdict outdated.
- A blocker can be a false positive. The lane comments why on the PR (with the file and line evidence); the hub decides. Do not rename or move code so the desk stops seeing it (LESSONS rule 1).
- The desk does not merge. Do not dispatch it per PR in a loop.

## 6. Merge rule
- Merge only when the latest review comment on the **current head** says `Verdict: no blocker` and required checks are green.
- Command: `gh pr merge <n> --repo Mahan-film/roxira-platform --auto --squash`. The answer "merge strategy set by merge queue" is fine. When the PR is already clean, `--auto` says "clean status"; merge with plain `--squash` and add `--delete-branch=false` to skip the prompt ([OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) section 7). A new push blocks the PR until CI re-runs.
- Never merge your own PR without that verdict. The box hub merges only L5-L7; the main hub merges the rest.
- Shared hotspots (`package.json`, lockfiles, `app.module.ts`, `app-shell.tsx`, permission matrix snapshot, migrations) take one writer at a time: `[hotspot]` in the title, merge it before the next starts.
- **Private repo plan A (not live yet):** protected branches and auto-merge are not available on the Free plan, so merges move to a merge desk script on the CI box and lanes stop calling `gh pr merge` ([strategy/PRIVATE_REPO_PLAN_2026-11-17.md](strategy/PRIVATE_REPO_PLAN_2026-11-17.md); `scripts/dev/merge_desk.py` in PR #1005 is not on `origin/main` yet, unverified).

## 7. Unblock playbook (lessons so far)
1. **Pre-push tests hang or time out on the Mac.** `scripts/ops/deploy_local.sh` read its confirmation from `/dev/tty`. The Antigravity terminal is a real pty, so six tests in `src/ops/test_autodeploy.py` and `src/ops/test_deploy_migrate.py` waited for a human and hit the 60 s timeout. The fix is test-only (`start_new_session=True`), PR #1006, announced on #592 as in the merge queue. Part of the same problem landed as #1002 (merged). Whether #1006 itself is on `origin/main` is unverified.
   - Temporary unblock: `LOCAL_CI_SKIP_PYTEST=1 FRESH_DB_PORT=<unique port> git push`. This skips only the local pytest step. GitHub CI still runs the full pytest suite, so nothing is hidden. After the fix lands, `git fetch origin && git rebase origin/main`, then a plain `FRESH_DB_PORT=<port> git push` works again.
   - Never `--no-verify`, never edit the hook, never weaken or delete the tests (LESSONS rule 2).
2. **Date bomb in a test.** `cheques.service.spec.ts` hard-coded today's date and turned Backend CI red for every PR on 2026-11-20. Fixed in #1003. Never hard-code a date that means "not today"; use a fixed past date or compute relative to now. After such a fix, rebase and re-run Backend on the affected PRs.
3. **Migration timestamps.** The id must be above the newest on `origin/main` and above every open PR; renumber on rebase. CI enforces it (`check_migration_ids.py --open-prs`, plus Squawk lint). Pull `main` right before creating a migration.
4. **Env leaks.** Never print env, `docker inspect` env or secrets in output, logs or reports. Read secrets from the environment only. The log scrubber hides secret-shaped text, so a filtered line is not proof that nothing is wrong.
5. **Never bypass guards.** No `--no-verify`, no bypass of `scripts/dev/guard_old_history.sh` or push protection. Fix the cause or write in the PR body why a check fails.
6. **Stuck on one thing.** Post the Handoff block, report BLOCKED, take the next row. A blocker needing another lane is written on #592, not fixed in their files.
7. **Ad-hoc help.** A hub that takes an unplanned fix says `taking ad-hoc: <what>` on #592 first, so nobody duplicates it.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `git push` hangs 60 s per test, pre-push fails on `src/ops/test_autodeploy.py` or `test_deploy_migrate.py` | test read `/dev/tty` under a real pty (#1006) | rebase on `origin/main` after #1006; until then `LOCAL_CI_SKIP_PYTEST=1 FRESH_DB_PORT=<port> git push` |
| Two sessions' local CI collide, database port busy | same `FRESH_DB_PORT` | give every session a unique port; check with `ss -tulnp` first and never use the reserved ports in AGENTS.md section 7 |
| Frontend-touching push fails at the Turbopack step | sandbox cannot bind a port | push from a normal terminal |
| Backend CI red on every PR, same spec | date bomb on `main` | land the fix on `main`, rebase, re-run Backend |
| CI says migration id too low or duplicated | id not above `origin/main` and open PRs | renumber, rebase |
| Review desk comment missing for your head | desk not dispatched since the push, or dispatches cancelled each other | one dispatch without `-f pr`; wait for the run |
| `Verdict: blocker` that is wrong | false positive | comment with file and line evidence on the PR; hub decides |
| `claim.sh` says issue is already in progress | someone holds the claim | talk to them; never take it |
| `gh pr merge --auto` says "clean status" | nothing to wait for | merge with plain `--squash` |
| `gh` or `git` fail with TLS or network errors | sandbox or network path | run outside the sandbox, retry with `git -c http.version=HTTP/1.1` ([OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) section 4) |
| Docker image pull fails on the box | the default registry is blocked from this network | use `public.ecr.aws` or `ghcr.io` images ([STATE.md](STATE.md)) |
| Deploy to the server stuck | dirty checkout on the server | T232 (#961/#972); hub checks the drop-in hot-fix ([STATE.md](STATE.md)) |
| Report rejected by the verifier | wrong SHA, PR not yours, missing path | fix the row or mark it BLOCKED, rerun until `RESULT: OK` |
| Claim released by `team_status.py` | no push or comment for 2 h on an agent branch | push or comment every 2 h |
| A lane keeps restarting its Gemini window | quota or crash | `gemini_lanes.sh status`; it restarts 10 min after exit, at most 6 times a day |
