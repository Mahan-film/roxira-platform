# Factory P1: cost per accepted task, lane budgets, cross-family review (2026-10-30)

Implements P1 of `docs/strategy/FACTORY_GAP_AUDIT_2026-10-30.md`. Code: `scripts/infra/server_agents/`.
Lane budgets and the reviewer hook are revived from draft PR #843 (its architect template is not included).

## Cost per accepted task
- `taskq.py` stores `cost_usd`, `tokens`, `unmetered`, `done_ts` on every task. Cost = every attempt of the task
  (failed ladder steps too) plus its review.
- **Gateway steps (`best`, `free`) and the review**: read from the key-pool cost log (`requests.jsonl`). A call tagged
  with `task` (the reviewer) goes to that task; an untagged agent call is split evenly between the attempts running at
  that moment (`lane_budget.task_spend`).
- **Direct steps (`ds-flash`, `strong`)** call OpenRouter outside the gateway. taskq reads the agents key's total usage
  (`GET /api/v1/key`) before and after the attempt and stores the difference in `attempts.direct_usd` (split if
  attempts overlapped). Needs `OPENROUTER_API_KEY_AGENTS` in taskq's environment; without it the attempt counts in
  `unmetered` and the report says the cost is incomplete. The key's usage also includes anything else using that key.
- Cost lines: a gateway call is already in `requests.jsonl`, so `llm_client` does not log it again (it would count twice);
  only direct OpenRouter calls are logged in `llm_calls.jsonl` (tagged with the task). Untagged gateway calls are split between
  the attempts running at that time, review attempts included. `direct_usd` is booked to the day the attempt ended.
- `direct_usd` feeds both the task cost and the lane budgets (`lane_usage`), and `backfill` keeps it.
- **Rule**: `done` = the agent finished and the checks passed. A task is **accepted** (counted in reports, fit for a PR) only
  when it is `done` and its review did not fail and is not still running. The owner gets "ready, waiting for review" when the
  task finishes and the verdict ("approved" / "rejected, do not open a PR" / "not reviewed") when the review ends; with
  `TASKQ_REVIEW=0` there is no review and the plain "done" message. A restart marks an orphaned running review as error;
  `retry` clears the verdict.
- **Accepted** (details): status `done` and the review did not fail. A failed review moves the task to
  `rejected_by_review` and its cost to waste; `error`/`skipped`/no review stay accepted but count as `unreviewed`.
- `taskq.py report [--days 7] [--fa|--json]`; the Persian text is appended to `cost_report.py --weekly-fa`.
  `taskq.py backfill [--dry-run]` estimates the same numbers for old tasks (window = attempt start to next attempt).

## Lane budgets
`lane_budgets.json` (or `$TASKQ_BUDGETS`): `usd_per_day`, `tokens_per_day`, `attempts_per_day` per lane (`be fe data test review`),
UTC day. `taskq.py add --lane be`, `taskq.py budget`. A lane over budget is skipped, other lanes keep running; the owner is told once
per lane per day. `TASKQ_MAX_ATTEMPTS_PER_DAY` still wins as the global cap.

## Cross-family reviewer
After a task is accepted, taskq runs `review_hook.py` on its patch (default on; `TASKQ_REVIEW=0` disables).
- Candidates: the `reviewer` role of `config/models.yaml` in file order (free first), minus the author's family
  (`scripts/dev/check_reviewer_family.py`, which also folds bare names such as `gpt-oss-120b` and host prefixes).
- **Routes**: the key-pool gateway serves *group* names only, never raw model ids. So role ids go to OpenRouter by id
  (taskq runs outside the agent sandbox, key `OPENROUTER_API_KEY_AGENTS`), and the gateway is used through the groups
  `agent-strong-free` (public code only, free tiers may log) and `agent-free-paid`. Order (AGENTS.md §4, free first): free group,
  free role ids, paid role ids, paid group last.
  The groups are used only when the author's model family is known.
- A reply counts only if the model that actually served it is not in the author's family (a group can fall back to DeepSeek).
- Checklist: `.claude/skills/review-diff/SKILL.md`; the diff is framed as untrusted data; a bad or incomplete reply is
  `error`, never `pass`. Verdict: `tasks.review` and `reviews/<id>.json`.

## Agent sandbox additions
`run_task.sh` now passes only the key of the chosen route (`$KEYVAR`) into the sandbox env file, not all three.
`agent_sandbox.sh` hides `logs`, `taskq`, `taskq.db`, `patches`, `reviews`, `plans` under `/var/lib/roxira-agents`, and mounts a
tmpfs over `worktrees/` with only the run's own directory bound back in. `agent_sandbox_probe.py` checks these, so a
mistake makes `sandbox_check` fail and no agent starts. The systemd side could not be run on the Mac: the first
run on srv1 is the real test (`agent_sandbox.sh check`).

## Task #46 `models-long-sambanova` (failed 2026-10-22)
Read-only from srv1 logs. Cause: **the OpenRouter agents key hit its daily limit** (`Key limit exceeded (daily limit) ... $5.00 of $5.00
used; resets 2026-10-23T00:00:00Z`) while the `ds-flash` step was still editing `tests/test_registry_long_sambanova.py`. opencode exited 1
after 693 s; the work was complete: 3 files changed, workbench checks all passed. The task was not public, so the free steps were
skipped and `strong` had no alias, so the ladder ended. Not a bug in the task or the code.
Gap: `run_task.sh` does not treat "Key limit exceeded" as a rate limit, so a daily limit looks like an ordinary failure.
Fix on the server: `python3 taskq.py retry 46`, or push the kept branch `agent/20261022-195259-models-long-sambanova-a1`.

## Server steps
1. Deploy `main`, copy `/var/lib/roxira-agents/taskq.db`, then run `taskq.py backfill` once.
2. In `/etc/roxira/taskq.env` set `KEYPOOL_MASTER_KEY` (review groups) and `OPENROUTER_API_KEY_AGENTS` (review role ids and direct-step cost); restart `roxira-taskq`.
3. `bash scripts/infra/server_agents/agent_sandbox.sh check` after deploy, then `taskq.py retry 46`.
