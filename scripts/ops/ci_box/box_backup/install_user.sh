#!/usr/bin/env bash
# Install the user-level box backup for the CURRENT user (mahanfilms). No root. Idempotent.
#   bash install_user.sh [--dry-run]
# Installs scripts to ~/.local/lib/roxira-box-backup, units to ~/.config/systemd/user, a config example, and
# enables the daily timer (03:47). Until the owner supplies the restic password the job is a harmless no-op
# (marker SKIP). It creates NO secrets: restic.pass, offbox.env and notify.env are the owner's.
set -euo pipefail
DRY=0
case "${1:-}" in --dry-run) DRY=1 ;; "") ;; *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;; esac
[ "$(id -u)" -ne 0 ] || { echo "run as the lane user (mahanfilms), not root"; exit 1; }
src="$(cd "$(dirname "$0")" && pwd)"
lib="$HOME/.local/lib/roxira-box-backup"
cfg="$HOME/.config/roxira-box-backup"
units="$HOME/.config/systemd/user"
proxy="${ROXIRA_PROXY:-http://127.0.0.1:10809}"
run() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }
run mkdir -p "$lib" "$cfg" "$units"
run chmod 700 "$cfg"
for f in box_backup.sh restore_drill.sh notify_failure.sh; do run install -m 0755 "$src/$f" "$lib/$f"; done
run install -m 0644 "$src/box_backup_lib.sh" "$lib/box_backup_lib.sh"
run install -m 0755 "$src/secret_scan.py" "$lib/secret_scan.py"
run install -m 0644 "$src/../../notify/notify.py" "$lib/notify.py"
[ -f "$cfg/backup.conf" ] || run install -m 0600 "$src/box-backup.conf.example" "$cfg/backup.conf"
for u in roxira-box-backup.service roxira-box-backup.timer roxira-box-backup-notify.service; do
  if [ "$DRY" = 1 ]; then echo "[dry-run] install unit $u"; else
    sed -e "s#http://127.0.0.1:10809#$proxy#g" "$src/$u" > "$units/$u"; chmod 644 "$units/$u"; fi
done
run systemctl --user daemon-reload
run systemctl --user enable --now roxira-box-backup.timer
echo "installed. Next (owner): create $cfg/restic.pass (mode 600), the repository directory, then:"
echo "  $lib/box_backup.sh --dry-run     # see what would be backed up"
echo "  systemctl --user start roxira-box-backup.service && $lib/box_backup.sh --status"
echo "  $lib/restore_drill.sh            # restore drill into a scratch dir"
