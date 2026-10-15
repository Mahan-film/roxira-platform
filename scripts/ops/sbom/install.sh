#!/usr/bin/env bash
# Install the daily SBOM scan (systemd service + timer roxira-sbom, 04:15 UTC). Runs ON srv1 as root.
# Usage: scripts/ops/sbom/install.sh [--apply]    (dry-run by default)
set -euo pipefail
UNIT_DIR="${SBOM_UNIT_DIR:-/etc/systemd/system}"
SERVICE='[Unit]
Description=Roxira SBOM + vulnerability summary (report-only)
After=docker.service
[Service]
Type=oneshot
ExecStart=/bin/bash /opt/roxira_platform/scripts/ops/sbom/sbom_scan.sh
Nice=10
CPUQuota=150%
TimeoutStartSec=1500'
TIMER='[Unit]
Description=Daily SBOM scan
[Timer]
OnCalendar=*-*-* 04:15:00 UTC
Persistent=true
[Install]
WantedBy=timers.target'
if [ "${1:-}" != "--apply" ]; then
  printf '# %s/roxira-sbom.service\n%s\n\n# %s/roxira-sbom.timer\n%s\n\ndry-run: re-run with --apply\n' \
    "$UNIT_DIR" "$SERVICE" "$UNIT_DIR" "$TIMER"
  exit 0
fi
[ "$(id -u)" = 0 ] || { echo "--apply needs root" >&2; exit 1; }
printf '%s\n' "$SERVICE" > "$UNIT_DIR/roxira-sbom.service"
printf '%s\n' "$TIMER" > "$UNIT_DIR/roxira-sbom.timer"
systemctl daemon-reload
systemctl enable --now roxira-sbom.timer
echo "installed; run once: systemctl start roxira-sbom.service; summary: /root/deploy-state/sbom/summary.txt"
