#!/usr/bin/env bash
# Install the daily Mac pull as launchd agent ir.roxira.backup-pull.
# Usage: install_mac_pull.sh [--dry-run] [HOUR]   (default 10, local time)
# Does not touch the legacy agent net.roxira.backup-pull; unload it by hand once this one works:
#   launchctl bootout gui/$(id -u)/net.roxira.backup-pull
set -euo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && { DRY_RUN=1; shift; }
HOUR="${1:-10}"
[[ "$HOUR" =~ ^([0-9]|1[0-9]|2[0-3])$ ]] || { echo "HOUR must be an integer 0-23 (got '$HOUR')" >&2; exit 1; }
LABEL="ir.roxira.backup-pull"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$HERE/../../../deploy/launchd/${LABEL}.plist.template"
DEST="$HOME/Backups/roxira-dr"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] install mac_pull.sh -> $DEST/bin/, render $TEMPLATE -> $PLIST (hour $HOUR), launchctl bootstrap gui/$(id -u)"
  exit 0
fi
mkdir -p "$DEST/bin" "$HOME/Library/LaunchAgents"
install -m 755 "$HERE/mac_pull.sh" "$DEST/bin/mac_pull.sh"
# plain bash substitution (no sed, so $HOME containing # & \ is safe); XML-escape the path for the plist
xml_home="${HOME//&/&amp;}"; xml_home="${xml_home//</&lt;}"; xml_home="${xml_home//>/&gt;}"
plist_body="$(cat "$TEMPLATE")"
plist_body="${plist_body//__HOME__/$xml_home}"
plist_body="${plist_body//__HOUR__/$((10#$HOUR))}"
printf '%s\n' "$plist_body" >"$PLIST"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed ${LABEL}: daily at ${HOUR}:15; run now: launchctl kickstart gui/$(id -u)/${LABEL}"
