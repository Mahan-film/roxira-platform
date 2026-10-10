# Production monitoring

Goal: chat failures are noticed within minutes by e-mail. Code: `scripts/ops/monitor/`.
No secrets in the repo; e-mail reuses `BACKUP_SMTP_USER`, `BACKUP_SMTP_PASS`, `BACKUP_NOTIFY_TO`
(same names as `scripts/ops/backup/notify_email.py`, PR #526).

## What is checked

| Check | Script | Cadence | Fails when |
|---|---|---|---|
| `site:<domain>` for ghazihoushmand.ir, roxira.ir, roxira.net | synthetic_check | 5 min | not 200 or >= 5 s (one retry) |
| `judge-health` (`/api/v1/apps/judge/health`, fallback `/health`) | synthetic_check | 5 min | neither returns 200 |
| `chat` real round-trip with `request_id` `synthetic-*` | synthetic_check | 15 min (`MONITOR_CHAT_INTERVAL_MIN`) | not 200, empty `reply`, >= 45 s, or reply lacks "۲۰"/"20"/"بیست" (one retry) |
| `tls:<domain>` certificate | synthetic_check | 5 min | < 21 days left (`MONITOR_CERT_WARN_DAYS`) |
| `disk:/` (server only, `MONITOR_CHECK_DISK=1`) | synthetic_check | 5 min | > 85 % (`MONITOR_DISK_WARN_PCT`) |
| `logs:api-5xx` (app and nginx logs) | log_watch | 5 min, 10 min window | > 3 5xx on `/api/` (`MONITOR_5XX_MAX`) |
| `logs:client-errors` (`[CLIENT-ERROR]`) | log_watch | same | > 10 (`MONITOR_CLIENT_ERR_MAX`) |
| `logs:chat-p95` (`[CHAT-TIMING] total_ms=`) | log_watch | same | p95 > 40 s (`MONITOR_P95_MAX_S`) |
| `logs:collect` | log_watch | same | `docker logs` unreadable |

Alerts: e-mail only on change (ok to fail, fail to ok) plus a reminder every 2 h while failing.
Daily summary at 07:00 Asia/Tehran: counts, chat p50/p95, top errors. Nothing includes phone
numbers, tokens, IPs or message text (see `scrub()` in `monitor_common.py`; client errors are
reduced to their first two words). The chat check spends one cheap LLM call per 15 min.

State: `/var/lib/roxira-monitor/state.json` and `log_state.json`.

## Install on the server (hub, after PR merge and owner OK)

```bash
sudo mkdir -p /etc/roxira
sudo cp /opt/roxira_platform/deploy/monitor/monitor.env.example /etc/roxira/monitor.env
sudo chmod 600 /etc/roxira/monitor.env
sudoedit /etc/roxira/monitor.env          # fill BACKUP_SMTP_USER / BACKUP_SMTP_PASS / BACKUP_NOTIFY_TO
sudo cp /opt/roxira_platform/deploy/systemd/roxira-monitor-*.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now roxira-monitor-synthetic.timer roxira-monitor-logs.timer roxira-monitor-daily.timer
systemctl list-timers 'roxira-monitor-*'
```

## Test an alert

```bash
set -a; . /etc/roxira/monitor.env; set +a
# 1. dry run (prints the e-mail, writes no state)
python3 /opt/roxira_platform/scripts/ops/monitor/synthetic_check.py --once --dry-run --force-chat
# 2. real e-mail: point at a dead domain with a throw-away state file
MONITOR_DOMAINS=nonexistent.invalid python3 /opt/roxira_platform/scripts/ops/monitor/synthetic_check.py \
  --once --state /tmp/monitor-test.json      # FAIL mail; rerun with real domains + same --state for RECOVERED
python3 /opt/roxira_platform/scripts/ops/monitor/log_watch.py --dry-run --minutes 60
python3 /opt/roxira_platform/scripts/ops/monitor/log_watch.py --daily --dry-run
```

## Silence

- Short: `sudo touch /var/lib/roxira-monitor/silence` mutes e-mail for 24 h
  (`MONITOR_SILENCE_MAX_HOURS`); `sudo rm` it to resume. Checks and state keep running.
- Long: set `MONITOR_SILENCE=1` in `/etc/roxira/monitor.env`.
- Stop entirely: `sudo systemctl disable --now roxira-monitor-{synthetic,logs,daily}.timer`.

## Outside the server (owner choice)

A dead server cannot e-mail about itself, so also run a check from elsewhere.

1. Owner's Mac via launchd every 10 min:
   ```bash
   mkdir -p ~/.roxira-monitor
   sed -e "s#__REPO__#$HOME/Developer/roxira-platform#" -e "s#__HOME__#$HOME#" \
     deploy/launchd/ir.roxira.monitor.plist.template > ~/Library/LaunchAgents/ir.roxira.monitor.plist
   # edit the plist: replace the three __SET_ME__ values (it stays on your Mac, never commit it)
   launchctl load ~/Library/LaunchAgents/ir.roxira.monitor.plist
   ```
   It only runs while the Mac is awake. Unload: `launchctl unload ~/Library/LaunchAgents/ir.roxira.monitor.plist`.
2. Free uptime services hitting `https://ghazihoushmand.ir/health` (keyword/200 check), e-mail on down:
   UptimeRobot free tier (5 min), Better Stack free tier (3 min). Both probe from abroad; none
   measures reachability from inside Iran, so pair with option 1 if Iranian users matter.
