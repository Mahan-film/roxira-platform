#!/usr/bin/env bash
# Install the nightly Qdrant Cloud replica units on the server (run as root on srv1).
# Dry-run by default; --apply copies the units and enables the timer. The job is a no-op
# until QDRANT_CLOUD_URL exists in /opt/roxira_platform/.env (scripts/ops/set_server_env.sh).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${SYSTEMD_DIR:-/etc/systemd/system}"
UNITS=(roxira-qdrant-replica.service roxira-qdrant-replica.timer)
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

for u in "${UNITS[@]}"; do
  [ -f "$HERE/$u" ] || { echo "missing $HERE/$u" >&2; exit 1; }
  if [ "$APPLY" = 1 ]; then
    install -m 0644 "$HERE/$u" "$DEST/$u"
    echo "installed $DEST/$u"
  else
    echo "would install $HERE/$u -> $DEST/$u"
  fi
done

if [ "$APPLY" = 1 ]; then
  if [ -z "${SKIP_SYSTEMCTL:-}" ]; then
    systemctl daemon-reload
    systemctl enable --now roxira-qdrant-replica.timer
    systemctl list-timers roxira-qdrant-replica.timer --no-pager || true
  fi
  echo "Test once (inert if QDRANT_CLOUD_URL unset): systemctl start roxira-qdrant-replica.service && journalctl -u roxira-qdrant-replica -n 20"
else
  echo "would: systemctl daemon-reload && systemctl enable --now roxira-qdrant-replica.timer"
  echo "(dry-run; re-run with --apply)"
fi
