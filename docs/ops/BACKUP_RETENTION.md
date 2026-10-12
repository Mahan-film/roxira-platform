# Backup retention (lean local window, offsite by e-mail and Mac)

**مقدمه (فارسی):** دیسک سرور با بکاپ ساعتی قدیمی (حدود ۱۱ گیگابایت در `/opt/roxira_backups`) پر می‌شد
چون هیچ‌وقت پاک نمی‌شد. حالا فقط سیستم جدید DR کار می‌کند و روی سرور یک پنجره‌ی کوچک نگه می‌دارد
(۶ نسخه‌ی ساعتی + آخرین نسخه‌ی هر یک از ۳ روز اخیر، حدود ۱ تا ۲ گیگابایت) برای بازگشت سریع. نسخه‌ی بیرونی
(offsite) با ایمیل (رمزشده با age، حدود ۳۰۰ کیلوبایت: دامپ‌های Postgres و تنظیمات) و کشیدن روزانه‌ی مک
انجام می‌شود. Qdrant حجمی است (۶۰ تا ۲۵۰ مگابایت) و در ایمیل جا نمی‌شود، پس کپی بیرونی آن فقط روی مک است.
اگر فضای آزاد زیر ۱۵ گیگابایت برود، فقط آخرین نسخه می‌ماند و ایمیل هشدار می‌آید. این یک مصالحه‌ی آگاهانه
است: «هیچ بکاپی روی سرور» رایگان‌تر است ولی بازگشت سریع (دقیقه‌ای) را از بین می‌برد.

## What is kept where

| Place | What | Size | Pruned by |
|---|---|---|---|
| Server `/opt/roxira_backups/dr/sets/<UTC stamp>` | hourly consistent set: `pg_dump -Fc` of every DB in `roxira_postgres_prod` and `roxira_twenty_db` + globals, Qdrant per-collection snapshots, Redis RDB, certbot volume, meta, config tarball | about 165 MB per set; window of at most 8 sets is roughly 1.3 GB (was 493 MB for 3 sets) | `server_backup.sh run`, every hour, via `scripts/ops/backup/retention.py` |
| Server legacy `/opt/roxira_backups/postgres_*.sql.gz`, `qdrant_*.tar.gz` | old hourly job, **retired**. 24 pg dumps + 2 Qdrant tarballs stay as a safety net (about 100 MB) | was about 11 GB | one-time `prune_legacy_backups.sh` |
| E-mail to the owner | daily report; age-encrypted pg dumps + configs (`BACKUP_EMAIL_OFFSITE`), see `docs/ops/BACKUP_EMAIL.md` | about 300 KB per day | Gmail |
| Owner's Mac `~/Backups/roxira-dr/` | daily pull (`install_mac_pull.sh`): restic repo, or rsync of `sets/latest` | grows on the Mac, Qdrant included | `mac_pull.sh` |

### Retention rule (configurable in `/etc/roxira/backup.env`)

| Variable | Default | Meaning |
|---|---|---|
| `BACKUP_KEEP_HOURLY` | 6 | newest N local sets (old name `BACKUP_KEEP_LOCAL_SETS` still works) |
| `BACKUP_KEEP_DAILY` | 3 | additionally the newest set of each of the last N UTC days that have a set |
| `BACKUP_MIN_FREE_GB` | 15 | when free space on the backup filesystem is below this, keep only the newest set (before staging and again at rotation) and send an alert e-mail (cooldown `BACKUP_ALERT_COOLDOWN_MIN`, 6 h) |

The existing percent guards stay: warn at `BACKUP_DISK_WARN_PCT` (85), abort staging at `BACKUP_DISK_ABORT_PCT` (95).
The selection logic is pure Python (`retention.py`, tests in `test_retention.py`); the shell only deletes validated
`YYYYMMDDTHHMMSSZ` directories one at a time and never the target of `sets/latest`.

### Trade-off (explicit)

- Owner wish: nothing on the server, use e-mail (free). E-mail cannot carry Qdrant (60-250 MB, Gmail limit 25 MB
  per message, cap 150 MB/day) and cannot give a fast rollback.
- Chosen: a small local window for rollback (minutes, up to 6 hours granular, then 3 daily points), e-mail + Mac for
  offsite. Cost: about 1.3 GB of disk. If the server disk dies, Postgres and configs come from e-mail
  (at most one day old with `BACKUP_EMAIL_OFFSITE=daily`) and Qdrant from the Mac pull; without the Mac copy Qdrant
  must be rebuilt from the legal corpus JSONL.
