#!/usr/bin/env bash
# Install the roxira-taskq systemd service (task queue worker, factory F2). Dry-run unless --apply.
#   taskq_install.sh            show the unit and what would happen
#   taskq_install.sh --apply    write /etc/systemd/system/roxira-taskq.service, enable and start it
# Opens no port. Optional env for the service goes in /etc/roxira/taskq.env (TASKQ_STRONG_ALIAS=..., TASKQ_MAX_ATTEMPTS_PER_DAY=...).
set -euo pipefail

APPLY=0
case "${1:-}" in
  --apply) APPLY=1 ;;
  '') ;;
  *) echo "usage: $0 [--apply]" >&2; exit 2 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
UNIT=/etc/systemd/system/roxira-taskq.service
CONTENT="[Unit]
Description=Roxira agent task queue (taskq.py run)
After=network-online.target

[Service]
Type=simple
User=root
Nice=5
EnvironmentFile=-/etc/roxira/taskq.env
ExecStart=/usr/bin/python3 $HERE/taskq.py run --max-parallel 3
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
"

if [ "$APPLY" = 0 ]; then
  echo "[dry-run] would write $UNIT:"
  printf '%s\n' "$CONTENT"
  echo "[dry-run] would run: systemctl daemon-reload && systemctl enable --now roxira-taskq"
  echo "re-run with --apply to install"
  exit 0
fi

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
[ -f "$HERE/taskq.py" ] || { echo "taskq.py not found next to this script" >&2; exit 1; }
printf '%s\n' "$CONTENT" >"$UNIT"
systemctl daemon-reload
systemctl enable --now roxira-taskq
systemctl --no-pager status roxira-taskq | head -n 8 || true
