# roxira-ci: mirror, export and reliability pack (R20-3 #1019, R20-7 #1023)

Scripts live in `scripts/ops/ci_box/`. No secrets in the repo: the Telegram token and the restic password exist only on the box.
Both installers are idempotent and accept `--dry-run` (prints what they would do, writes nothing).

## A. Mirror and export (user `mahanfilms`, no sudo)

```
bash scripts/ops/ci_box/07_user_mirror_export.sh --dry-run
bash scripts/ops/ci_box/07_user_mirror_export.sh
```

- Nightly 02:30 (`roxira-mirror.timer`, systemd --user): `git clone --mirror`, then `git remote update --prune`, into `/srv/data/mirror/roxira-platform.git`.
- Sunday 03:30 (`roxira-gh-export.timer`): issues, PRs, issue comments, PR review comments, labels and milestones via `gh api --paginate` into `/srv/data/github-export/<date>/*.json` plus `MANIFEST.txt` (counts). The newest 8 dated directories are kept.
- Traffic uses the local HTTP proxy; auth is the existing `gh` login.
- Report: `box-backup-status` (installed in `~/.local/bin`), which also prints `box-reliability-status` when part B is installed. It is a separate script because `box-status` is root-owned.
- Owner step, once: `sudo loginctl enable-linger mahanfilms` (so timers run without a login). If `/srv/data/mirror` is not writable the installer prints the one `sudo install -d` line to run first.
- Check: `systemctl --user start roxira-mirror.service roxira-gh-export.service; box-backup-status`. Restore check: `python3 -m json.tool /srv/data/github-export/<date>/issues.json | head`, and `git clone /srv/data/mirror/roxira-platform.git /tmp/restore-test`.

## B. Reliability pack (owner, once, with sudo)

```
sudo bash scripts/ops/ci_box/06_root_reliability.sh --dry-run
sudo bash scripts/ops/ci_box/06_root_reliability.sh
```

| Part | What it does |
|------|--------------|
| Lid | `/etc/systemd/logind.conf.d/10-roxira-lid.conf`: lid switch ignored (logind reloaded with SIGHUP, sessions stay) |
| Sleep | `sleep`, `suspend`, `hibernate`, `hybrid-sleep` targets masked |
| Upgrades | `unattended-upgrades`, security origins only (`/etc/apt/apt.conf.d/52roxira-unattended`), `Automatic-Reboot "false"` |
| Reboot | `roxira-guarded-reboot.timer`, Sunday 04:30. Reboots only if `/var/run/reboot-required` exists, no `Runner.Worker` process runs, and no phone call is active |
| Battery | charge 40-80 percent via `charge_control_*_threshold`, only if the firmware exposes it; otherwise a note is printed and nothing is installed (HP often needs a BIOS "Battery Care" option) |
| Backup | restic (BSD-2) repo `/srv/data/backups/restic-box`, daily 03:15, `/etc`, `/usr/local/bin`, `/usr/local/lib/{roxira,phone-stack}`, `/usr/local/share/xray`, `~mahanfilms/.config`; excludes caches, `node_modules`, `docker`; keeps 7 daily, 4 weekly, 6 monthly; checks 2 percent of data each run |
| Alerts | `roxira-notify@.service` template, `OnFailure=` on the reboot and backup units and on `docker`, `voice-ai-agent`, `voice-ai-tts`. xray is left untouched. The runner is a user unit and is not covered |
| Status | `/usr/local/bin/box-reliability-status`: battery cap, last backup, last apt upgrade, reboot guard decision, timers. Needs no sudo |

Phone-call check: `phone-stack status` output is not machine readable. The guard asks the containers: if an `asterisk` container answers `core show channels count`, it reboots only at 0 active calls. If a `livekit` or `asterisk` container is up and calls cannot be counted, it assumes a call may be active and skips. Dry run of the guard: `sudo /usr/local/lib/roxira/guarded-reboot.sh --check`. Verify the Asterisk container name matches `asterisk` once `phone-stack up` runs.

### Owner steps after the script

1. **restic password.** On first run the script prints it once. Store it in your password manager. It is also in `/etc/roxira/restic.pass` (root, mode 600). Never commit or paste it. Losing it means the backups cannot be restored.
2. **Telegram.** Create the root-only env file (the example has placeholders only):
   ```
   sudo cp /etc/roxira/telegram.env.example /etc/roxira/telegram.env
   sudo nano /etc/roxira/telegram.env       # TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
   sudo chmod 600 /etc/roxira/telegram.env
   sudo systemctl start roxira-notify@test.service    # one test message must arrive
   ```
3. **First backup:** `sudo systemctl start roxira-box-backup.service`, then `box-reliability-status`.

The restic repo holds `~mahanfilms/.config` (including the `gh` login) and `/etc`. It is encrypted, root-only and on the local HDD; do not copy it off the box without a separate decision.

### Sunday restore drill (plan)

Weekly, after the 03:15 backup: `sudo restic -r /srv/data/backups/restic-box --password-file /etc/roxira/restic.pass restore latest --target /srv/data/restore-drill/$(date +%F) --include /etc/roxira` then compare with `diff -r`. Delete the target afterwards. Not automated yet (needs the owner to decide who gets the alert).

### Revert

`sudo systemctl disable --now roxira-guarded-reboot.timer roxira-box-backup.timer roxira-battery-cap.service`; remove `/etc/systemd/logind.conf.d/10-roxira-lid.conf`, `/etc/apt/apt.conf.d/52roxira-unattended`, `/etc/systemd/system/roxira-*`, `/etc/systemd/system/{docker,voice-ai-agent,voice-ai-tts}.service.d/10-roxira-onfailure.conf`; `sudo systemctl unmask sleep.target suspend.target hibernate.target hybrid-sleep.target`; `daemon-reload`. The backup data stays until you delete `/srv/data/backups/restic-box`.

### Not verified

Not run on the box yet: only `bash -n`, shellcheck and the dry runs on a Mac. The apt `#clear` directive, the asterisk channel count and the `--slurp` flag of the installed `gh` still need one live check.