- To go leaner: `BACKUP_KEEP_HOURLY=2`, `BACKUP_KEEP_DAILY=1` (about 0.5 GB). Setting both to 1/0 equals "latest only".

## Retiring the legacy hourly job

Source: root's crontab on 5.75.200.67, line `0 * * * * /opt/roxira_platform/scripts/auto_backup_daemon.sh >> /var/log/roxira_backup.log 2>&1`
(documented in `docs/infra/INFRA_MAP_2026-10-09.md`; it is not a systemd timer, and the repo's `roxira-backup.timer`
is not installed). Its own 7-day `find -mtime +7` prune apparently did not hold the 190 files, so do not rely on it.
It covered only `enterprise_db` plus a live tar of the Qdrant directory; the DR system covers the same data better
(`pg_dump -Fc` of both Postgres containers, consistent Qdrant snapshots, Redis, configs).

`scripts/auto_backup_daemon.sh` now exits immediately while `/etc/roxira/legacy_backup.disabled` exists. Reversible:
delete the file. The cron line can additionally be commented out (commands below).
The old Mac agent (`net.roxira.backup-pull`, `pull_backups_to_mac.sh`) takes the newest legacy file and will silently
keep copying a stale one, so unload it once `mac_pull.sh` works.

## Restore paths

1. Quick rollback on the server (minutes): pick a set in `/opt/roxira_backups/dr/sets/` (`latest` is a symlink).
   `pg/<container>/*.dump` restore with `pg_restore --clean --if-exists -d <db>`; Qdrant: upload
   `qdrant/<collection>/*.snapshot` (`restore.sh` shows the exact calls). Check first with `scripts/ops/backup/restore.sh --repo local --scratch /var/tmp/dr-test` if a restic repo exists.
2. From the Mac: `restic -r ~/Backups/roxira-dr/restic --password-file ~/Secrets/roxira/restic-dr.pass restore latest --target <dir>`
   (see `docs/ops/DISASTER_RECOVERY.md` section 7).
3. From e-mail (Postgres + configs only): save all attachments of one mail series in a folder, then
   `scripts/ops/backup/restore_from_email.sh --dir <folder> --key ~/Secrets/roxira/backup-age.key --out ./restored`.
4. Full new server: `scripts/infra/bootstrap_new_server.sh --restore` (bootstrap + `restore.sh --full`) (DISASTER_RECOVERY.md).

## Weekly Docker cleanup

`deploy/systemd/roxira-docker-prune.{service,timer}` (Sunday 05:15 UTC): `docker builder prune -f --filter until=168h`
and `docker image prune -f`. Never `-a`: tagged images, including the `:prev` rollback images, stay.

## One-time cleanup of legacy files

`scripts/ops/backup/prune_legacy_backups.sh` (dry-run by default). Strict patterns `postgres_YYYYMMDD_HHMMSS.sql.gz` and
`qdrant_YYYYMMDD_HHMMSS.tar.gz` directly inside `/opt/roxira_backups`, keeps the newest 24 / 2, never enters `dr/`, uses
`rm -f --` per file (no `rm -rf`, no globs deeper than the directory). `--apply` needs the file count typed on
`/dev/tty` and refuses to run unless the DR status file says `LAST_RESULT='OK'` (`--skip-dr-check` overrides).

## Owner commands (in order, on the server as root)

```bash
cd /opt/roxira_platform && git pull --ff-only
# 0. confirm the DR system is healthy
grep LAST_RESULT /var/lib/roxira-backup/status.env && ls /opt/roxira_backups/dr/sets
# 1. disable the legacy job (reversible)
install -d -m 700 /etc/roxira && touch /etc/roxira/legacy_backup.disabled
crontab -l > /root/crontab.before-retention && crontab -l | sed 's|^\(0 \* \* \* \* /opt/roxira_platform/scripts/auto_backup_daemon.sh\)|#\1|' | crontab -
# 2. cleanup dry run (read-only)
scripts/ops/backup/prune_legacy_backups.sh --dry-run
# 3. cleanup apply (type the printed count)
scripts/ops/backup/prune_legacy_backups.sh --apply
# 4. weekly docker cleanup timer
cp deploy/systemd/roxira-docker-prune.service deploy/systemd/roxira-docker-prune.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now roxira-docker-prune.timer
# 5. retention env (append once, then check)
cat >> /etc/roxira/backup.env <<'ENV'
BACKUP_KEEP_HOURLY=6
BACKUP_KEEP_DAILY=3
BACKUP_MIN_FREE_GB=15
ENV
scripts/ops/backup/server_backup.sh --dry-run run
```

On the Mac, once the new pull works: `launchctl bootout gui/$(id -u)/net.roxira.backup-pull`.
