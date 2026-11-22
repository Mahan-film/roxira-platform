# Box kill switches

One page: every way to stop something on the Linux box, the exact command, what it stops and what it does **not**
stop. Written for the owner at 3 a.m.: read the table, run one block.

Conventions: `<lane user>` is the unprivileged user that owns the lane stack (never root). `systemctl --user` needs a
user bus; from a root or `sudo -u` shell run `export XDG_RUNTIME_DIR=/run/user/$(id -u <lane user>)` first. State dirs:
lane stack `~/.local/state/roxira-lane` (this is `ROXIRA_AGENTS_HOME` of the queue unit), merge gate
`~/.local/state/roxira-merge-gate`, bridge `~/.config/roxira-bridge`. Nothing below needs a model call or a key.

## Quick table (fastest first)

| # | Switch | Command (as `<lane user>` unless marked root) | Stops | Does NOT stop |
|---|---|---|---|---|
| 1 | **Lane stop file** | `touch ~/.local/state/roxira-lane/STOP` | every `lane-run` start (queue steps, orch steps, smoke) with exit 4, before the budget check, the key read and any model call | an attempt already running; orch claiming issues (use #2) |
| 2 | **Orch KILL file** | `python3 scripts/infra/server_agents/orch.py stop` (same as `touch $ORCH_HOME/KILL`, default `$ROXIRA_AGENTS_HOME/orch/KILL`) | the next `tick`: nothing is claimed, run or published (checked before the run, before each claim, before pushing and opening the draft PR) | the model run that is already in progress (use #4) |
| 3 | **Tunnel unit** | `systemctl --user disable --now roxira-gateway-tunnel` | the only route to the key-pool gateway: every model call fails at connect. Nothing else on the box uses this tunnel | the box's other egress, GitHub access, the queue timer (it will just fail) |
| 4 | **Queue timer and pass** | `systemctl --user disable --now roxira-lane-taskq.timer` then `systemctl --user stop roxira-lane-taskq.service` | the 2x/hour `taskq run --once` pass and the running pass with its children (systemd kills the whole cgroup) | tasks stay `queued`/`running` in the db; use `taskq.py cancel` (below) so they are not retried |
| 5 | **Gateway key (local)** | `mv ~/.config/roxira-lane/gateway.env ~/.config/roxira-lane/gateway.env.off` | `lane-run` dies with "gateway env file missing" before any call; undo by moving it back | an attempt already holding the key in its environment |
| 6 | **Gateway key (server)** | owner on the server: delete or block the `box-lanes` virtual key in the gateway (`docs/infra/KEY_POOL.md`; whether `virtual_keys.py` deletes a key that was removed from `config/key_pool.yaml` is UNVERIFIED, so confirm with `/key/info` afterwards) | the key everywhere, including any process that already started. This is the only switch that also stops the paid fallback | nothing local; it needs the server owner and a PR |
| 7 | **Merge gate** | `touch ~/.local/state/roxira-merge-gate/KILL` and `systemctl --user disable --now roxira-merge-gate.timer` (and `roxira-check-main-push.timer` if installed; it is not on the box today) | polling squash-merges and the direct-push alert (they share the KILL file). On the live box the gate is currently `dry_run = true`, so it merges nothing either way | merges done by a person. A single PR is held with the label `do-not-merge` or `needs-human` (the gate honours both) |
| 8 | **Agent bridge** | `touch ~/.config/roxira-bridge/STOP` and `systemctl --user disable --now roxira-bridge.timer` | polling of the WAVE comments on the bridge issue and the `claude -p` runs it starts | lane-run, orch, taskq (they do not use the bridge) |
| 9 | **Builder egress (root)** | `sudo systemctl stop roxira-builder-proxy` | the builder user's only way out: its nft table allows loopback to the proxy only, so with the proxy down it has no network. The nft table stays loaded (fail closed) | the lane user's own network |
| 10 | **Builder lock off (root, loosens)** | `sudo systemctl stop roxira-builder-nft` | removes table `roxira_builder`. The builder runner refuses to start without that table, so no NEW builder run starts. **Do not use it to "cut" a running builder: it removes that builder's firewall.** Stop the proxy (#9) first | anything already running keeps running, now without the lock |
| 11 | **Box proxy off (root, big hammer)** | `sudo box-proxy off` | stops `xray`: the tunnel, `gh`, npm, apt, and every box connection that goes through the local proxy | it also **restarts docker** (CI containers die). It does not stop local-only work |
| 12 | **Lane budgets** | see "Budget zero is not a switch" | nothing reliable | n/a |

Order for "stop the lanes now, keep the box alive": #1, #2, #4, then #3. For "I think the key leaked": #5, #3, then #6.

## Details per switch

### 1. Lane stop file (new, `lane-run`)
- Path: `<state dir>/STOP` (the state dir is `STATE_DIR` in `lane-run.conf`, default `~/.local/state/roxira-lane`);
  override the path with `STOP_FILE=` in `lane-run.conf`.
- Every entry point goes through `lane-run`: queue steps (`taskq-runner.sh`), orch steps and `lane-run --smoke`. A
  stopped call writes one `"status": "stopped"` line to `logs/lane-run.jsonl` (not counted as an attempt) and exits 4.
- `lane-run --budget` still works while stopped.
- Resume: `rm ~/.local/state/roxira-lane/STOP`.
- Verify: `lane-run --lane L5 --public --task x --dry-run; echo $?` prints `stop file present` and `4`.

### 2. Orch KILL file
- `orch.py stop` creates it, `orch.py resume` removes it, `orch.py status` shows it. `orch.py tick` exits 3 and
  prints `KILL SWITCH ... present` without touching GitHub.
- Orch is not installed as a unit yet (no `roxira-orch.*` unit). When it is, also `systemctl --user disable --now roxira-orch.timer`.
- A tick that is mid-run finishes the current task (it cannot interrupt the model run); it then stops before the push.
  To end the run itself: #4 (the worker is a child of the same process tree) or `pkill -f 'opencode run'` as `<lane user>`.

### 3. Tunnel unit
- `Restart=always` only restarts after a crash, not after `systemctl stop`; `disable --now` also keeps it off after
  reboot and login. Resume: `systemctl --user enable --now roxira-gateway-tunnel`, then
  `curl -s http://127.0.0.1:4181/health/liveliness`.
- Verify: `systemctl --user is-active roxira-gateway-tunnel` prints `inactive`; the same curl gets no answer.

### 4. Queue timer and tasks
- `roxira-lane-taskq.timer` is installed but **disabled** by design (BOX_LANE_RUNNER.md step 10). The command is
  idempotent when it is already off.
- Queued or running tasks: `ROXIRA_AGENTS_HOME=~/.local/state/roxira-lane python3 scripts/infra/server_agents/taskq.py list --status queued`
  then `... taskq.py cancel <id>` (cancel also SIGTERMs a running task's process group).

### 5 and 6. Gateway key
- The key is one line `KEYPOOL_MASTER_KEY=` in `~/.config/roxira-lane/gateway.env` (mode 600). Never print or paste it.
- Server side the key has a **1 USD/day** paid cap and sees only `agent-free`, `agent-light-free`, `agent-strong-free`,
  `agent-free-paid`. Every one of those groups can fall back to the paid group, so only #6 (or the cap) stops paid spend.

### 7. Merge gate
- Today `dry_run = true` in its config. Going live is the owner's step at the private flip (see PRIVATE_FLIP_CHECKLIST.md).
- Resume: `rm ~/.local/state/roxira-merge-gate/KILL` and `systemctl --user enable --now roxira-merge-gate.timer`.
- Logs: `journalctl --user -u roxira-merge-gate -n 30`.

### 8. Agent bridge
- It runs `claude -p` with a consumer login, a different path from the lanes. It is **enabled** today. If the box must
  run no consumer-login agent at all, disable it.
- Resume: remove the STOP file, `systemctl --user enable --now roxira-bridge.timer`.

### 9, 10, 11. Root-side units
- Unit names (installed by `builder_egress/apply_root.sh`): `roxira-builder-proxy.service`, `roxira-builder-nft.service`
  (oneshot, `ExecStop` deletes table `inet roxira_builder`). The box-wide lock is `roxira-egress.service`; it is a
  security control, not a kill switch: **do not stop it**.
- Check state without root: `systemctl is-active roxira-builder-proxy roxira-builder-nft roxira-egress xray`.
- Resume: `sudo systemctl start roxira-builder-proxy roxira-builder-nft`; `sudo box-proxy on`.
- `box-proxy off` is the only way the box loses all outbound traffic at once; the owner's tools (status page, backups)
  that need the proxy stop reporting while it is off.

## Budget zero is not a switch

`scripts/infra/server_agents/lane_budget.py` treats `0` or a missing value as **no cap**, and a missing or unreadable
budget file as **no caps at all**. Therefore:
- setting a lane's `usd_per_day` or `attempts_per_day` to `0` removes the cap, it does not block the lane;
- `lane-run` now refuses to run when its budget file cannot be read (it used to run uncapped);
- the closest "brake" is `attempts_per_day: 1`, which only blocks after one attempt has been logged that UTC day.
Use the stop file (#1) to stop lanes; use caps only as a spending ceiling.

## After stopping: check nothing is still running

```
systemctl --user list-units 'roxira-*' --state=active
pgrep -u <lane user> -af 'opencode|run_task.sh|lane-run|taskq.py|orch.py' || echo "no lane process"
lane-run --budget --lane L5
```

## What this page does not cover
- GitHub-side revocation (the token behind `gh`): owner, in the GitHub account settings.
- Production switches (autodeploy, key pool on the server): `docs/ops/AUTODEPLOY.md`, `docs/infra/KEY_POOL.md`.
- Phone stack units: `docs/ops/LINUX_CI_BOX.md`.
