#!/usr/bin/env bash
# Install (or remove) the off-site backup timers: Neon DB copy (daily 02:40 UTC) and Codeberg
# code mirror (hourly). Runs ON the production server as root. Dry-run by default.
# See docs/ops/OFFSITE_BACKUP.md.
#
# Usage:
#   scripts/ops/backup/install_offsite.sh            # dry-run (prints the plan)
#   scripts/ops/backup/install_offsite.sh --apply    # install units, enable both timers
#   scripts/ops/backup/install_offsite.sh --disable  # stop and disable both timers
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UNIT_DIR="${OFFSITE_UNIT_DIR:-/etc/systemd/system}"
UNITS=(roxira-neon-offsite roxira-codeberg-mirror)

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

case "${1:-}" in
  "" | --dry-run | --apply | --disable) ;;
  *) echo "usage: $0 [--dry-run | --apply | --disable]" >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { echo "usage: $0 [--dry-run | --apply | --disable]" >&2; exit 2; }
MODE="${1:-}"; [ -n "$MODE" ] || MODE="--dry-run"

run() {
  if [ "$MODE" = "--dry-run" ]; then printf 'dry-run: %s\n' "$*"; else "$@"; fi
}

if [ "$(id -u)" != "0" ] && [ "$MODE" != "--dry-run" ]; then
  log "ERROR: needs root (run with sudo)"; exit 1
fi

if [ "$MODE" = "--disable" ]; then
  for u in "${UNITS[@]}"; do run systemctl disable --now "$u.timer" || true; done
  run systemctl daemon-reload
  log "timers disabled (unit files left in $UNIT_DIR; remove them by hand if wanted)"
  exit 0
fi

for u in "${UNITS[@]}"; do
  run install -m 644 "$HERE/$u.service" "$UNIT_DIR/$u.service"
  run install -m 644 "$HERE/$u.timer" "$UNIT_DIR/$u.timer"
done
run install -d -m 700 /var/lib/roxira-offsite /var/lib/roxira-mirror /opt/roxira_backups/neon
run systemctl daemon-reload
for u in "${UNITS[@]}"; do run systemctl enable --now "$u.timer"; done

if [ "$MODE" = "--dry-run" ]; then
  log "dry-run only. Re-run with --apply. Before that the owner sets NEON_BACKUP_URL and CODEBERG_TOKEN (see the doc)."
else
  log "installed. Check: systemctl list-timers 'roxira-neon-*' 'roxira-codeberg-*'"
  log "first manual run: systemctl start roxira-neon-offsite.service; journalctl -u roxira-neon-offsite -n 60"
fi
