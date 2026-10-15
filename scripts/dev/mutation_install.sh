#!/usr/bin/env bash
# Install the weekly mutation-testing systemd service + timer (roxira-mutation-weekly).
# Dry-run by default: it only prints the unit files it would write and the commands it
# would run. Pass --apply to actually write them and start the timer (needs root).
#
# The timer fires every Sunday at 02:00 UTC. The service runs
# /opt/roxira_platform/scripts/dev/mutation_weekly.sh at Nice=10 and CPUQuota=150% so the
# weekly run never competes with production. See docs/ops/MUTATION_TESTING.md.
#
# Usage:
#   bash scripts/dev/mutation_install.sh           # print the plan, change nothing
#   sudo bash scripts/dev/mutation_install.sh --apply   # install + enable the timer
set -euo pipefail

UNIT_DIR="${MUTATION_UNIT_DIR:-/etc/systemd/system}"
SERVICE="roxira-mutation-weekly.service"
TIMER="roxira-mutation-weekly.timer"
# Invoke through bash so the script does not need the executable bit.
EXEC="/bin/bash /opt/roxira_platform/scripts/dev/mutation_weekly.sh"

usage() { sed -n '2,13p' "$0"; }

case "${1:-}" in
  ""|--dry-run) MODE="dry-run" ;;
  --apply) MODE="apply" ;;
  -h|--help) usage; exit 0 ;;
  *) echo "usage: $0 [--apply]" >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { echo "usage: $0 [--apply]" >&2; exit 2; }

service_unit() {
  cat <<EOF
[Unit]
Description=Roxira weekly mutation testing of the legal data scripts (report-only)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/roxira_platform
ExecStart=$EXEC
User=root
Nice=10
CPUQuota=150%
# The script wraps itself in \`timeout 45m\`; give systemd a little headroom so the
# script's own timeout wins and can still append the summary.
TimeoutStartSec=3300
EOF
}

timer_unit() {
  cat <<EOF
[Unit]
Description=Run roxira-mutation-weekly.service every Sunday 02:00 UTC

[Timer]
OnCalendar=Sun *-*-* 02:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF
}

if [ "$MODE" = "dry-run" ]; then
  echo "dry-run: nothing changed. Re-run with --apply to install."
  echo
  echo "# $UNIT_DIR/$SERVICE"
  service_unit
  echo
  echo "# $UNIT_DIR/$TIMER"
  timer_unit
  echo
  echo "# then:"
  echo "systemctl daemon-reload"
  echo "systemctl enable --now $TIMER"
  echo "systemctl list-timers '$TIMER'"
  exit 0
fi

[ "$(id -u)" = "0" ] || { echo "ERROR: --apply needs root" >&2; exit 1; }

tmp="$(mktemp)"
service_unit > "$tmp"
install -m 644 "$tmp" "$UNIT_DIR/$SERVICE"
timer_unit > "$tmp"
install -m 644 "$tmp" "$UNIT_DIR/$TIMER"
rm -f "$tmp"

systemctl daemon-reload
systemctl enable --now "$TIMER"
echo "installed $SERVICE + $TIMER"
echo "check: systemctl list-timers '$TIMER'; journalctl -u $SERVICE"
