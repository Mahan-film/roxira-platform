#!/usr/bin/env bash
# Install (or remove) the host snapshot timer for the owner admin console. Runs ON the production server.
# Dry-run by default: prints the plan and changes nothing. See docs/ops/ADMIN_CONSOLE.md.
#
# Usage:
#   scripts/ops/admin/install.sh             # dry-run
#   sudo scripts/ops/admin/install.sh --yes  # create /var/lib/roxira-admin, install units, enable the timer
#   sudo scripts/ops/admin/install.sh --disable
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UNIT_DIR="${ADMIN_UNIT_DIR:-/etc/systemd/system}"
STATE_DIR="${ADMIN_STATE_DIR:-/var/lib/roxira-admin}"
SERVICE="roxira-admin-snapshot.service"
TIMER="roxira-admin-snapshot.timer"

log() { printf '[admin-console] %s\n' "$*"; }

MODE="${1:---dry-run}"
case "$MODE" in
  --dry-run|--yes|--disable) ;;
  *) echo "usage: $0 [--dry-run | --yes | --disable]" >&2; exit 2 ;;
esac

run() {
  if [ "$MODE" = "--dry-run" ]; then printf 'dry-run: %s\n' "$*"; else "$@"; fi
}

if [ "$MODE" = "--disable" ]; then
  run systemctl disable --now "$TIMER" || true
  run systemctl daemon-reload || true
  log "timer disabled (units stay on disk)"
  exit 0
fi

if [ "$(id -u)" != "0" ] && [ "$MODE" != "--dry-run" ]; then
  log "ERROR: installing needs root (run with sudo)"
  exit 1
fi

# The directories docker-compose.prod.yml bind-mounts into the app container must exist on the host,
# otherwise docker creates them as root-owned empty dirs. Only the first is created by this script.
log "creating $STATE_DIR (snapshot output, mounted read-only into the app container)"
run install -d -m 755 "$STATE_DIR"
for d in /var/lib/roxira-agents /var/lib/roxira-marketing /var/lib/roxira-eval/bakeoff /var/log/roxira-keypool /root/deploy-state; do
  if [ -d "$d" ]; then log "mount source present: $d"; else log "WARNING: $d is missing; create it (or accept an empty tab) before 'docker compose up'"; fi
done

log "installing the snapshot timer (units -> $UNIT_DIR)"
run install -m 644 "$HERE/$SERVICE" "$UNIT_DIR/$SERVICE"
run install -m 644 "$HERE/$TIMER" "$UNIT_DIR/$TIMER"
run systemctl daemon-reload
run systemctl enable --now "$TIMER"

if [ "$MODE" = "--dry-run" ]; then
  log "dry-run only. Re-run with --yes (as root) to apply."
else
  log "installed. Check: systemctl list-timers $TIMER ; cat $STATE_DIR/host_status.json"
fi
