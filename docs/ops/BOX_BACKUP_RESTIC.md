# Box data backup (restic, user level) and restore drill

Scope: the CI box's OWN data (lane state, config files, phone-stack config, status data). Not the production
server (that is `DISASTER_RECOVERY.md`) and not the root-level job from `06_root_reliability.sh`
(`/etc`, root-owned files, `~mahanfilms/.config` including the `gh` login; repo `/srv/data/backups/restic-box`).
This job is the user-level complement: it runs as the lane user, uses its own repo and password, and **excludes
secrets by design**. Code: `scripts/ops/ci_box/box_backup/`. Issue: #1030 follow-up (R20-3, backups and DR prep).

Status: written and unit-tested on a fixture tree. Nothing is installed or run against real data yet; the
installer and the owner steps below are the go-live.

## What is backed up

An allowlist (`box_backup_lib.sh`, `src_files` / `src_dirs`), not a blacklist. Files that do not exist are skipped.

| Group | Paths (home-relative unless absolute) | Size on 2026-11-21 |
|---|---|---|
| Lane config templates | `.config/roxira-lane/lane-run.conf`, `.config/roxira-merge-gate/merge_gate.toml`, `.config/roxira-bridge/bridge.toml`, `.config/roxira-jit/jit_pool.toml` | ~40 KiB |
| User units | `.config/systemd/user/` | 100 KiB |
| Lane / gate / bridge / JIT state | `.local/state/roxira-lane/logs`, `.local/state/roxira-merge-gate/{state.json,last_main_sha}`, `.local/state/roxira-bridge`, `.local/state/roxira-jit`, `.roxira-agents/taskq.db` (consistent sqlite online copy) | ~50 KiB |
| Status page data | `.local/state/roxira-box` (mirror/export/backup markers), `.local/state/roxira-status`, `.local/share/roxira-status/www`, newest `github-export/<date>/MANIFEST.txt` | ~45 KiB |
| Phone stack config (no keys) | `/usr/local/lib/phone-stack/{phone-stack.conf,healthcheck.sh,models.yaml}` (root-owned, world-readable) | 52 KiB |
| Installed helper | `.local/bin/box-backup-status`, `.local/share/roxira-bridge/bridge.py` | few KiB |
| Extras | `EXTRA_PATHS` in `backup.conf` (owner's choice) | 0 |

Measured by `box_backup.sh --dry-run` on the real box (read-only): **37 files, about 83 KB raw**. With 7 daily, 4
weekly and 6 monthly snapshots and dedup, the repository should stay in the low single-digit MB range; logs are the
only growing part (files above 20 MB are skipped).

## What is excluded, and why

| Excluded | Why | Where it is covered instead |
|---|---|---|
| Any file named `*.env`, `env`, `.env*`, `*.pass`, `*.key`, `*.pem`, `*.p12`, `id_*`, `*token*`, `*secret*`, `*credential*`, `auth.json`, `hosts.yml`, `.npmrc`, `*.kdbx` | secrets by name | the owner's password manager; re-created at restore |
| Any other file whose content matches a secret pattern (private key block, provider keys, Telegram bot token, JWT, URL with password, long `password=`/`token=` values) | content scan `secret_scan.py`; the file is dropped, the backup continues, the dropped names (never the content) are logged and stored as `SCAN_DROPPED.txt` in the snapshot | fix or move the file; the marker note shows `skipped=N` |
| `.config/gh`, `.ssh`, `.claude*`, `.docker`, `.gemini`, keyrings, `.bash_history`, lane `home/` and `etc/` (CLI homes with auth, rendered config) | credentials / sessions | re-login on a rebuilt box (`docs/ops/LINUX_CI_BOX.md`) |
| `repo.git`, `worktrees`, `roxira-platform`, `roxira-wt`, `/srv/data/mirror`, full `github-export` dirs | rebuildable (clone, nightly mirror, weekly export) | GitHub plus the nightly mirror |
| `node_modules`, caches, `__pycache__`, `*.git` dirs | noise | rebuilt |
| `/home/phone`, `/srv/data/phone`, `/home/runner`, `/etc`, root-owned files | not readable by the lane user | the root job (06) for `/etc` and root files; repo templates for runner/phone setup |

The off-box copy inherits the same content: nothing secret is ever sent anywhere.

Failure handling: no password file or no restic binary = `SKIP` marker, message and exit 0 (not configured yet). Once the
password file exists, anything else (data disk not mounted, repository directory missing or not writable, backup or
check errors, a failed off-box copy) = `FAIL` marker, non-zero exit and the Telegram notice, so a dead disk is never silent.

## Retention, schedule, freshness

- Retention per repository: `--keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune`, grouped by host and tag so a
  changed file list does not fragment the policy.
- Timer `roxira-box-backup.timer`: daily **03:47** plus up to 7 min random delay, `Persistent=true`. Other box timers
  use 02:30 (mirror), 03:15 (root restic), 03:30 Sun (export), 04:30 Sun (reboot guard).
- Every run: backup, forget/prune, `restic check` (metadata); Sundays also `--read-data-subset=2%`.
- Freshness marker for the status page: `~/.local/state/roxira-box/backup.last`, same format as `mirror.last`:
  `OK <UTC ISO time> snapshots=N files=N skipped=N`, or `FAIL ...` / `SKIP <reason>`. Also
  `backup.offbox.last`, `backup-drill.last` and `backup.status.json` in the same directory. The status page needs one
  more row: in `box_status.py::collect_backups` add `("box data backup (user)", HOME/".local/state/roxira-box/backup.last")`
  next to the mirror and export rows (same `OK <ts>` parsing, no code change in the parser).
- `box-backup-status` (installed by `07_user_mirror_export.sh`; re-run it once after this merges) prints the three
  markers; `box_backup.sh --status` also shows snapshot count and repo size.

## Off-box copy (owner decides the destination)

Set `OFFBOX_REPOSITORY` in `~/.config/roxira-box-backup/backup.conf`. The job then runs `restic copy` (with
`--copy-chunker-params` on first init, so dedup stays identical) and applies the same retention there.

| Destination | `OFFBOX_REPOSITORY` | Credentials |
|---|---|---|
| Second local disk | `/mnt/other-disk/box-user` (directory must already exist on the mounted disk and be on a **different filesystem** than the primary, otherwise the run refuses: an unmounted disk must never become a folder on the root disk) | none |
| S3-compatible (R2, Wasabi, MinIO, AWS) | `s3:https://<endpoint>/<bucket>/box-user` | `offbox.env` with `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (+ optional `AWS_DEFAULT_REGION`) |
| Backblaze B2 | `b2:<bucket>:box-user` | `offbox.env` with `B2_ACCOUNT_ID`, `B2_ACCOUNT_KEY` |
| Other restic backends (sftp, rest, rclone) | `sftp:user@host:/path` etc. | key files / `RCLONE_*` as that backend requires |

`offbox.env` must be mode 600 and holds only allowlisted variable names; it is parsed, never sourced. The lane user is
egress-locked, so remote targets go through the local proxy (set by the unit, or `PROXY=` in `backup.conf`); the
destination host must be allowed by the box proxy rules. A failed off-box leg fails the unit (Telegram notice) but
the primary snapshot is kept and the primary marker stays `OK`.

## Telegram failure notice

`OnFailure=roxira-box-backup-notify.service` runs `notify_failure.sh`. It reads `NOTIFY_BOT_TOKEN` and
`NOTIFY_CHAT_ID` from `~/.config/roxira-box-backup/notify.env` (mode 600, owner-created, never in git) and sends one
line through the repo's `notify.py` (unit name and host only, no log content). Missing file, wrong mode, or empty
values: it prints why and exits 0 (no-op).

## Restore drill

`restore_drill.sh` restores the latest snapshot into a scratch directory under `~/.local/state/roxira-box-backup/drill/`
(or `--target DIR`; it refuses `/`, system dirs, a non-empty directory), picks N random files (default 25, `--sample`)
and checks their sha256 against `MANIFEST.sha256`, which was written at backup time and is stored inside the snapshot
(so the check does not break when live files change afterwards). It also runs `integrity_check` on the restored
`taskq.db`, deletes the scratch dir (`--keep` to inspect) and writes `backup-drill.last`. It never writes outside the
scratch dir and never touches live paths. `--repo offbox` tests the off-box copy.

Cadence: once right after the first backup, then monthly and after any change to the file list. Real restore of one file
(manually): `restic -r <repo> --password-file <pass> restore latest --tag box-user --target <scratch> --include <path>`.
Full rebuild of a box: see `docs/ops/LINUX_CI_BOX.md` for the setup, then restore the lane config and state from the
latest snapshot into place and re-create the secret files by hand.

## Owner steps (once)

```
# 1. repository directory (root, because /srv/data/backups is root-owned)
sudo install -d -o mahanfilms -g mahanfilms -m 700 /srv/data/backups/box-user
# 2. as mahanfilms: install (idempotent; dry run first)
bash scripts/ops/ci_box/box_backup/install_user.sh --dry-run && bash scripts/ops/ci_box/box_backup/install_user.sh
# 3. password (mode 600), then copy it into your password manager; without it the backups cannot be restored
umask 077; head -c 32 /dev/urandom | base64 | tr -d '\n=' > ~/.config/roxira-box-backup/restic.pass
# 4. look first, then run once, then the drill
~/.local/lib/roxira-box-backup/box_backup.sh --dry-run
systemctl --user start roxira-box-backup.service; ~/.local/lib/roxira-box-backup/box_backup.sh --status
~/.local/lib/roxira-box-backup/restore_drill.sh
# 5. optional: Telegram (mode 600) and off-box destination (see above)
```

restic is already installed on the box (0.18.1). If it is missing: `sudo apt install restic`.

## Revert

`systemctl --user disable --now roxira-box-backup.timer`; delete `~/.config/systemd/user/roxira-box-backup*`,
`~/.local/lib/roxira-box-backup`, `~/.config/roxira-box-backup`. The repository stays until you delete
`/srv/data/backups/box-user`.

## Tests

`python3 -m pytest src/ops/test_box_backup.py` runs the fast tests (dry-run, secret filters, skip/fail handling, units;
Linux only). `BOX_BACKUP_E2E=1 python3 -m pytest src/ops/test_box_backup.py` adds the real restic round trips (backup,
idempotence, restore drill, off-box copy to a second filesystem; about 40 s; needs restic). Everything uses a fixture HOME,
a throwaway repo and password. Not covered by automation: a real S3/B2 destination, the Telegram send, systemd execution.
