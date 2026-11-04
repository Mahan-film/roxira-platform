# Notification digest (owner rule 2026-11-04: at most 2 e-mails a day)

Nothing mails the owner one event at a time any more. Every alert, recovery and report is
written to a queue (`/var/lib/roxira-notify/queue.db`, SQLite) by `scripts/ops/notify/notify.py`.
`roxira-digest.timer` runs `notify.py --digest` at **08:00 and 20:00 Tehran** and sends ONE e-mail
grouped by severity, plus a short Telegram version. An empty queue sends nothing.

## What the digest looks like
- `== URGENT ==` what was already sent to Telegram.
- `== ALERTS ==` checks still failing (once, with duration) and flapping checks collapsed to one line
  (`failed 3x, recovered 3x, total downtime 12 min`). "STILL FAILING" repeats are muted.
- `== REPORTS ==` three-line summaries with the report file path.

## Urgent = Telegram only, never e-mail (1 message per problem per hour)
site (`site:*`, `judge-health`) down more than 15 min in a row; backup FAILED or disk full in
`server_backup.sh`; autodeploy failed and rolled back (and Gate4); root disk at or above 90%
(`disk_guard.sh`). CLI: `notify.py --urgent KEY "text"`. Other messages: `notify.py --queue info|alert SOURCE KEY "text"`.

## Senders (all go through the queue now)
| Sender | Before | Now |
|---|---|---|
| `monitor/synthetic_check.py` (roxira-monitor-synthetic, every 5 min) | mail on each FAIL/RECOVERED, reminder every 2 h | queue; urgent after 15 min |
| `monitor/log_watch.py` (roxira-monitor-logs, every 5 min) | same | queue |
| `log_watch.py --daily` (07:00 Tehran) | 1 mail/day | digest report |
| `selfimprove/hourly.py` (hourly) | mail on change + "STILL FAILING" every 2 h | queue; repeats muted |
| `selfimprove/daily.py` (04:00 Tehran) | 1 mail/day | digest report + path |
| `radar/radar.py` (daily 05:00, weekly Mon) | mail when not quiet | digest report + path |
| `backup/email_offsite.py report` (daily) | 1 mail/day | digest report; failure also Telegram |
| `backup/server_backup.sh alert()` | mail, 6 h cooldown | Telegram if FAILED/DISK FULL, else digest |
| `backup/email_offsite.py offsite` (backup channel) | up to 10 mails/run to owner inbox | see below |
| `autodeploy.sh`, `disk_guard.sh` | Telegram on every deploy / disk alert | Telegram only on failure/disk, 1/h |

Kept as is: backend lead mail (`LEAD_NOTIFY_EMAIL`, one per real lead, business mail).

## Offsite backup parts
They are a backup channel. Set `BACKUP_OFFSITE_TO` to a different mailbox and they go there.
Without it they still go to the owner's inbox, but at most one offsite run per day
(second run the same day is skipped), and the report timer now runs at 07:30 Tehran, just before the digest.

## Install (units are not installed by autodeploy; owner runs as root on srv1)
```bash
cd /opt/roxira_platform
install -m 644 deploy/systemd/roxira-digest.service deploy/systemd/roxira-digest.timer /etc/systemd/system/
install -m 644 deploy/systemd/roxira-backup-dr-report.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now roxira-digest.timer
systemctl restart roxira-backup-dr-report.timer
python3 scripts/ops/notify/notify.py --digest --dry-run   # preview
```
The code itself (queue, monitors) is deployed by autodeploy. Until the digest timer is installed,
events queue up and nothing is mailed. Uses the same `BACKUP_SMTP_*`/`BACKUP_NOTIFY_TO` as before (never printed).
