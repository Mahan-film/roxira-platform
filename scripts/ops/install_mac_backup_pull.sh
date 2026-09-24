#!/usr/bin/env bash
# Install the daily production-backup pull on the owner's Mac as a launchd agent.
# launchd runs a missed job once the Mac wakes, so a closed laptop at the scheduled time is fine.
#
# Usage: scripts/ops/install_mac_backup_pull.sh [HH]   (default hour: 10, local time)
# Remove: launchctl bootout gui/$(id -u)/net.roxira.backup-pull && rm ~/Library/LaunchAgents/net.roxira.backup-pull.plist

set -euo pipefail

HOUR="${1:-10}"
LABEL="net.roxira.backup-pull"
DEST="$HOME/RoxiraBackups"
BIN="$DEST/bin/pull_backups_to_mac.sh"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

mkdir -p "$DEST/bin" "$HOME/Library/LaunchAgents"
install -m 755 "$(dirname "$0")/pull_backups_to_mac.sh" "$BIN"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>${BIN}</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${HOUR}</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>${DEST}/launchd.out.log</string>
  <key>StandardErrorPath</key><string>${DEST}/launchd.err.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed ${LABEL}: daily at ${HOUR}:00 -> ${DEST}"
echo "run now: launchctl kickstart gui/$(id -u)/${LABEL}"
