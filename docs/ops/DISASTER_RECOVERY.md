# Disaster recovery, backups and server migration

Status: designed and delivered as code; **not yet rolled out** (the hub applies it after review, see "Rollout").
Inventory basis: `docs/infra/INFRA_MAP_2026-10-09.md`, `docs/research/BEST_PRACTICE_CHECK_2026-10-09.md`.

## 1. Targets

| Target | Value | How it is met |
|---|---|---|
| RPO (max data loss) | 1 hour | hourly `roxira-backup-dr-pgcfg.timer` (encrypted Postgres + configs to R2); since 2026-10-30 the full local set is daily, see `docs/ops/BACKUP_SCHEDULE_2026-10-30.md` |
| RTO (time to recover) | under 4 hours | `scripts/infra/bootstrap_new_server.sh --restore` (= bootstrap + `restore.sh --full`); data set is small (about 0.3 GB of DB/vector data) so restore time is dominated by apt/docker install and DNS |
| Copies | 3-2-1 | live server + server-local dump sets + Mac (daily pull into an encrypted restic repo); optional Cloudflare R2 as the off-site third. A Hetzner Storage Box is supported but not required (see section 11) |
| Encryption | at rest everywhere | restic AES-256 repos; config bundle by age; local server dumps are plain on the server disk (same trust as the DB itself) |

## 2. What exists today (inventory, 2026-10-09)

| Item | State | Disposition |
|---|---|---|
| root cron `0 * * * * scripts/auto_backup_daemon.sh` | live; dumps only `enterprise_db` (plain SQL, gzip) + tar of Qdrant storage dir (a live-copy, can be inconsistent) into `/opt/roxira_backups` (same disk, 7 days) | keep running until the new system has 3 clean days, then remove the cron line (hub, owner-approved) |
| `scripts/ops/backup.sh` + `deploy/systemd/roxira-backup.{service,timer}` | in repo, never installed | superseded by this system; do not install both |
| `/root/backup_qdrant.sh` | creates per-collection snapshots for two collections and **never deletes them** (they accumulate inside the Qdrant container); not in crontab | leftover; new script deletes its own snapshots; `BACKUP_QDRANT_PRUNE_OLD=1` once removes old ones |
| `/root/*backup*.sh`, `/root/backups/`, `/root/deploy-state/db-backups/*.dump`, `/root/env-backups` | ad-hoc, manual | `deploy-state` and `env-backups` are now in the restic path set |
| `scripts/ops/pull_backups_to_mac.sh` + `install_mac_backup_pull.sh` (launchd `net.roxira.backup-pull`) | Mac pulls plain gz files to `~/RoxiraBackups` (unencrypted, also covers Twenty DB) | replaced by `mac_pull.sh` (encrypted restic repo); unload the old agent after the first good new run |
| `/root/.ssh/storagebox_backup` (+ `.pub`, comment `roxira-backup`) | key pair exists. **No host, user or script references it anywhere on the server**, so whether a Storage Box exists and has this key authorised is **unconfirmed** | owner must confirm (see section 9) |
| restic, age, msmtp on the server | not installed (rsync, jq, curl, python3 present) | `apt-get install -y restic age` (rollout step 1); mail uses python smtplib, no msmtp |
| Disk | 150 GB, 59% used; `/opt/roxira_backups` is 11 GB (hourly 230 KB pg + roughly 180 MB Qdrant tars) | new local sets keep 3 hardlinked copies and enforce the 85% / 95% guard |

Data actually at risk: Postgres 75 MB, Qdrant 183 MB (10 collections), Twenty DB (`default`), Redis (cache, RDB saves only), `/opt/roxira_platform/data` 9 MB, plus configuration and secrets that exist nowhere else: `/opt/roxira_platform/.env`, `docker/research-stack/.env`, `/etc/letsencrypt`, `/etc/x-ui` (x-ui.db, proxy users), `/root/.ssh` (deploy keys), crontabs, ufw rules.

## 3. Architecture

