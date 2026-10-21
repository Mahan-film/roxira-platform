# Free off-site backups: Neon (databases) and Codeberg (code)

Two extra, free copies on top of the existing DR system (`server_backup.sh`, `roxira-backup-dr-*`
timers, restic to the Storage Box, age-encrypted e-mail bundle; see `DISASTER_RECOVERY.md` and
`BACKUP_EMAIL.md`). They reuse its pieces: the age recipient `BACKUP_AGE_RECIPIENT` from
`/etc/roxira/backup.env` and the owner bot `scripts/ops/notify/notify.py`.

| Copy | What | When | Where |
|---|---|---|---|
| Neon | `enterprise_db`, `umami` (restored, queryable) + local age-encrypted dumps | daily 02:40 UTC | Neon Frankfurt, databases `bk_enterprise_db`, `bk_umami` |
| Codeberg | full git history (branches + tags) | hourly | `https://codeberg.org/mahanofficial/roxira-platform` (private) |

Neon is a **backup copy, not the live database**. Nothing in production reads from it. Twenty's
database (`roxira_twenty_db`) is not in the Neon set by default (the DR system already covers it).

## 1. Neon database copy

`scripts/ops/backup/neon_offsite.sh` (units `roxira-neon-offsite.service|timer`):

1. `pg_dump -Fc` inside the Postgres container (`docker exec`, no host port).
2. `pg_restore --clean --if-exists --no-owner --no-acl` into Neon database `bk_<source db>` (created on
   first run), from a throwaway `postgres:17-alpine` container on the host network. The connection
   string reaches the container as an environment variable name (`-e NEON_TARGET_URL`), never in argv.
3. Verify: exact `count(*)` of the 10 biggest tables on both sides. The source is live, so a drift of
   `max(10 rows, 2 %)` is tolerated (`NEON_COUNT_TOLERANCE_ABS/PCT`); a missing table or an empty target
   table is always a failure.
4. Keep the dump locally in `/opt/roxira_backups/neon/<db>/`, `age`-encrypted to `BACKUP_AGE_RECIPIENT`,
   newest 7 per database. The plaintext dump only exists in a 0700 work dir and is deleted at exit. If
   age or the recipient is missing, no local copy is kept (a warning is logged).
5. Any failure or mismatch: exit 1 and an owner-bot message. Success message: at most once a week.

Every log line passes through `offsite_tools.py redact` (URL userinfo, `password=`, tokens, and the exact
values of `NEON_BACKUP_URL` / `CODEBERG_TOKEN` are masked), and the URL is never printed.

### Free-tier limits (check the Neon console for the current numbers)

- Storage 0.5 GB per project across all databases. Today about 32 MB (enterprise_db 22 MB, umami about
  10 MB), so ample room; the restored copy is roughly the size of the live data. Watch it as data grows
  (the weekly note does not report size; check the Neon console, or `SELECT pg_database_size(...)`).
- Compute: a limited number of compute hours per month, and the endpoint auto-suspends when idle. A daily
  restore of a few seconds to minutes of activity is far below the cap. First connection after idle takes
  about a second extra (`PGCONNECT_TIMEOUT=20` covers it).
- Free projects have a short point-in-time-restore window and no SLA. That is fine for a backup copy.
- If the project runs out of storage, `pg_restore` fails and the owner is notified.
- Use the DIRECT connection string (host without `-pooler`). The pooler (pgbouncer, transaction mode)
  breaks `pg_restore --clean`; the script refuses a pooler URL.

### Owner steps (one time)

1. Neon console: create (or reuse) a project in Frankfurt. Copy the **direct** connection string
   (turn the "Pooled connection" toggle OFF). The role must be allowed to `CREATE DATABASE` (the default
   owner role is).
2. From your Mac: `scripts/ops/set_server_env.sh NEON_BACKUP_URL` (hidden input; paste the string).
   Optional: `scripts/ops/set_server_env.sh NEON_BACKUP_DBS` with e.g. `enterprise_db umami`.
