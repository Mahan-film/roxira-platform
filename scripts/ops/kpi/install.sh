#!/usr/bin/env bash
# Install (or remove) the weekly KPI report timer (factory F7). Runs ON the production server.
# Dry-run by default: it prints the plan and changes nothing. See docs/ops/OBSERVABILITY.md.
#
# Usage:
#   scripts/ops/kpi/install.sh            # dry-run (prints the plan, previews the next run)
#   sudo scripts/ops/kpi/install.sh --yes # install the units and enable the Friday 06:00 UTC timer
#   sudo scripts/ops/kpi/install.sh --disable  # stop and disable the timer (units stay on disk)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UNIT_DIR="${KPI_UNIT_DIR:-/etc/systemd/system}"
ENV_FILE="${KPI_ENV_FILE:-/etc/roxira/kpi.env}"
SERVICE="roxira-kpi-weekly.service"
TIMER="roxira-kpi-weekly.timer"

log() { printf '[kpi] %s\n' "$*"; }

MODE="${1:---dry-run}"
case "$MODE" in
  --dry-run|--yes|--disable) ;;
  *) echo "usage: $0 [--dry-run | --yes | --disable]" >&2; exit 2 ;;
esac

run() {  # run <cmd...>: printed in dry-run, executed otherwise
  if [ "$MODE" = "--dry-run" ]; then
    printf 'dry-run: %s\n' "$*"
  else
    "$@"
  fi
}

if [ "$MODE" = "--disable" ]; then
  log "disabling the weekly KPI report timer"
  run systemctl disable --now "$TIMER" || true
  run systemctl daemon-reload || true
  log "done: re-install with --yes"
  exit 0
fi

if [ "$(id -u)" != "0" ] && [ "$MODE" != "--dry-run" ]; then
  log "ERROR: installing needs root (run with sudo)"
  exit 1
fi

if [ -r "$ENV_FILE" ]; then
  log "env file present: $ENV_FILE (values not read)"
else
  log "WARNING: $ENV_FILE missing: the Umami section will say 'not configured'. Create it from kpi.env.example (mode 600)."
fi

if command -v python3 >/dev/null 2>&1; then
  log "python3: $(command -v python3)"
else
  log "WARNING: python3 not found: the timer would fail"
fi

log "installing weekly KPI report timer (units -> $UNIT_DIR)"
run install -m 644 "$HERE/$SERVICE" "$UNIT_DIR/$SERVICE"
run install -m 644 "$HERE/$TIMER" "$UNIT_DIR/$TIMER"
run systemctl daemon-reload
run systemctl enable --now "$TIMER"

if [ "$MODE" = "--dry-run" ]; then
  if command -v systemd-analyze >/dev/null 2>&1; then
    systemd-analyze calendar "Fri *-*-* 06:00:00 UTC" 2>/dev/null | sed -n '1,2p' | sed 's/^/[kpi] next run preview: /' || true
  fi
  log "dry-run only. Re-run with --yes (as root) to install and start the timer."
else
  log "installed. Check with: systemctl list-timers '$TIMER'"
  log "manual run (sends to the bot): systemctl start $SERVICE; or --dry-run for a preview"
fi