```
server (root, systemd timers)                       offsite                       Mac (launchd daily)
 server_backup.sh run  (hourly)                      Hetzner Storage Box           mac_pull.sh
  1 disk guard 85% warn / 95% abort                  restic repo (sftp :23)  ---->  restic copy  -> ~/Backups/roxira-dr/restic
  2 stage: pg_dump -Fc per DB + globals              [optional] S3/R2/B2 repo       (fallback: rsync latest set over ssh
    (roxira_postgres_prod, roxira_twenty_db),                                        then restic backup locally)
    Qdrant snapshot API per collection (then DELETE),
    redis BGSAVE rdb, certbot volume, meta lists
  3 hardlinked local sets (keep 3)  /opt/roxira_backups/dr/sets
  4 restic backup stage + configs + data  -> every configured repo
  5 daily: forget --keep-hourly 24 --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
 server_backup.sh report (06:30 UTC): status email, Sunday + age-encrypted config bundle
 server_backup.sh check  (Sunday 04:30): restic check --read-data-subset=5% per repo
```

Why restic: client-side encryption, dedup (hourly runs only upload changed chunks), snapshot verification, one binary, works over sftp (Storage Box), S3 (R2/B2) and local disk, and the Mac can `restic copy` between repos.

Postgres and Qdrant volumes are not copied raw (a live copy is inconsistent); they are covered by `pg_dump -Fc` (verified with `pg_restore -l` right after dumping) and Qdrant collection snapshots. Redis is `appendonly no` with RDB saves; treated as cache, RDB still captured.

Files (all in this PR):

| Path | Purpose |
|---|---|
| `scripts/ops/backup/server_backup.sh` | modes `init run report check bundle`, all with `--dry-run` |
| `scripts/ops/backup/lib.sh` | shared helpers, restic repo selection (credentials only exported in subshells) |
| `scripts/ops/backup/notify_email.py` | SMTP sender (smtplib, STARTTLS), attachment size guard |
| `scripts/ops/backup/restore.sh` | drill (scratch dir) or `--full` restore |
| `scripts/infra/bootstrap_new_server.sh` | fresh Ubuntu/Debian to hardened host; `--restore` also clones and runs `restore.sh --full` (`scripts/ops/bootstrap_new_server.sh` is a stub that forwards here) |
| `scripts/ops/backup/mac_pull.sh`, `install_mac_pull.sh`, `deploy/launchd/ir.roxira.backup-pull.plist.template` | Mac copy |
| `deploy/systemd/roxira-backup-dr-{run,report,check}.{service,timer}` | schedules |
| `deploy/backup/backup.env.example` | env variable NAMES only |

## 4. Secrets and where they live

| Secret | Location | Never |
|---|---|---|
| restic password | server `/etc/roxira/restic.pass` (0600 root); owner copy in password manager AND `~/Secrets/roxira/restic-dr.pass` | in git, in the env file, in the backup |
| Storage Box ssh key | server `/root/.ssh/storagebox_backup`; owner copy `~/Secrets/roxira/storagebox_backup` | git |
| Gmail App Password, S3 keys | `/etc/roxira/backup.env` (0600) | git, logs |
| age private key | `~/Secrets/roxira/backup-age.key` on the Mac only; server holds the public recipient (`BACKUP_AGE_RECIPIENT`) | server |

If the restic password is lost, every backup is unreadable. Store it in at least two places off the server before the first backup.

## 5. Notifications (Gmail)

Limits (Google documentation, re-verify when setting up): attachment limit 25 MB per message including encoding overhead (so keep payloads under 20 MB); consumer accounts about 500 sent messages per day (SMTP counts toward it); SMTP login with an App Password requires 2-Step Verification, App Passwords are 16 characters, are unavailable for Advanced Protection accounts, and "less secure apps" password login no longer exists. Full backups (10+ GB) are therefore never emailed.

Design: one short daily report (06:30 UTC): result, last OK time, status age, duration, staged size, disk %, snapshot ids and bytes added per repo, last weekly check result, warnings. Weekly (Sunday) the report carries an age-encrypted config bundle (.env files, compose, nginx conf.d, crontabs, ufw rules, x-ui.db, backup.env) which is built only if under 20 MB. Immediate alert emails: failed run, failed check, disk >= 85% (and 95% abort), throttled to one per 6 hours (`BACKUP_ALERT_COOLDOWN_MIN`) so an outage does not burn the daily quota. A missing daily report itself signals that the server or timer is down. Variables: `BACKUP_SMTP_USER`, `BACKUP_SMTP_PASS`, `BACKUP_NOTIFY_TO` (+ host/port, from).