3. On the server (after the PR is deployed): `sudo bash /opt/roxira_platform/scripts/ops/backup/install_offsite.sh`
   (dry-run), then `... --apply`.
4. Run it once: `sudo systemctl start roxira-neon-offsite.service`, then
   `journalctl -u roxira-neon-offsite -n 60 --no-pager`. Expect `verified N tables` per database.
5. Confirm `BACKUP_AGE_RECIPIENT` is set in `/etc/roxira/backup.env` (it already is if the e-mail bundle works).

## 2. Codeberg code mirror

`scripts/ops/backup/codeberg_mirror.sh` (units `roxira-codeberg-mirror.service|timer`, hourly):

- Keeps a bare repo in `/var/lib/roxira-mirror/roxira-platform.git`, fetched from the same remote URL
  as the deployed checkout's `origin` (`git -C /opt/roxira_platform remote get-url origin`, so it uses the
  server's existing GitHub access, the same one auto-deploy uses). Override with `MIRROR_SOURCE_URL`.
- Fetches only `refs/heads/*` and `refs/tags/*`, so GitHub-only `refs/pull/*` (and other hidden refs)
  never enter the mirror, and Codeberg would reject them anyway. It then pushes the same two refspecs with
  `--prune` (equivalent to `git push --mirror` minus the excluded refs; deleted branches disappear too).
- The token is supplied through `GIT_ASKPASS=codeberg_askpass.sh`, which reads `CODEBERG_TOKEN` from the
  environment and answers only prompts that mention `codeberg.org`. It is not in argv, in a URL, in git
  config, or in the log. Failures notify the owner at most every 6 hours.

### Owner steps (one time)

1. Codeberg (account `mahanofficial`): create an **empty private** repository named `roxira-platform`
   (no README, no licence, no .gitignore).
2. Codeberg: Settings, Applications, Generate token with scope `write:repository` (nothing else).
3. `scripts/ops/set_server_env.sh CODEBERG_TOKEN` (hidden input).
4. Server: `install_offsite.sh --apply` (same installer as above), then
   `sudo systemctl start roxira-codeberg-mirror.service` and check the log; the repository page on
   Codeberg should show the history.

## 3. Restore drill

Do it after the first successful run and then about monthly. It never touches production or Neon data.

```bash
# on the server or any machine with docker; NEON_BACKUP_URL in the environment (never typed on a command line)
scripts/ops/backup/restore_drill.sh --dry-run neon      # print the plan
scripts/ops/backup/restore_drill.sh neon                # all DBs; or: restore_drill.sh neon umami
# from a local encrypted dump instead (private age key on the Mac):
scripts/ops/backup/restore_drill.sh file /path/umami_20261021T024000Z.dump.age umami --identity ~/path/backup-age.key
```

What it does: starts a scratch `postgres:17-alpine` container (random password, tmpfs, no published port),
streams `pg_dump -Fc` of `bk_<db>` from Neon (or decrypts the local file) into `pg_restore`, then runs a
smoke query: `count(*)` of the 10 biggest tables, requiring the largest to have at least `DRILL_MIN_ROWS`
(default 1) rows. It prints `DRILL OK` per database and removes the scratch container on exit. Exit code is
non-zero on any failure. Extensions missing from the plain image only produce pg_restore warnings; the
smoke query is what decides.

To restore for real (disaster): use the drill's `pg_dump` pipe but target a new production database, or
follow `DISASTER_RECOVERY.md` (primary path: restic set). Neon is the last-resort copy.

## Tests

Offline, no docker/network/real secrets: `cd scripts/ops/backup && python3 -m unittest test_offsite -v`
(secret redaction in logs, URL/database handling, row-count comparison, argv builders, retention, askpass
scoping, dry-runs). Shell lint: `shellcheck -x scripts/ops/backup/{neon_offsite,codeberg_mirror,restore_drill,offsite_lib}.sh`.
