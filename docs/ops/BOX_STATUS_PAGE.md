# Box status page and failure alerts (work package J)

Pack: `scripts/ops/ci_box/status_page/`. Tests: `src/ops/test_box_status.py` (offline). Stdlib Python only, no new service
framework, no JavaScript, no CDN. Reused: `scripts/ops/monitor/monitor_common.py` (the repo alert-on-change state machine
`evaluate`), `scripts/ops/notify/notify.py` (Telegram `send`, with its scrubber) and the lane caps file
`scripts/ops/ci_box/lane_runner/lane_budgets.box.json`. Nothing here writes to the digest queue or sends e-mail
(owner rule: max 2 e-mails a day, urgent goes to Telegram).

## What the page shows
`box_status.py collect` (user timer, every 5 min, minutes 1,6,11..) writes `index.html` and `status.json` atomically into
`~/.local/share/roxira-status/www`. A user unit (`roxira-status-web.service`, `python3 -m http.server --directory www`) serves only that
directory, on loopback by default (`STATUS_BIND` in `~/.config/roxira-status/status.env` for a LAN address; never a public one).

| Panel | Source (all read-only) |
|---|---|
| systemd user units and timers (tunnel, orch, taskq, bridge, merge gate, mirror, export, direct-push check, this pack) | `systemctl --user show` on a fixed list; not installed or never started = neutral, not failed |
| orch | `orch.db` opened `mode=ro`, the KILL file, the last tick printed by the orch unit in the user journal ("would claim" lines). `orch.py` is never run. Shows "not installed" until an orch state dir exists |
| cost per lane and per day vs caps | `lane-run.jsonl` and `orch_cost.jsonl` (same rules as `lane-run --budget`: UTC day, `cost_usd` string, skipped rows are not attempts); where both logs hold one run the larger figure wins. The key cap per day comes from `STATUS_DAILY_CAP_USD` (default 1.0) |
| disk (root, data disk), RAM, load | `statvfs`, `/proc` |
| CI runners | `gh api repos/<repo>/actions/runners` (through the box proxy); the old `actions-runner` service comes from `sudo -n box-status` (a unit of another user); if that fails it shows "unknown", never "inactive" |
| tunnel | `GET /health/liveliness` on the loopback tunnel port, proxy bypassed |
| phone stack | `docker ps -a` names and health only |
| backups | `/var/lib/roxira/last-backup` (restic, written by the reliability pack), `mirror.last`, `export.last` |

## Alerts (Telegram only, on failure transitions)
`box_alert.py` (user timer, minutes 3,8,13.., off the collector) collects a fresh snapshot and sends one grouped message per run at most:
tunnel down, disk at or above 85 percent, a watched unit in `failed`, a runner offline for more than 10 min, an orch circuit breaker open,
a lane or the total gateway spend at or above 80 percent of its cap. Rules: first sight of a failure or a pass-to-fail change only; no
recovery and no reminder messages; one message per incident; 3 h cooldown per check against flapping; unknown sources neither open nor
close an incident; an undelivered message is retried while the check still fails.
Credentials: `~/.config/roxira-status/telegram.env`, mode 600, keys `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (or the `NOTIFY_*` names),
outside the repo, never printed. Missing, loose-mode or empty file: a logged warning and exit 0, nothing collected or sent.

## Owner steps
1. Read: `bash scripts/ops/ci_box/status_page/install_user.sh` (dry-run). Install: `... --apply` (lane user, no sudo).
2. Once, admin: `sudo loginctl enable-linger <lane user>` (shared with the lane pack).
3. Telegram: `cp ~/.config/roxira-status/telegram.env.example ~/.config/roxira-status/telegram.env; chmod 600 ...; edit` (enter values in your own terminal),
   then `python3 ~/.local/share/roxira-status/bin/box_alert.py --send-test`.
4. Open `http://127.0.0.1:8088/` on the box.
Undo: the installer prints it (disable the three units, delete `roxira-status-*` units and the three `roxira-status` directories).

## Not verified
Telegram delivery through the box proxy, a real alert, the journal read for the orch tick on a live orch, the `last-backup` stamp format
(taken from the reliability script, no stamp exists yet), a LAN bind, and the real gateway-side spend (the box only sees its own logs).

The phone panel and its alerts (SIP registration, containers, agent crash loop, LiveKit, firewall drops, log growth) are described in docs/ops/PHONE_MONITORING.md.
