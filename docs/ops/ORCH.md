# roxira-orch v0 (T276, issue #1079)

`scripts/infra/server_agents/orch.py` is a deterministic dispatcher for lanes L5-L7. It replaces the `claude -p` path
(#965/#1028) on the lane path: no consumer login, no LLM decides what to run. Decision D4 in
`docs/strategy/R20_DIGEST.md`; builds on taskq (`taskq.py`) and the lane caps (`lane_budget.py`).

## What one tick does

1. Kill-switch file present: exit 3, nothing else happens.
2. Reads open issues labelled `lane:L5`..`lane:L7` (REST through `gh api`, no GraphQL).
3. Orders them by the `## WAVE` comments on #592: issue numbers in the order they appear in the newest one, then in the
   next two older ones (`ORCH_WAVE_DEPTH`, default 3; set 1 for the newest only). Issues no WAVE mentions follow, ordered by `prio:N` label and then number. Only comments by an owner, member or
   collaborator count; bot comments and comments carrying the orch marker are ignored.
4. Skips an issue when: its lane has an issue labelled `in-progress` (WIP 1), its lane already has 2 open non-draft PRs
   that `Closes #N` a lane issue (WIP 2 in review), the lane is over its daily cap (`lane_budgets.json`, same code as
   taskq), the lane circuit breaker is open (3 failures in a row, 1 h), the issue has no `Done when` text, the author
   is a bot, the orch itself or not a collaborator, or an earlier job for it is active or reported.
5. With `--apply` only: claims (assignee + `in-progress` label, the same REST calls as `claim.sh`), writes the task file,
   `taskq add` (lane, `--public`, free-first ladder `best,free,ds-flash,strong` minus steps on cooldown; on the box the ladder
   and the lane scopes come from the box policy, see `docs/ops/BOX_LANE_POLICY.md`), runs the
   taskq worker once, pushes the result branch `agent/server-<lane>-<login>/<n>-orch`, opens or updates the DRAFT PR and
   posts a `REPORT:` comment on the issue (format accepted by `scripts/dev/verify_agent_report.py`; failures post a
   `BLOCKED:` row and release the `in-progress` label). It never calls a merge endpoint.

Dry run is the default: `python3 scripts/infra/server_agents/orch.py tick` prints `WOULD CLAIM #n ...` and `skip ...`
lines and makes no GitHub write. (It still opens the taskq SQLite file, which creates it if missing.)

```
orch.py tick [--apply] [--lane L5] [--max-claims 1]
orch.py status | stop | resume      # stop/resume create/remove the kill-switch file
```

## Safety design

| Risk | Control |
|---|---|
| Lanes trigger each other in a loop | Idempotency key `<issue>@<main sha>` in the `jobs` table; an issue with an active or reported job is never re-run; max 2 runs per issue; bot/self/marker-carrying issues and comments are ignored. |
| Prompt injection from issue text | Issue text is cleaned, capped and wrapped in `<untrusted-issue>` tags in the task file; scopes come only from operator env `ORCH_SCOPE_<LANE>`; slugs and branches use the issue number only; no key is ever in a task file. |
| Runaway spend | `lane_budget.py` daily caps per lane plus the global attempt cap (taskq), circuit breaker, per-issue run cap, one claim per lane per tick. |
| Rate limits | A 429 in an attempt output puts that ladder step on cooldown (default 900 s); the next task is created without it. |
| Crash or two timers | SQLite WAL (`$ORCH_HOME/orch.db`), a `tick` lease, job leases that expire to `expired` and count as failures. |
| Stop everything | `touch $ORCH_HOME/KILL` (or `orch.py stop`); checked before the run, before each claim and before publishing. |
| Telemetry | `$ORCH_HOME/orch_cost.jsonl`: ts, lane, issue, task_id, model alias, tokens, cost, exit status, sha, key. No prompts, no secrets. Model ids never appear: ladder steps are aliases resolved by `run_task.sh` and the gateway from `config/models.yaml`. |

## Running it on the box (systemd timer) - owner steps

Not installed by this PR. The owner (sudo, one line at a time) creates, for example:

`/etc/systemd/system/roxira-orch.service`

```
[Service]
Type=oneshot
User=<service user that owns the agents state dir>
Environment=ROXIRA_AGENTS_HOME=/var/lib/roxira-agents
EnvironmentFile=/etc/roxira/orch.env   # GH_TOKEN for gh (repo + pull_requests + issues), no other keys
ExecStart=/usr/bin/python3 /opt/roxira_platform/scripts/infra/server_agents/orch.py tick
```

`/etc/systemd/system/roxira-orch.timer`: `OnCalendar=*:0/5`, `Persistent=false`, `Unit=roxira-orch.service`.

1. Run the service once by hand in dry-run mode and read the output against the real issue list.
2. Only then add `--apply` to `ExecStart` (start with `--lane L5`).
3. `GH_TOKEN` lives in the env file, never in the repo or in a builder shell. A token that can push branches must not be
   visible to the builder; the push is done by the orch after the run, from the worktree path taskq reports.
4. Keep the kill switch handy: `orch.py stop`.

## What is NOT verified

- Nothing ran against the real GitHub repo or the real gateway: tests use a fake `gh`, a fake git and a fake runner.
- The `--slurp` flag of `gh api` needs a recent gh; the box version was not checked.
- `taskq.Worker.loop(once)` runs every queued task in the shared taskq DB, not only the orch task (orch tasks have
  priority 100, so they go first).
- The WAVE parser reads `#<number>` mentions only; a WAVE that mentions an issue only as background gives it rank.
- The `Done when` regex expects the phrase `Done when` in the issue body.
- The PR head SHA for the idempotency key is the SHA of `main` at claim time; re-opened work after `main` moved is
  allowed once more (cap: 2 runs per issue).
- Budget numbers for L5-L7 are the `default` entry of `lane_budgets.json`; the owner has not set lane-specific caps.
- verify_agent_report.py accepts the REPORT row format, but live PR checks (CI, review) were not run.
