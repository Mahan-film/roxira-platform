# Box lane readiness: what must be true before `orch.py tick --apply`

`--apply` is the owner's decision. This page is the checklist, and `scripts/ops/ci_box/lane_runner/lane_readiness.py`
runs the verifiable half of it **read-only**: no model call, no write to GitHub, no unit started or stopped, the
gateway key is never printed (it is read from `gateway.env` and sent only to the loopback gateway, and only on
`GET /v1/models`, which lists group names).

```
python3 scripts/ops/ci_box/lane_runner/lane_readiness.py            # full report (needs gh + tunnel for the live items)
python3 scripts/ops/ci_box/lane_runner/lane_readiness.py --offline  # repo and config checks only
python3 scripts/ops/ci_box/lane_runner/lane_readiness.py --json
```

Exit 1 when any item FAILs. WARN and UNKNOWN need a human look. Test: `src/ops/test_lane_readiness.py`.

## Checklist

| # | Must be true | Verify by hand | Script item |
|---|---|---|---|
| 1 | **#1092 closed** and **#1165 merged** (the key-pool health fix and the paid fallback of `agent-strong-free`) | `gh api repos/<org>/<repo>/issues/1092 --jq .state`; `gh api repos/<org>/<repo>/pulls/1165 --jq .merged_at` | `blocker-1092`, `blocker-1165` |
| 2 | The fix is **live on the server**, not only merged: groups healthy | owner, on the server: `bash scripts/infra/key_pool/health.sh` (all groups ok) | `deployed` (WARN until you confirm) |
| 3 | The **box key** is agent-groups only with a paid cap of at most 1 USD/day | `grep -n -A4 'box-lanes:' config/key_pool.yaml` | `key-spec` |
| 4 | Through the tunnel the key lists **exactly** `agent-free`, `agent-light-free`, `agent-strong-free`, `agent-free-paid` | `curl -s http://127.0.0.1:4181/health/liveliness`; then `GET /v1/models` with the key (names only) | `live-key` |
| 5 | The **ladder** resolves only to groups the key allows and the environment that runs orch/taskq sets `ROXIRA_LANE_POLICY` (or `TASKQ_LADDER`) | `ROXIRA_LANE_POLICY=$PWD/config/box_lane_policy.json python3 scripts/infra/server_agents/orch.py tick` prints `ladder: light,free,paid` | `ladder`, `ladder-env` |
| 5b | Orch goes through `lane-run`: the orch unit sets `TASKQ_RUNNER`, `TASKQ_BUDGETS`, `ROXIRA_AGENTS_HOME` (else the stop file, caps and key are bypassed) | `systemctl --user cat roxira-orch.service \| grep TASKQ_` | `runner-env` |
| 6 | **Scopes**: every lane has a scope, none touches the deny-list, no `ORCH_SCOPE_*` override widens it | `python3 -m pytest src/ops/test_lane_policy.py -q` | `scopes`, `scopes-env` |
| 7 | **Daily caps are loaded** for l5, l6, l7 and smoke (a missing file or a `0` means no cap) through the **installed** `lane-run` | `lane-run --budget --lane L5` shows non-zero caps | `caps-*` |
| 8 | `lane-run.conf` names an allowed agent group; USD caps sit within the key cap (server cap binds first otherwise) | `grep -v '^#' ~/.config/roxira-lane/lane-run.conf` | `lane-conf`, `usd-caps` |
| 9 | Kill switches known and tested once (stop file, KILL file, tunnel) | `docs/ops/BOX_KILL_SWITCHES.md`; try `touch` + `lane-run --dry-run` + `rm` | `switch-files` |
| 10 | Timers: queue timer disabled, no orch timer yet, merge gate `dry_run` is a conscious choice | `systemctl --user is-enabled roxira-lane-taskq.timer` | `taskq-timer`, `orch-timer`, `merge-gate` |
| 11 | One smoke call after a gap, within the lane `smoke` cap (5/day; free models are flaky) | `lane-run --smoke` (owner, once; the script never does it) | not run by the script |
| 12 | Owner decisions recorded: B1 scope meaning (L5 narrowness, `country_packs/de`), repo private, token scope of the orch `GH_TOKEN` | AGENTS.md 4a, `docs/ops/ORCH.md` | `private` (WARN) |

First `--apply` is then a manual dry run first, then one lane: `orch.py tick --apply --lane L7` (docs-only scope), with
the stop file ready (`touch ~/.local/state/roxira-lane/STOP`).

## Known gaps the report cannot close
- Token and USD metering on the box is partial: the key's `/key/info` spend gives USD per call; tokens stay `null`.
  taskq's own per-lane USD reading reads a gateway cost log (default path of the server's key pool); `lane_budgets.box.json`
  names none, so on the box the **attempts** cap and the server-side key cap are what bind (UNVERIFIED beyond the config).
- Fallback of `agent-strong-free` includes `gemini-best`, a group the box key does not list. Whether LiteLLM re-checks
  key access on a fallback is UNVERIFIED.
- Lane attribution: `taskq-runner.sh` booked every attempt on `L5` unless `LANE_RUN_LANE` was set; taskq now sets it from the task's lane.