## 6. Rollout (hub, in order; nothing here has been executed)

1. Install tools: `apt-get install -y restic age`.
2. `install -d -m 700 /etc/roxira`; create the restic password: `umask 077; openssl rand -base64 36 > /etc/roxira/restic.pass`, then immediately copy it to the password manager and `~/Secrets/roxira/restic-dr.pass`.
3. `cp deploy/backup/backup.env.example /etc/roxira/backup.env; chmod 600`; fill Storage Box (and optional S3, SMTP, age recipient) values by editing the file on the server.
4. Test box access: `sftp -P 23 -i /root/.ssh/storagebox_backup <user>@<host>` (must not ask a password). If it fails the owner has to authorise the key (section 9).
5. `scripts/ops/backup/server_backup.sh --dry-run run`, then `server_backup.sh init`.
6. First backup by hand: `scripts/ops/backup/server_backup.sh run`; then `restic snapshots` (via `restore.sh` preflight).
7. Restore test into a scratch dir: `scripts/ops/backup/restore.sh --scratch /var/tmp/dr-test` (drill mode, touches nothing live); delete the scratch dir.
8. Install units: `cp deploy/systemd/roxira-backup-dr-* /etc/systemd/system/; systemctl daemon-reload; systemctl enable --now roxira-backup-dr-run.timer roxira-backup-dr-report.timer roxira-backup-dr-check.timer`.
9. Test mail: `FORCE_BUNDLE=1 scripts/ops/backup/server_backup.sh report`.
10. After 3 clean days: remove the cron line for `auto_backup_daemon.sh`, optionally run once with `BACKUP_QDRANT_PRUNE_OLD=1`.
11. Mac: see section 7.

Rollback: `systemctl disable --now roxira-backup-dr-*.timer`, remove the unit files and `/etc/roxira/`; the old cron job was never touched. Repos on the Storage Box can be deleted independently.

## 7. Mac copy

One-time: `brew install restic`; put `restic-dr.pass` (a new password for the local repo is fine; copy mode reads the server repo password from `SB_REMOTE_PASSWORD_FILE`) and, for direct mode, the Storage Box key in `~/Secrets/roxira/`; create `~/Secrets/roxira/backup-pull.env` (mode 600) with `BACKUP_SB_USER`, `BACKUP_SB_HOST`, optionally `SB_REMOTE_PASSWORD_FILE`. Then `scripts/ops/backup/install_mac_pull.sh` (daily 10:15, launchd re-runs a missed job at wake, the script exits quietly if the server is offline). Without Storage Box config it falls back to rsync over ssh from `/opt/roxira_backups/dr/sets/latest`. Only `~/Backups/roxira-dr/` is written. Decrypting the Mac repo: `restic -r ~/Backups/roxira-dr/restic --password-file ~/Secrets/roxira/restic-dr.pass restore latest --target <dir>`.

## 8. Runbooks

### 8.1 Monthly restore drill (15 minutes)
1. On the server: `scripts/ops/backup/restore.sh --scratch /var/tmp/drill` (verifies every pg dump with `pg_restore -l` and checks Qdrant snapshots are non-empty).
2. Spot check: restore one dump into a throwaway DB (`createdb drilldb; pg_restore -d drilldb ...`), count rows of one table, drop it.
3. On the Mac: restore the latest snapshot from the local repo into a temp dir and compare file list with step 1.
4. Record date and result in `docs/STATE.md`; delete scratch dirs. Test the email alert path once per quarter by temporarily wrong-pathing the Storage Box key.

