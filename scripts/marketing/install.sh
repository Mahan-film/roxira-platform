#!/usr/bin/env bash
# Install the marketing timers: the publisher (every 15 min) and the weekly content cycle
# (Thu 08:00 UTC: plan next week's drafts then propose the Telegram ones). Runs ON the server as root.
# Dry-run by default: prints the plan only.
#   scripts/marketing/install.sh           # dry-run
#   scripts/marketing/install.sh --apply   # install units, create dirs, enable the timers
# Tokens go in /etc/roxira-marketing.env (chmod 600, NOT in the repo); see docs/marketing/SETUP.md.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UNIT_DIR="${MKT_UNIT_DIR:-/etc/systemd/system}"
STATE_DIR="${MKT_STATE_DIR:-/var/lib/roxira-marketing}"

case "${1:-}" in
  "" | --dry-run | --apply) ;;
  *) echo "usage: $0 [--dry-run | --apply]" >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { echo "usage: $0 [--dry-run | --apply]" >&2; exit 2; }
MODE="${1:-}"; [ -n "$MODE" ] || MODE="--dry-run"

run() {
  if [ "$MODE" = "--dry-run" ]; then printf 'dry-run: %s\n' "$*"; else "$@"; fi
}

if [ "$MODE" = "--apply" ] && [ "$(id -u)" != "0" ]; then
  echo "ERROR: installing needs root" >&2; exit 1
fi

run install -d -m 750 "$STATE_DIR" "$STATE_DIR/media"
run install -m 644 "$HERE/roxira-marketing-publish.service" "$UNIT_DIR/roxira-marketing-publish.service"
run install -m 644 "$HERE/roxira-marketing-publish.timer" "$UNIT_DIR/roxira-marketing-publish.timer"
run install -m 644 "$HERE/roxira-marketing-plan.service" "$UNIT_DIR/roxira-marketing-plan.service"
run install -m 644 "$HERE/roxira-marketing-plan.timer" "$UNIT_DIR/roxira-marketing-plan.timer"
run systemctl daemon-reload
run systemctl enable --now roxira-marketing-publish.timer
run systemctl enable --now roxira-marketing-plan.timer
if [ "$MODE" = "--dry-run" ]; then
  echo "dry-run only. Re-run with --apply. Posts still need owner approval in the bot; create"
  echo "$STATE_DIR/PAUSE to stop all publishing."
fi
