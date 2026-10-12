#!/usr/bin/env bash
# Render the law-watch launchd agent for THIS Mac. Does NOT load it unless you pass --load.
# Usage: scripts/legal/install_law_watch_mac.sh [--load]
# Remove: launchctl bootout gui/$(id -u)/ir.roxira.lawwatch && rm ~/Library/LaunchAgents/ir.roxira.lawwatch.plist
# Needs the VPN OFF (ekhtebar.ir only answers Iranian IPs). E-mail: law_watch.py reads BACKUP_SMTP_* from
# ~/Secrets/roxira/roxira.env at runtime; this script never asks for or writes a password.
set -euo pipefail

LABEL="ir.roxira.lawwatch"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"

mkdir -p "$HOME/.roxira/law_watch" "$HOME/Library/LaunchAgents"
sed -e "s#__REPO__#${REPO}#g" -e "s#__HOME__#${HOME}#g" -e "s#__PYTHON__#${PY}#g" \
  "$REPO/deploy/launchd/${LABEL}.plist" > "$DEST"
plutil -lint "$DEST"
echo "rendered: $DEST"
echo "1) (e-mail uses BACKUP_SMTP_USER/PASS/NOTIFY_TO from ~/Secrets/roxira/roxira.env; skipped with a log line if absent)"
echo "2) dry check (VPN off):  $PY $REPO/scripts/legal/law_watch.py poll --since-days 2"
echo "3) load:  launchctl bootstrap gui/$(id -u) $DEST"
echo "   run now: launchctl kickstart -k gui/$(id -u)/${LABEL}"
if [ "${1:-}" = "--load" ]; then
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$DEST"
  echo "loaded ${LABEL}"
fi
