#!/usr/bin/env bash
# Installs the daily cleanup as a launchd agent for the current user (03:30).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="$HOME/.local/bin/roxira-mac-cleanup"
plist="$HOME/Library/LaunchAgents/ir.roxira.mac-cleanup.plist"
install -m 755 "$here/mac_cleanup.sh" "$bin"
cat >"$plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ir.roxira.mac-cleanup</string>
  <key>ProgramArguments</key><array><string>$bin</string><string>--apply</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/roxira-mac-cleanup.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/roxira-mac-cleanup.log</string>
</dict></plist>
P
launchctl bootout "gui/$(id -u)/ir.roxira.mac-cleanup" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "installed: $plist"
