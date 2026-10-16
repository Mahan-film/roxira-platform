#!/usr/bin/env bash
# Install (or remove) the multi-project deploy systemd timer. Runs ON the server as root.
# Dry-run by default (prints the commands). Does not touch roxira-autodeploy.
#   install.sh            dry-run     install.sh --yes   install+enable     install.sh --disable
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UNIT_DIR="${PROJECTS_UNIT_DIR:-/etc/systemd/system}"
SERVICE="projects-deploy.service"
TIMER="projects-deploy.timer"

case "${1:-}" in
  ""|--dry-run|--yes|--disable) ;;
  *) echo "usage: $0 [--dry-run | --yes | --disable]" >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { echo "usage: $0 [--dry-run | --yes | --disable]" >&2; exit 2; }
MODE="${1:-}"; [ -n "$MODE" ] || MODE="--dry-run"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
run() {
  if [ "$MODE" = "--dry-run" ]; then printf 'dry-run: %s\n' "$*"; else "$@"; fi
}

if [ "$MODE" = "--disable" ]; then
  run systemctl disable --now "$TIMER" || true
  run systemctl daemon-reload || true
  log "projects auto-deploy is off (units left in $UNIT_DIR)"
  exit 0
fi

if [ "$(id -u)" != "0" ] && [ "$MODE" != "--dry-run" ]; then
  log "ERROR: installing needs root"; exit 1
fi

log "installing projects deploy timer (units -> $UNIT_DIR)"
run install -m 644 "$HERE/$SERVICE" "$UNIT_DIR/$SERVICE"
run install -m 644 "$HERE/$TIMER" "$UNIT_DIR/$TIMER"
run mkdir -p /srv/projects /root/deploy-state
run systemctl daemon-reload
run systemctl enable --now "$TIMER"
if [ "$MODE" = "--dry-run" ]; then
  log "dry-run only. Re-run with --yes to install and start the timer."
else
  log "installed. Check: systemctl list-timers '$TIMER'; journalctl -u $SERVICE"
fi