### 8.2 "Server is gone" (unplanned)
1. Order a new Hetzner server (Ubuntu 24.04), same region/arch if possible (aarch64 images matter: `qdrant/qdrant`, app images rebuild).
2. From the Mac copy to the new host: `/etc/roxira/restic.pass`, `/etc/roxira/backup.env`, the Storage Box key (to `BACKUP_SB_KEY`), your ssh public key in `/root/.ssh/authorized_keys`.
3. `curl -fsSL https://raw.githubusercontent.com/Mahan-film/roxira-platform/main/scripts/infra/bootstrap_new_server.sh -o bootstrap.sh; bash bootstrap.sh --dry-run --restore`, then `bash bootstrap.sh --restore` (add `--i-have-key-access` only on the final run, after testing key login from a second terminal) (the repo is cloned by the script; if the repo is private, scp the script instead).
4. If the Storage Box is also lost: use the Mac repo (`restic -r ~/Backups/roxira-dr/restic restore`) and rsync the tree to the new host, then copy the repo directory (`~/Backups/roxira-dr/restic`) to the new host, set `BACKUP_LOCAL_REPO` to it in `/etc/roxira/backup.env` and run `restore.sh --full --repo local` (note the Mac repo password may differ: point `RESTIC_PASSWORD_FILE` at it). Run `bootstrap_new_server.sh` without `--restore` first for the host hardening.
5. DNS: Cloudflare A/AAAA to the new IP; verify TLS; run `server_backup.sh run`; confirm the report email.
6. Review `docs/ops` security items (3x-ui panel ports) before reopening the firewall.

### 8.3 Planned migration (new server or home server)
1. T-48h: lower TTL to 60 s in Cloudflare for all records pointing to the old server.
2. Provision the new host with `bootstrap_new_server.sh` (restores the latest snapshot; the site stays live on the old server).
3. Verify on the new host using a hosts-file override or `curl --resolve` against its IP.
4. Cutover window: put the app in read-only/maintenance, stop writers on the old server (`docker compose stop` app, backend, workers, crons), run a final `server_backup.sh run` there, then on the new host `restore.sh --full --yes` again (the delta sync; dumps are consistent and DBs are small).
5. Switch the Cloudflare A/AAAA records to the new IP; watch logs; keep the old server stopped but intact for 7 days.
6. Raise TTL back to normal; update `ROXIRA_HOST` on the Mac and any deploy secrets (`scripts/ops/set_server_env.sh`); run one backup and confirm the report email from the new host.
For a home server: same steps; replace Hetzner firewall assumptions with router port-forwards for 80/443/8443 and use Cloudflare Tunnel or DDNS if the IP is dynamic.

## 11. Mode without a Storage Box: server local + Mac pull (+ optional R2)

The owner has no Storage Box. The supported minimum is:

| Copy | Where | Written by | Encrypted | Retention |
|---|---|---|---|---|
| 1 | server disk `/opt/roxira_backups/dr/sets/<UTC timestamp>` (`latest` symlink) | hourly `server_backup.sh run` | no (same trust as the DB disk, directory is 0700 root); T197: only the newest set is kept (`BACKUP_KEEP_HOURLY=1`, `BACKUP_KEEP_DAILY=0`), the encrypted off-site copies are the history | newest 1 set (also when disk >= 85%) |
| 2 | Mac `~/Backups/roxira-dr/restic` | daily `mac_pull.sh` (rsync over ssh, then `restic backup`) | yes, restic AES-256 | daily 14, weekly 8, monthly 12 |
| 3 (optional, later) | Cloudflare R2 bucket | `server_backup.sh run` once `BACKUP_S3_*` is set | yes, restic | forget policy of section 3 |

Server settings (`/etc/roxira/backup.env`): leave `BACKUP_SB_*` and `BACKUP_S3_*` empty and set `BACKUP_ALLOW_LOCAL_ONLY=1`. `run` then still makes the consistent set (pg_dump -Fc per DB verified with `pg_restore -l`, Qdrant snapshots, Redis RDB, meta lists, plus `configs/configs.tar.gz` with env files, nginx, letsencrypt, crontabs, systemd units, ufw, x-ui) and writes `LAST_RESULT=OK` with `BACKUP_MODE=local-only`. Without the flag, "no repository configured" stays a FAIL so a misconfiguration is never silent. `$REPO_DIR/data` is not part of a local-only set (restic modes do include it). Rotation is done by `prune_sets`, which only removes timestamp-named directories under `sets/` beyond the keep count and never the target of `latest` (covered by `src/test_backup_prune.py`). A local restic repo on the server is optional: set `BACKUP_LOCAL_REPO=/opt/roxira_backups/dr/restic` and `init`.

