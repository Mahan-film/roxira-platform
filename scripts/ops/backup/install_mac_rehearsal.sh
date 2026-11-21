#!/usr/bin/env bash
# Install the weekly Mac restore rehearsal as launchd agent ir.roxira.restore-rehearsal (T198).
# Usage: install_mac_rehearsal.sh [--dry-run]     (Sunday 11:30 local time; edit the template to change it)
# The agent runs scripts/ops/backup/mac_restore_rehearsal.sh straight from this repo checkout, so keep the
# checkout where it is (it needs r2_tools.py, offsite_lib.sh and scripts/ops/notify/notify.py next to it).
set -euo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
LABEL="ir.roxira.restore-rehearsal"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
TEMPLATE="$REPO/deploy/launchd/${LABEL}.plist.template"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] render $TEMPLATE -> $PLIST (__HOME__=$HOME, __REPO__=$REPO), launchctl bootstrap gui/$(id -u)"
  exit 0
fi
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Backups/roxira-dr"
xml_escape() { local v="${1//&/&amp;}"; v="${v//</&lt;}"; printf '%s' "${v//>/&gt;}"; }
body="$(cat "$TEMPLATE")"
body="${body//__HOME__/$(xml_escape "$HOME")}"
body="${body//__REPO__/$(xml_escape "$REPO")}"
printf '%s\n' "$body" >"$PLIST"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed ${LABEL}: Sundays 11:30; run now: launchctl kickstart gui/$(id -u)/${LABEL}"
