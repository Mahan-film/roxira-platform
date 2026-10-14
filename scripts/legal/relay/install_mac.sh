#!/usr/bin/env bash
# Render and (with --yes) install the Iran relay LaunchAgent for THIS Mac.
# Dry-run is the default: it renders the plist to a temp file and prints what it would do.
#
# Usage: scripts/legal/relay/install_mac.sh [--yes]
#
# Needs the VPN OFF (foreign IPs are refused by regulation.tax.gov.ir / dotic.ir / rc.majlis.ir)
# for at least one run every 12 h. No secrets are read or written.
#
# Uninstall:
#   launchctl bootout "gui/$(id -u)/ir.roxira.iranrelay" 2>/dev/null || true
#   rm -f ~/Library/LaunchAgents/ir.roxira.iranrelay.plist
set -euo pipefail

LABEL="ir.roxira.iranrelay"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
TEMPLATE="$REPO/scripts/legal/relay/${LABEL}.plist.template"

mkdir -p "$HOME/.roxira/iran_relay"

render_to() {
  sed -e "s#__REPO__#${REPO}#g" -e "s#__HOME__#${HOME}#g" -e "s#__PYTHON__#${PY}#g" "$TEMPLATE" > "$1"
}

echo "repo:     $REPO"
echo "python:   $PY"
echo "template: $TEMPLATE"
echo "target:   $DEST"
echo "schedule: Sat-Thu 09:30 and 11:00 Tehran time (gov sites open in office hours); VPN must be OFF then"
echo

if [ "${1:-}" != "--yes" ]; then
  TMP="$(mktemp)"
  render_to "$TMP"
  echo "--- would render (dry-run; nothing installed) ---"
  cat "$TMP"
  rm -f "$TMP"
  echo "--- end dry-run ---"
  echo "re-run with --yes to install into ~/Library/LaunchAgents and load it."
  echo "uninstall: launchctl bootout gui/$(id -u)/${LABEL}; rm -f $DEST"
  exit 0
fi

render_to "$DEST"
plutil -lint "$DEST"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
echo "loaded ${LABEL}"
echo "run now:   launchctl kickstart -k gui/$(id -u)/${LABEL}"
echo "logs:      $HOME/.roxira/iran_relay/{out,err}.log"
echo "uninstall: launchctl bootout gui/$(id -u)/${LABEL}; rm -f $DEST"
