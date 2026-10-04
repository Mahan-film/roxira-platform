# Task caps and run ledger

`src/factory_pipeline/task_caps.py` gives autonomous workers hard stops;
`run_ledger.py` records what happened. Nothing is wired into `rx` yet:
rx behaviour is unchanged until the hub opts in.

## Defaults (`TaskCaps`)
25 turns, 400000 input tokens, 1800 s wall, 0.50 USD, 3 identical errors in a row.
`CapTracker.record(turn, tokens_in, tokens_out, usd, error_signature)` takes
per-turn deltas for tokens and USD and returns a `CapAction`: `CONTINUE`
(with a warning at 85% of input tokens) or `PARK` with a reason. The clock is injectable.

## Hook points for rx (not implemented)
1. After `worker_pid` is started: create a `CapTracker()` (or a small python helper
   process that owns it) and call `append_task_event(n, lane, role, "step", ...)` per
   turn when the worker reports usage.
2. On `PARK`: kill the worker as the existing timeout branch does, log a `park`
   event with `reason`, and stop without a PR (park for hub review).
3. After the PR is created or merged: `append_task_event(..., "end", status="merged", pr=N)`.
4. An opt-in `RX_CAPS=1` should first only log (no enforcement), then enforce.

## Ledger
`$ROXIRA_STATE_DIR/runs/tasks.jsonl` (default `~/.local/state/roxira/runs/`).
Only ids, counts, statuses and hashes (`error_hash`) are stored: never keys,
prompts or file contents. Inspect with
`python3 scripts/dev/factory_status.py -n 10 --days 7`.
`summarize_days(days)` returns USD per merged PR, steps and wall time per task, park rate.
