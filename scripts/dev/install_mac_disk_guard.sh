#!/usr/bin/env bash
# Install the daily Mac disk guard (launchd agent ir.roxira.diskguard, 10:15 local time and at login).
# Usage: install_mac_disk_guard.sh [--uninstall]
set -euo pipefail
LABEL="ir.roxira.diskguard"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SRC="$(cd "$(dirname "$0")" && pwd)/mac_disk_guard.sh"
DEST="$HOME/.local/bin/roxira-disk-guard.sh"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST" "$DEST"; echo "removed"; exit 0
fi

mkdir -p "$HOME/.local/bin" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
# Copy, so the job does not depend on a worktree that may be removed.
cp "$SRC" "$DEST"; chmod +x "$DEST"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DEST</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>15</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/roxira-disk-guard.out</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/roxira-disk-guard.out</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL; log: ~/Library/Logs/roxira-disk-guard.log"
