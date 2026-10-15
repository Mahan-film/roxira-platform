#!/usr/bin/env bash
# Hourly cleanup of throwaway agent databases (timer roxira-agentdb-gc). ON srv1 as root; dry-run unless --apply.
set -euo pipefail
UNIT_DIR="${AGENTDB_UNIT_DIR:-/etc/systemd/system}"
SERVICE='[Unit]
Description=Drop agentdb_* databases older than 24 h
[Service]
Type=oneshot
ExecStart=/bin/bash /opt/roxira_platform/scripts/infra/agent_db/agent_db.sh gc --apply'
TIMER='[Unit]
Description=Hourly agentdb gc
[Timer]
OnCalendar=hourly
Persistent=true
[Install]
WantedBy=timers.target'
if [ "${1:-}" != "--apply" ]; then printf '%s\n\n%s\n\ndry-run: re-run with --apply\n' "$SERVICE" "$TIMER"; exit 0; fi
[ "$(id -u)" = 0 ] || { echo "--apply needs root" >&2; exit 1; }
printf '%s\n' "$SERVICE" > "$UNIT_DIR/roxira-agentdb-gc.service"
printf '%s\n' "$TIMER" > "$UNIT_DIR/roxira-agentdb-gc.timer"
systemctl daemon-reload && systemctl enable --now roxira-agentdb-gc.timer && echo installed
