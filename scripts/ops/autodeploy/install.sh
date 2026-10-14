#!/usr/bin/env bash
# Install (or remove) the server-side auto-deploy systemd timer. Runs ON the production
# server; needs root for systemd and for /etc/roxira. Dry-run by default: it only prints
# the commands. Pass --yes to actually change the system. See docs/ops/AUTODEPLOY.md.
#
# Usage:
#   scripts/ops/autodeploy/install.sh            # dry-run (prints the plan)
#   scripts/ops/autodeploy/install.sh --yes      # install + enable the timer
#   scripts/ops/autodeploy/install.sh --disable  # remove the opt-in marker, stop the timer
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UNIT_DIR="${AUTODEPLOY_UNIT_DIR:-/etc/systemd/system}"
ENABLED_FILE="${AUTODEPLOY_ENABLED_FILE:-/etc/roxira/autodeploy.enabled}"
LOG_DIR="${AUTODEPLOY_LOG_DIR:-/var/log/roxira-autodeploy}"
SERVICE="roxira-autodeploy.service"
TIMER="roxira-autodeploy.timer"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

case "${1:-}" in
  ""|--dry-run|--yes|--disable) ;;
  *) echo "usage: $0 [--dry-run | --yes | --disable]" >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { echo "usage: $0 [--dry-run | --yes | --disable]" >&2; exit 2; }

MODE="${1:-}"; [ -n "$MODE" ] || MODE="--dry-run"

run() {  # run <cmd...>; prints in dry-run, executes otherwise
  if [ "$MODE" = "--dry-run" ]; then
    printf 'dry-run: %s\n' "$*"
  else
    "$@"
  fi
}

if [ "$MODE" = "--disable" ]; then
  log "disabling server-side auto-deploy"
  run systemctl disable --now "$TIMER" || true
  run rm -f "$ENABLED_FILE"
  run systemctl daemon-reload || true
  log "done: auto-deploy is off until re-installed with --yes"
  exit 0
fi

if [ "$(id -u)" != "0" ] && [ "$MODE" != "--dry-run" ]; then
  log "ERROR: installing needs root (run with sudo)"; exit 1
fi

log "installing server-side auto-deploy (units -> $UNIT_DIR, marker -> $ENABLED_FILE)"
run install -m 644 "$HERE/$SERVICE" "$UNIT_DIR/$SERVICE"
run install -m 644 "$HERE/$TIMER" "$UNIT_DIR/$TIMER"
run mkdir -p "$(dirname "$ENABLED_FILE")"
run touch "$ENABLED_FILE"
run mkdir -p "$LOG_DIR"
run systemctl daemon-reload
run systemctl enable --now "$TIMER"
if [ "$MODE" = "--dry-run" ]; then
  log "dry-run only. Re-run with --yes to install and start the timer."
else
  log "installed. Check with: systemctl list-timers '$TIMER'; journalctl -u $SERVICE"
  log "pause with: touch /opt/roxira_platform/.deploy-freeze"
fi
