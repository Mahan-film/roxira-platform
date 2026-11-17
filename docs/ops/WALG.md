# WAL-G continuous archiving and point-in-time recovery (row T204)

**Status: prepared, NOT enabled.** Nothing here changes production until the hub runs the steps in section 4 after
owner approval (needs one `postgres_prod` restart). Goal: Postgres recovery point from 1 h (hourly `pg_dump | age` to R2,
`docs/ops/BACKUP_SCHEDULE_2026-10-30.md`) to about 1 minute, and restore to any chosen minute.

Scope: only `roxira_postgres_prod` (`enterprise_db`). `roxira_twenty_db` stays on the hourly dump. The hourly `pgcfg`
dumps keep running unchanged; WAL-G is an addition, not a replacement, until the first restore drill has passed and the owner decides.
This change adds only new files and does not edit the backup scripts or `DISASTER_RECOVERY.md` (open PR #883 edits those).

## 1. Design and choices

| Item | Choice | Why |
|---|---|---|
| WAL-G version | **v3.0.9** (2026-08-20, Apache-2.0), tag commit `3e493188db28335fb93a45bd680c6ff8fc3028c1`, source tarball SHA-256 `b06bc26c4865c07d0c269101910f63c7eedd03790b7c054a7da0980a7a9cc31d` | Latest release when written. The Dockerfile refuses a tarball with a different hash. |
| How it runs | Small custom image `docker/postgres-walg/Dockerfile`: **same** `postgres:17-alpine@sha256:18cfe3ef...` digest as `docker-compose.prod.yml` plus a `wal-g` built from the pinned source with libsodium | Production is Alpine (musl). The official release binaries are Ubuntu (glibc) builds and do not run on Alpine. Moving to a Debian postgres image would change text collation and silently break the existing indexes. A mounted glibc binary would need `gcompat` and is untested territory. Building the pinned source in a multi-stage Dockerfile leaves the Postgres layer byte-identical. |
| Encryption | **WAL-G libsodium** (`WALG_LIBSODIUM_KEY`, 64 hex chars) | WAL-G supports only libsodium, PGP and cloud KMS envelope encryption natively. It has **no age support**. Libsodium is one symmetric key in the env file (no gpg keyring to manage inside the container). Trade-off: the key lives on srv1, so a root compromise of srv1 exposes the backups; the DB itself is exposed in that case anyway. Keep an off-server copy of the key or the backups are unreadable. |
| Compression | `lz4` | Pure Go, cheap on 4 vCPU. |
| Config delivery | `docker-compose.walg.yml` overlay with `-c` flags, not a changed `postgresql.conf` in the data volume | Rollback is "start without the overlay"; the restored copies on the Mac never inherit archiving. |
| Archive command | `/usr/local/bin/walg-archive %p` (`docker/postgres-walg/walg-archive.sh`) | Timeout and disk guard, see below. |
| Settings | `wal_level=replica`, `archive_mode=on`, `archive_timeout=60`, `max_wal_size=1GB` | `archive_timeout=60` forces a segment switch at most once a minute when there was activity, so RPO is about 1 minute for a busy database. An idle database writes no WAL and needs no archive. |

### Disk guard (the disk is 78 % full)

Postgres keeps every segment it could not archive inside `pg_wal`. A stalled R2 upload therefore fills the data disk, and a
full data disk crashes the primary. `walg-archive`:

1. kills `wal-g wal-push` after `WALG_PUSH_TIMEOUT_S` (45 s); Postgres retries the same segment;
2. measures `pg_wal`; above half of `WALG_SPOOL_MAX_MB` (default 3072) it writes `SPOOL_WARN` (digest alert);
3. at or above `WALG_SPOOL_MAX_MB` it writes `SPOOL_OVER` and, with the default `WALG_SPOOL_ON_OVERFLOW=drop`, **drops the
   segment and records `CHAIN_BROKEN`** so the primary survives. Point-in-time recovery is then impossible across that gap until the next
   base backup (the nightly job, or `systemctl start roxira-walg-backup`, which clears the flag). The status job alerts on Telegram.

Why not simply "fail the archive": a failing `archive_command` keeps the segment, so `pg_wal` grows faster, which is the disk-full case.
`WALG_SPOOL_ON_OVERFLOW=fail` is available if the owner prefers an intact chain over disk safety. Normal `pg_wal` size is about 1 GB
(`max_wal_size`), so the default cap leaves about 2 GB (about 130 segments, about 2 h at one switch per minute) of outage tolerance.
Check `df -h /var/lib/docker` before enabling; if free space is under about 6 GB do not enable until the disk is cleaned.

## 2. Storage estimate (R2 free tier 10 GB, 1 M writes per month)

Current size is from `docs/ops/DISASTER_RECOVERY.md` (2026-10): Postgres **75 MB** (`roxira_postgres_prod`). It may be larger now; **not measured here**,
check `SELECT pg_size_pretty(pg_database_size('enterprise_db'))`.

- Base backups: about 75 MB raw, roughly 20-40 MB compressed and encrypted, times 7 retained = **about 0.3 GB**.
- WAL: a switched segment is 16 MB raw, but a mostly empty one compresses to a few KB to a few hundred KB. Worst case about 1440 x 0.3 MB = 0.4 GB per day, times 7-8 days = **up to about 3 GB**; a quiet system is far below that.
- Plus the existing `pgcfg` copies. Expect **under 4 GB total**, inside the 10 GB tier. Check the real number after a week: `wal-g backup-list` and the R2 dashboard.
- R2 writes: at most 1440 segment uploads + 1 base backup a day = about 45 k per month, far below 1 M.

If R2 usage nears 8 GB: lower `WALG_RETAIN_FULL` (days kept), do not raise `archive_timeout`.

## 3. Files (all new)

| File | Purpose |
|---|---|
| `docker/postgres-walg/Dockerfile`, `walg-archive.sh` | image and archive wrapper |
| `docker-compose.walg.yml` | overlay with the `-c` settings, env file and the flag directory mount |
| `deploy/backup/walg.env.example` | names only; real file `/etc/roxira/walg.env` (root, 0600) |
| `scripts/ops/walg/walg_nightly.sh`, `walg_status.sh`, `walg_lib.sh` | nightly `backup-push` + `delete retain FULL 7`, health check, helpers |
| `deploy/systemd/roxira-walg-backup.{service,timer}` | nightly 02:20 UTC |
| `deploy/systemd/roxira-walg-status.{service,timer}` | every 5 min |
| `scripts/ops/walg/restore_to_time.sh` | restore drill on the Mac |
| `scripts/ops/walg/test_walg.sh` | offline checks (image digest equals prod, dry runs, overflow guard) |

### Status and alerts

`walg_status.sh` writes the last result to `/var/lib/roxira-backup/walg.env` (same `key='value'` pattern as `r2.env` and `drill.env`):
`WALG_RESULT=OK|FAIL|CHAIN_BROKEN|NOT_CONFIGURED`, `WALG_CHECKED_AT`, `WALG_LAST_ARCHIVED_EPOCH`, `WALG_FAILED_COUNT`, `WALG_BASE_LAST_OK`,
`WALG_PROBLEMS`. The nightly job writes `walg_base.env`. Alerts go through `scripts/ops/notify/notify.py --urgent`, the same
path `server_backup.sh` uses (Telegram, 1 h cooldown per subject; also the digest). FAIL means: last archive attempt failed, newest archived
segment older than 30 min (`WALG_MAX_ARCHIVE_AGE_MIN`), spool over the cap, last good base backup older than 30 h, or a failed nightly job.
A very quiet database can exceed the 30-minute limit without a fault; raise the limit if that alerts falsely.

## 4. Enable (hub, after owner approval; one `postgres_prod` restart, about 10-30 s of DB downtime)

Run on srv1 (`ssh roxira-prod`), repo at `/opt/roxira_platform`, after this PR is merged and the repo is updated.

```bash
cd /opt/roxira_platform
df -h /var/lib/docker /var/lib/roxira-backup           # need > 6 GB free on the docker disk
# 1. R2 token + key (values typed by the hub, never pasted into chat or git)
install -m 600 -o root -g root deploy/backup/walg.env.example /etc/roxira/walg.env
$EDITOR /etc/roxira/walg.env                           # bucket, endpoint, token; key: openssl rand -hex 32
# 2. flag directory shared with the container (postgres uid 70 in the Alpine image)
install -d -o 70 -g 70 -m 750 /var/lib/roxira-backup/walg
# 3. build the image (no downtime) and check it
docker compose -f docker-compose.prod.yml -f docker-compose.walg.yml build postgres_prod
docker run --rm --entrypoint wal-g roxira-postgres-walg:17-walg3.0.9 --version
# 4. the restart (about 1 restart): recreate postgres_prod on the new image with archiving on
docker compose -f docker-compose.prod.yml -f docker-compose.walg.yml up -d postgres_prod
docker exec roxira_postgres_prod psql -U enterprise_admin -d enterprise_db -Atc "SHOW archive_mode; SHOW archive_timeout"
# 5. first base backup, check the archive, then the timers
docker exec -u postgres roxira_postgres_prod sh -c 'wal-g backup-push "$PGDATA"'
docker exec -u postgres roxira_postgres_prod wal-g backup-list
docker exec roxira_postgres_prod psql -U enterprise_admin -d enterprise_db -Atc "SELECT pg_switch_wal()"
sleep 20; bash scripts/ops/walg/walg_status.sh; cat /var/lib/roxira-backup/walg.env
install -m 644 deploy/systemd/roxira-walg-backup.* deploy/systemd/roxira-walg-status.* /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now roxira-walg-backup.timer roxira-walg-status.timer
```

`docker-compose.prod.yml` is not edited. `scripts/ops/deploy.sh` and `rollback.sh` add `-f docker-compose.walg.yml` automatically when
`/etc/roxira/walg.env` exists; any other manual `docker compose` call for `postgres_prod` must pass both `-f` files or the container is recreated **without** archiving.
Then run the restore drill (section 6) within the first day and do not retire the hourly `pgcfg` copies before it has passed.

## 5. Rollback

```bash
systemctl disable --now roxira-walg-backup.timer roxira-walg-status.timer
docker compose -f docker-compose.prod.yml up -d postgres_prod     # back on the old image, archive_mode default = off (one restart)
```

Without a rebuild-free alternative: `ALTER SYSTEM SET archive_mode = off` plus a restart is equivalent. R2 `walg/` objects stay (delete by hand if wanted).
`/etc/roxira/walg.env` and the flag directory can stay.

## 6. Restore drill (Mac) and real restore

```bash
docker build -t roxira-postgres-walg:17-walg3.0.9 docker/postgres-walg      # once, on the Mac
bash scripts/ops/walg/restore_to_time.sh --env-file ~/Secrets/roxira/walg.env --target-time '2026-11-17 09:30:00+00'
bash scripts/ops/walg/restore_to_time.sh --env-file ~/Secrets/roxira/walg.env --latest --port 55771
```

It fetches the newest base backup, replays WAL to the target (`recovery_target_action=promote`), waits until recovery has finished, runs a
verification query (default: user table count, must not be 0; override with `--verify-sql`), prints `walg restore drill passed` and exits 0,
or prints `walg restore drill FAILED` and exits 1. The container is removed unless `--keep` is given. Ports 55770-55799 only. The restored
cluster runs with `archive_mode=off` and an empty `archive_command`, so it cannot write to the production prefix. For drills use a read-only R2 token and the same
`WALG_LIBSODIUM_KEY`. A target later than the last archived WAL makes recovery stop with an error (reported with the container log tail).
T198's Mac drill can call the script and use its exit code.

Real disaster restore (new server): start an empty `postgres:17-alpine`-based container from the WAL-G image with the same env file, run the same
`backup-fetch` + `recovery.signal` + `restore_command` steps as `restore_to_time.sh` (read its `inner` block), then point the apps at it.

## 7. Monitoring

- `cat /var/lib/roxira-backup/walg.env` and `docker exec roxira_postgres_prod psql -U enterprise_admin -d enterprise_db -x -c "SELECT * FROM pg_stat_archiver"`.
- `docker exec -u postgres roxira_postgres_prod wal-g backup-list --detail` and `wal-g wal-verify integrity timeline`.
- `journalctl -u roxira-walg-backup -u roxira-walg-status -n 80`; `docker logs roxira_postgres_prod --tail 50 | grep walg-archive`.
- `du -sh` of `pg_wal`: `docker exec roxira_postgres_prod du -sm /var/lib/postgresql/data/pg_wal` (normal about 1 GB).

## 8. Not done / not checked

- The image has **not been built and no WAL-G command has run** (the authoring sandbox has no usable Docker). The Alpine/cgo/libsodium build, the build with the pinned `golang:1.25.11-alpine` digest (`GOTOOLCHAIN=local`, no toolchain download) and the R2 behaviour are untested: do step 3 and the drill first.
- The daily e-mail report (`email_offsite.py`, edited by open PR #883) does not read `walg.env` yet; Telegram alerts cover failures meanwhile.
- No Twenty CRM database coverage; no replica; Qdrant/Redis unchanged.
