# Backup schedule and automatic cleanup (2026-10-30)

Implements sections 2 and 3 of `docs/strategy/MASTER_STRATEGY_2026-10-30.md`. Goal: srv1 does little backup work, the
hourly recovery point lives off the server, and the disk cleans itself.

## What runs when (UTC)

| Timer | Before | After | What it does |
|---|---|---|---|
| `roxira-backup-dr-run` | hourly :07 | **daily 01:07** | Full local set (Postgres, Qdrant snapshots, Redis, meta, configs). **2 sets kept** (was 6 hourly + 3 daily). |
| `roxira-backup-dr-pgcfg` | n/a | **hourly :37** | Fresh `pg_dump -Fc` + config tarball, `age`-encrypted to `BACKUP_AGE_RECIPIENT`, uploaded to R2 (`pgcfg/hourly/`). Keeps 7 days hourly; the 03:xx copy is also written to `pgcfg/daily/` and kept 30 days. |
| `roxira-telegram-offsite` | daily 04:15 | **every 6 h** (04, 10, 16, 22 :15) | Encrypted fresh Postgres dump to Telegram (unchanged script). |
| `roxira-backup-dr-report` | 06:30 | 06:30 | Daily e-mail report. `BACKUP_EMAIL_OFFSITE=daily` mails the encrypted payload, inside `email_caps`. |
| `roxira-backup-dr-drill` | n/a | **weekly Sun 05:10** | Restore drill, see below. |
| `roxira-backup-dr-check` | Sun 04:30 | Sun 04:30 | `restic check` (only meaningful when a restic repository exists). |
| `roxira-neon-offsite` / qdrant replica | 02:41 / 03:10 | unchanged | |
| `roxira-cleanup` | n/a | **every 2 days 05:40** | `scripts/ops/cleanup_2d.sh --apply`. |

Recovery point for Postgres: 1 hour (R2), 6 hours (Telegram), 1 day (e-mail, local set).

## Report fixes (`email_offsite.py`)

- The report now shows the **age of the newest local set** (and of the newest R2 copy and the last restore drill) with the
  limit next to it. If a set is older than `BACKUP_MAX_SET_AGE_H` (default 30 h), the R2 copy older than
  `BACKUP_MAX_R2_AGE_H` (3 h), or the drill older than `BACKUP_MAX_DRILL_AGE_H` (192 h), the status becomes **STALE**, the
  subject says `ATTENTION STALE`, and a "Stale or failed copies" section lists each reason. The 2026-10-30 e-mail, built from the
  2026-10-22 set, would have said the set is about 8 days old (limit 30 h) and failed.
- `restic_check` is `not applicable` in `local-only` mode (no restic repository), not `never`.
- The e-mail payload and the Telegram dump are built from a **fresh dump taken for that mail**, not from `sets/latest`.
  The offsite manifest carries `built_at` and the report prints it.

## Restore drill

Two forms, one script (`scripts/ops/backup/restore_drill.sh`):

1. **Weekly on srv1** (`server_backup.sh drill`): takes a fresh payload, encrypts it to a throwaway `age` key, decrypts it,
   restores every Postgres dump into a scratch `postgres:18-alpine` container (tmpfs, no published port, removed afterwards),
   runs row-count smoke queries and checks the config tarball reads. It writes `DRILL_RESULT=OK|FAIL` to
   `/var/lib/roxira-backup/drill.env`, alerts on FAIL, and the daily report shows it. This proves the dump, `age` and restore
   chain works. It does **not** prove the real private key opens the R2 copies, because that key never reaches srv1.
2. **On the Mac, with the real key** (run it monthly, or after any key change):
   ```bash
   bash scripts/ops/backup/restore_drill.sh r2 --identity <path to the private age key>
   ```
   It downloads the newest `pgcfg/hourly/` object (R2 values from the environment or `~/Secrets/roxira/roxira.env`
   names `BACKUP_R2_*`), decrypts it, restores into a scratch container and prints `restore drill passed` or `restore drill FAILED`
   (exit 0 / 1). Needs docker and `age` on the Mac.