Mac side: `mac_pull.sh` runs in rsync mode whenever no Storage Box key is configured (or `MAC_PULL_MODE=rsync`). It resolves `sets/latest` over ssh, refuses a set older than `MAC_PULL_MAX_AGE_H` (6 h; this is how a dead server timer is noticed), rsyncs it into a private temp dir, `restic backup`s it (tag `mac-pull`), applies retention on the Mac repo, and deletes the temp dir. Failures raise a macOS notification and are appended to `~/Backups/roxira-dr/pull.log`; if the server is unreachable and the last good pull is older than 48 h it notifies as well. Needs a root ssh key on the Mac that the server already accepts.

Honest risk statement. With only the server and a Mac you have two real copies, not three, and they are not independent in every failure:
- The server-local sets are on the same disk as the data: they protect against a bad deploy, a dropped table or a corrupted DB, not against losing the machine, the provider account or ransomware with root.
- Up to 24 h of data can be lost (RPO is the Mac pull interval, not the hourly dump) if the server disappears right before the pull.
- A laptop is often asleep, offline or stolen; a missed day is only noticed by the stale-pull notification. A stolen Mac exposes nothing without the restic password, but losing both the Mac and the restic password means the Mac copy is unreadable: keep the password in the password manager.
- Server compromise: an attacker with root on the server can delete the local sets and, if the Mac pull key is on the server (it is not), reach the Mac. Keep the pull key on the Mac only.
- Adding Cloudflare R2 (10 GB free tier) gives the missing independent off-site copy that also receives hourly pushes; do it when you can create the bucket and a scoped token.

One-shot server rollout for this mode: `scripts/ops/rollout/ops_rollout.sh` (run on the server, dry-run by default, `--apply` to execute): `install-tools`, `setup-notify`, `install-backup`, `install-monitor`, `test-mail`, `prep-nginx`, `status`.

## 9. Owner actions (cannot be done from code)

1. (Optional; the owner currently has no Storage Box, see section 11) Confirm a Hetzner Storage Box exists (Robot panel) and give the hub its username/host; add `/root/.ssh/storagebox_backup.pub` under the box's SSH keys (Robot > Storage Box > SSH keys), and enable SSH support. If no box exists, order one (BX11 1 TB is enough) or use R2/B2 free tier as the only offsite (set `BACKUP_S3_*` and leave `BACKUP_SB_USER` empty).
2. Gmail: enable 2-Step Verification, then Google Account > Security > App passwords > create "roxira-backup"; give it to the hub through the server env file only (never in chat or git).
3. Generate the age key on the Mac: `age-keygen -o ~/Secrets/roxira/backup-age.key`; hand over only the printed `age1...` public key.
4. Store the restic password in the password manager plus one offline copy.
5. Optional S3: create an R2 bucket (10 GB free) and a scoped API token.

## 10. Risks and notes

- Hourly Qdrant snapshots read about 180 MB per run; restic dedup limits upload, but heavy re-ingestion bursts raise the traffic. Tune with a longer timer if needed.
- The restic path set includes `/root/.ssh` and `.env` files: safe only because the repos are encrypted; protect the restic password accordingly.
- `restic forget --prune` runs once a day (03:xx UTC) to avoid hourly prune load.
- If both Storage Box and server die and the Mac is off, the S3 repo (if enabled) is the last copy; enabling it is recommended.
- Scripts use GNU `stat`/`cp -al` (server side, Linux only); `mac_pull.sh` is macOS-safe (bash 3.2).

## 12. Measured RTO: real restore drill and migration rehearsal on the Mac (T197, T198)

Why: the weekly srv1 drill proves the chain with a throwaway key and a fresh payload. It does not prove that the
real age key opens the real off-site copies, and nobody had timed a restore of real data. `scripts/ops/backup/mac_restore_rehearsal.sh`
does both on the owner's Mac at no extra cost (Docker, the existing R2 bucket, the existing age key).

Off-site copies it restores (all age-encrypted on the server before upload, never in clear on R2 or Telegram):

