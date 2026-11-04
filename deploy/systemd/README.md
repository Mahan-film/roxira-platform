# systemd units (not installed automatically)

These units are shipped in the repo for review. **Nothing here is installed
on the production host by CI or by this PR.** Installing a systemd timer on
`91.107.248.99` needs the owner's explicit yes (see `AGENTS.md` / `CLAUDE.md`:
ask before restarting containers or changing files on the production host).

## `roxira-backup.service` + `roxira-backup.timer`

Nightly Postgres + Qdrant backup via `scripts/ops/backup.sh`. See
`docs/ops/RESILIENCE.md` for how this relates to the existing hourly cron
job (`scripts/auto_backup_daemon.sh`) — install only one of the two for the
same backup window.

Install (root, on the production host, after owner approval):

```bash
cp deploy/systemd/roxira-backup.service deploy/systemd/roxira-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now roxira-backup.timer
systemctl list-timers roxira-backup.timer   # confirm the next run
```

To remove:

```bash
systemctl disable --now roxira-backup.timer
rm /etc/systemd/system/roxira-backup.service /etc/systemd/system/roxira-backup.timer
systemctl daemon-reload
```

## `roxira-radar.*` and `roxira-radar-daily.*`

Weekly tech radar (Monday 05:30 Tehran) and a daily no-LLM release check (05:00) running
`scripts/ops/radar/radar.py`. Hard cap 0.05 USD per run. Proposals only. Print the owner install
commands with `scripts/ops/radar/install.sh` (it changes nothing). See `docs/radar/README.md`.

## `roxira-docker-prune.service` + `roxira-docker-prune.timer`

Weekly `docker builder prune -f --filter until=168h` and `docker image prune -f` (dangling
images only, never `-a`, so the `:prev` rollback images stay). Owner approval needed to install:

```bash
cp deploy/systemd/roxira-docker-prune.service deploy/systemd/roxira-docker-prune.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now roxira-docker-prune.timer
systemctl list-timers roxira-docker-prune.timer
```

## `roxira-digest.service` + `roxira-digest.timer`

The ONLY routine e-mail: one grouped digest at 08:00 and 20:00 Tehran (owner rule 2026-11-04).
Monitors, self-improvement jobs, radar and backup reports queue into `/var/lib/roxira-notify/queue.db`
(`scripts/ops/notify/notify.py`); urgent problems go to Telegram only. See `docs/ops/NOTIFY_DIGEST.md`.
These units are NOT installed by autodeploy (it only deploys code). Owner install, as root on srv1:

```bash
cd /opt/roxira_platform
install -m 644 deploy/systemd/roxira-digest.service deploy/systemd/roxira-digest.timer /etc/systemd/system/
install -m 644 deploy/systemd/roxira-backup-dr-report.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now roxira-digest.timer
systemctl restart roxira-backup-dr-report.timer
systemctl list-timers 'roxira-digest*'
```
