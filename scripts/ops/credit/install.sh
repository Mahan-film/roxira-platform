#!/usr/bin/env bash
# Hourly OpenRouter credit watch (timer roxira-credit-watch). ON srv1 as root; dry-run unless --apply.
set -euo pipefail
UNIT_DIR="${CREDIT_UNIT_DIR:-/etc/systemd/system}"
SERVICE='[Unit]
Description=OpenRouter credit watch (owner bot alert when low)
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/roxira_platform/scripts/ops/credit/credit_watch.py'
TIMER='[Unit]
Description=Hourly OpenRouter credit watch
[Timer]
OnCalendar=hourly
Persistent=true
[Install]
WantedBy=timers.target'
if [ "${1:-}" != "--apply" ]; then printf '%s\n\n%s\n\ndry-run: re-run with --apply\n' "$SERVICE" "$TIMER"; exit 0; fi
[ "$(id -u)" = 0 ] || { echo "--apply needs root" >&2; exit 1; }
printf '%s\n' "$SERVICE" > "$UNIT_DIR/roxira-credit-watch.service"
printf '%s\n' "$TIMER" > "$UNIT_DIR/roxira-credit-watch.timer"
systemctl daemon-reload && systemctl enable --now roxira-credit-watch.timer && echo installed
