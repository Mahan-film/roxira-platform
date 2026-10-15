#!/usr/bin/env bash
# Install (or update) the owner control bot as a systemd service. Runs ON the
# production server; needs root. Dry-run by default: it only prints the plan.
# See docs/ops/CONTROL_BOT.md.
#
# Usage:
#   scripts/ops/notify/install.sh           # dry-run (prints the plan)
#   scripts/ops/notify/install.sh --apply   # install units, enable + start the service
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UNIT_DIR="${NOTIFY_UNIT_DIR:-/etc/systemd/system}"
SERVICE="roxira-control-bot.service"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

case "${1:-}" in
  "" | --dry-run | --apply) ;;
  *) echo "usage: $0 [--dry-run | --apply]" >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { echo "usage: $0 [--dry-run | --apply]" >&2; exit 2; }

MODE="${1:-}"; [ -n "$MODE" ] || MODE="--dry-run"

run() {  # run <cmd...>; prints in dry-run, executes otherwise
  if [ "$MODE" = "--dry-run" ]; then
    printf 'dry-run: %s\n' "$*"
  else
    "$@"
  fi
}

if [ "$MODE" = "--apply" ] && [ "$(id -u)" != "0" ]; then
  log "ERROR: installing needs root (run with sudo)"; exit 1
fi

log "installing owner control bot (unit -> $UNIT_DIR/$SERVICE)"
run install -m 644 "$HERE/$SERVICE" "$UNIT_DIR/$SERVICE"
run systemctl daemon-reload
run systemctl enable --now "$SERVICE"
if [ "$MODE" = "--dry-run" ]; then
  log "dry-run only. Re-run with --apply to install and start the service."
else
  log "installed. Check with: systemctl status '$SERVICE'; journalctl -u $SERVICE"
fi