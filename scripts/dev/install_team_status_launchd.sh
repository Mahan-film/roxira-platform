#!/usr/bin/env bash
# Installs the daily team report as a launchd agent for the current user (09:00 local).
# It runs team_status.py here (needs `gh`) and sends the short text to Telegram through
# notify.py on the server. Use --uninstall to remove it.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="$HOME/.local/bin/roxira-team-status.py"
plist="$HOME/Library/LaunchAgents/ir.roxira.team-status.plist"
label="ir.roxira.team-status"
if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$plist" "$bin"
  echo "uninstalled: $label"
  exit 0
fi
mkdir -p "$HOME/.local/bin" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
install -m 755 "$here/team_status.py" "$bin"
cat >"$plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/python3</string><string>$bin</string>
    <string>--telegram-host</string><string>roxira-prod</string>
    <string>--out</string><string>$HOME/Library/Logs/roxira-team-status.md</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/roxira-team-status.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/roxira-team-status.log</string>
</dict></plist>
P
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "installed: $plist"
