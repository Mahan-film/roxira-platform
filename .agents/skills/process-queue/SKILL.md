---
name: process-queue
description: Stateless queue worker for one Roxira lane. Picks the top unclaimed row from the lane's queue, claims it, implements it in its own worktree, opens a PR, labels it merge-queue, and repeats for 8-12 PRs, then stops. Use when the prompt says "Use skill process-queue for lane <X>" (manual chat or /automation run).
---

# process-queue

You are a fresh session with no memory. Everything you need is in git, GitHub and this file. The lane id (L1..L12, M1..M3, P1) comes from the prompt; `{lane}` below is its lowercase form and `{LANE}` the uppercase form. Never merge. Never print env vars or keys.

## 0. Start (once per run)
1. `git fetch origin && git checkout main && git pull`.
2. `source scripts/dev/lane_env.sh`, then `bash scripts/dev/lane_preflight.sh {LANE}`. On any `FAIL`: post BLOCKED on issue 592 (format in `docs/antigravity/LANE_RULES.md`) and stop.
3. Read `docs/agents/LESSONS.md` and `docs/antigravity/LANE_RULES.md` once. Read the newest `## WAVE` comment on issue 592 once. Do not re-read them per row.
4. `bash scripts/dev/whoswhat.sh` once.
5. `bash scripts/dev/install_hooks.sh` once.

## 1. Queue
Rows, in this order:
1. Your own PRs first: red required check, desk `Verdict: blocker` at the current head, hub `BLOCKER:`, or CONFLICTING -> fix (max 2 CI-fix pushes per PR, then post a Handoff block and mark BLOCKED).
2. Open GitHub issues with label `agent` plus the lane label (confirm the exact name with `gh label list -R Mahan-film/roxira-platform`), oldest first, skipping `in-progress`, `research-row` rows whose digest is missing, and "after T<n>" rows whose T is not merged.
3. If that list is empty, your `{LANE}` rows in the newest WAVE comment on issue 592, in written order. Then the WAVE Filler rows, only under the WIP cap.

Lane M1 has no build queue: it only runs step 6 for every open PR. M2/L8 only repair existing PRs. P1 only plans.

## 2. WIP cap
Count your open PRs (branch `agent/antigravity-{lane}/*`, plus "taking" lines on issue 592). Do not count `WAITING-OWNER` PRs. If the count is 8 or more, start no new row: fix blockers, rebase, then stop with a report.

## 3. Loop (one row at a time)
1. Pick the top unclaimed row. Skip anything another lane claimed on issue 592 in the last 2 hours.
2. Claim: `bash scripts/dev/claim.sh <issue> --agent antigravity-{lane}`. This creates the worktree (on the work disk after `lane_env.sh`), branch and draft PR (the lock). Post `taking #<issue> ({LANE})` on issue 592. Work only in that worktree.
3. Protected path check before editing. If the row touches migrations, payment, auth, `Dockerfile.prod`, deploy scripts, `.github/workflows`, nginx, production compose, or B1 core (Smart Judge core prompts/algorithms, billing, pricing, tax rules, any `country_packs/**`): add label `needs-human` (`gh pr edit <n> --add-label needs-human`), post the Handoff block, do NOT add `merge-queue`, take the next row. Write only files in your lane's slice.
4. Put a 5-line plan in the PR body. Implement the smallest change that meets "Done when" (about 400 lines and 8 files at most; split larger rows into independent PRs). Reuse open-source code per `docs/strategy/research/R19_REUSE_MAP.md`. Follow `.agents/rules/roxira-always.md`.
5. Test only what CI collects (`.github/workflows/ci.yml`, `src/ci_quarantine.py`), only for touched files: backend `npx jest <touched specs>`; frontend `npm run lint` then `npm run build` in the frontend folder; Python only the CI-listed test files. NEVER run `pytest` over `src/` or the repo root. Run `python3 scripts/ci/check_agent_guards.py` before pushing.
6. Push once: `LOCAL_CI_SKIP_PYTEST=1 FRESH_DB_PORT=<unique port> git push`. Never `--no-verify`. Wait once, long, for the hook; do not poll. Then `gh pr view <n> --json mergeable,headRefOid` must say MERGEABLE.
7. Ready: `gh pr ready <n>`. Fill "Coordinator must add" and "What was NOT checked" in the PR body. If the PR is not draft, not `needs-human`, not `do-not-merge`, has no `[needs owner]` in the title, and local tests passed: `gh pr edit <n> --add-label merge-queue`. Never run `gh pr merge` or `--auto`. Never write `Cross-family review` or `Verdict:` comments.
8. Post the Handoff block from `.github/pull_request_template.md` as a PR comment (actor `antigravity-{lane}`, done, next step, blockers, exact test commands and counts, "Secrets: none added").
9. Remove only this PR's worktree: `git worktree remove <path>`. Never bulk delete.
10. Next row. Do not wait for review or merge. Re-check the WIP cap before each pick.

## 4. Stop
Stop cleanly when any is true: 8-12 PRs opened or repaired this run; the queue is empty; WIP cap reached with nothing left to repair; context or credit is running low (leave the row as a draft PR and say what remains in the body); two CI-fix rounds failed on every remaining row.
Do not invent work to reach 12.

## 5. Report
Save a REPORT in the format of `docs/antigravity/LANE_RULES.md` to a file, run `python3 scripts/dev/verify_agent_report.py --since <date> <file>` until `RESULT: OK`, then post it on issue 592 (`gh issue comment 592 -R Mahan-film/roxira-platform --body-file <file>`), first line `REPORT <WAVE> <date> {LANE}`.

## Never
Merge or push to `main`; `--no-verify`; edit a migration already on `main`; weaken or skip a test; put a key in code; hardcode a model id outside `config/models.yaml`; touch production; use `/teamwork`, `/goal` or `/schedule`.