## Automatic cleanup (`cleanup_2d.sh`)

Every 2 days: build cache older than 48 h, dangling images, `rxtest-*` images older than 2 days, journal above 200 MB,
finished agent worktrees older than 3 days (the `disk_guard.sh` rules: taskq done/failed/cancelled, clean tree).
Never touched: volumes, `data/`, `~/Backups`, `/opt/roxira_backups`, images tagged `:prev`, images used by any container,
running containers. No `docker system prune`, no `-a`, no `rmi -f`, no `rm -rf` in the script; `test_cleanup_2d.sh` fails if
one appears. Default mode is `--dry-run`; the timer runs `--apply`. Log: `/root/deploy-state/cleanup.log`.

## Install (owner, one command, on srv1 after this PR is merged and the repo on srv1 is updated)

```bash
ssh roxira-prod 'sudo bash /opt/roxira_platform/scripts/ops/backup/install_schedule.sh --apply'
```

It saves the current unit files to `/var/lib/roxira-backup/unit-backup/<time>/`, installs the units, enables the five
timers and prints a cleanup dry run. Run it without `--apply` first to see the plan (changes nothing).

Prerequisites it warns about: `age` and `age-keygen` installed on srv1; `BACKUP_AGE_RECIPIENT` and the R2 settings in
`/etc/roxira/backup.env`: `BACKUP_R2_ENDPOINT`, `BACKUP_R2_BUCKET`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`
(optional `BACKUP_R2_PREFIX`, default `pgcfg`). The existing `BACKUP_S3_*` names are accepted as a fallback, but they also
switch `run` to restic mode, so prefer the `BACKUP_R2_*` names. Until they exist, `pgcfg` records `NOT_CONFIGURED` and
the daily report says STALE.

## Rollback (one command)

```bash
ssh roxira-prod 'sudo bash /opt/roxira_platform/scripts/ops/backup/install_schedule.sh --rollback'
```

Restores the saved unit files (run timer hourly, Telegram daily), disables and removes the pgcfg, drill and cleanup units.
R2 objects stay (delete by hand if wanted). Local sets: the next run keeps 2 until `BACKUP_KEEP_HOURLY` / `BACKUP_KEEP_DAILY`
are set in `/etc/roxira/backup.env`.

## Expected load change on srv1 (4 vCPU, 7.5 GB RAM, swap in use)

Estimates from the code, not measurements; compare `journalctl -u roxira-backup-dr-run` durations before and after.

- Full runs (every database, all Qdrant snapshots, Redis, hardlinked set): **24 per day to 1 per day**. This is the heavy
  part, so CPU, IO and Qdrant snapshot churn from backups drop by about 95 %.
- New small runs: 24 per day of `pg_dump` + config tar + `age` + one upload. Niced 15, IO class idle, a few seconds to a
  couple of minutes depending on database size, memory small (streams, no Python buffering of the file).
- Telegram: 1 to 4 dumps per day. E-mail: still 1 per day (now its own fresh dump, one `pg_dump` per mail).
- Weekly drill: one scratch Postgres on tmpfs, a few minutes, a few hundred MB of RAM for as long as it runs (it stays out
  of the way: niced, Sunday 05:10).
- Disk: 2 local sets instead of up to 9 (hardlinked, so the saving is the changed data between sets). Cleanup every 2 days
  removes build cache, dangling and `rxtest-*` images and journal growth. Check with
  `du -sh /opt/roxira_backups/dr/sets; df -h /` before and after.

## Not done here

- Telegram still sends Postgres only (no config tarball); the e-mail and R2 payloads include configs.
- R2 upload is a single PUT per object (fine up to the database sizes seen so far; switch to multipart if a payload
  nears 5 GB).
- `systemd` calendar expressions (`04/6:15`, `*-*-01/2`) could not be checked with `systemd-analyze` on the Mac; the
  install prints `systemctl list-timers` for the owner to confirm the next run times.