| Artifact | R2 key | Written by | R2 retention | Telegram |
|---|---|---|---|---|
| Postgres + configs payload (includes `pg/<container>/<db>.counts`, the row-count manifest) | `pgcfg/hourly/`, `pgcfg/daily/` | hourly `server_backup.sh pgcfg` | 7 d hourly, 30 d daily | 6-hourly dump (`telegram_offsite.sh`) |
| Qdrant snapshots (all collections + `collection_info.json`) | `qdrant/daily/` | daily `server_backup.sh run` | 7 d (`BACKUP_R2_QDRANT_KEEP_DAYS`) | only up to `TELEGRAM_MAX_TOTAL_MB` (150), else skipped and logged |
| Config set (`configs.tar.gz`) | `configs/daily/` | daily `server_backup.sh run` | 30 d (`BACKUP_R2_CONFIGS_KEEP_DAYS`) | 45 MB parts via `--send-file` |

`server_backup.sh` records `QDRANT_LAST_RESULT` / `CONFIGS_LAST_RESULT` (OK, FAIL, NOT_CONFIGURED) plus `*_R2_RESULT`,
`*_TG_RESULT` (OK, SKIPPED_TOO_BIG, FAIL, DISABLED) and `*_BYTES` in `/var/lib/roxira-backup/status.env`. An R2 failure also makes
`LAST_RESULT=FAIL`, so the existing alert and the daily report cover it. The whole step is fail-closed: it runs only when `BACKUP_OFFSITE_EXTRAS=1` is set
in `/etc/roxira/backup.env`. Turn the Telegram part with `BACKUP_OFFSITE_TELEGRAM=0` in `/etc/roxira/backup.env`.

Run it (Docker Desktop running; R2 and Telegram values come from `~/Secrets/roxira/roxira.env`, the key path from
`ROXIRA_AGE_IDENTITY`, default `~/Secrets/roxira/backup-age.key`; nothing is printed):

```bash
bash scripts/ops/backup/mac_restore_rehearsal.sh --dry-run     # plan only
bash scripts/ops/backup/mac_restore_rehearsal.sh               # the real run
```

What it does, in order, with throwaway containers on `127.0.0.1:55710` (Postgres) and `:55711` (Qdrant):

1. Pull images (outside the clock), then start the clock.
2. Download the newest `pgcfg/hourly/` payload and the newest `qdrant/daily/` set, decrypt, restore every dump and every snapshot.
3. Smoke: row counts of the 10 biggest tables per database against the manifest (tolerance `REHEARSAL_COUNT_TOL_PCT`, default 5 %, because the live
   database keeps changing between the dump and the count), Qdrant `points_count` against `collection_info.json`.
4. Stop the RTO clock. **RTO = download + decrypt + restore + smoke**, measured on that Mac. A real server rebuild adds the
   server provisioning steps of section 8 on top.
5. `git fetch origin main`, `git archive` the hub, then in a node container on the same docker network: `migration:show`
   (pending count), `migration:run`, `migration:show` (must be 0 pending). This rehearses the next deploy against real data.
6. Append one line to `~/Backups/roxira-dr/rehearsal.log`, send it through `scripts/ops/notify/notify.py`, remove the containers, network and work dir.

Result line, for example: `2026-11-17T09:00:00Z restore-rehearsal PASS rto=612s total=905s payload=20261117T080737Z.tar.age payload_age=1980s dbs=4 counts=38checked/0nomanifest qdrant=ok(3coll) migrations=ok(2->0,main@abc1234)` (illustrative, not a measurement).
`FAIL` means a decrypt, restore, count, Qdrant or migration step broke (the detail is in the line); `SLOW` means RTO went above `REHEARSAL_MAX_RTO_S`.
Record the first measured `rto=` and `total=` here after the owner has run it, and re-measure after big data growth:

| Date | rto | total | payload size | notes |
|---|---|---|---|---|
| (not measured yet) | | | | |

Weekly on the Mac (not installed by default): `bash scripts/ops/backup/install_mac_rehearsal.sh --dry-run`, then without
`--dry-run`. It renders `deploy/launchd/ir.roxira.restore-rehearsal.plist.template` (Sundays 11:30) into `~/Library/LaunchAgents/`.
Remove it with `launchctl bootout gui/$(id -u)/ir.roxira.restore-rehearsal` and delete the plist.

Limits: single R2 PUT per object (a Qdrant set above about 5 GB needs multipart); the Mac needs free disk of roughly 3x the payload size under `~/Backups/roxira-dr/`.
