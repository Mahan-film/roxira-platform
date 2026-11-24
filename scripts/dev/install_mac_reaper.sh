#!/usr/bin/env bash
# Install (or remove with --uninstall) the launchd job that runs scripts/dev/mac_worktree_reaper.py every 15 minutes.
set -euo pipefail
LABEL=ir.roxira.reaper
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="${ROXIRA_REPO:-$HOME/Developer/roxira-platform}"
if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true; rm -f "$PLIST"; echo "removed $LABEL"; exit 0
fi
PY="$(command -v python3)"
BIN="$HOME/.roxira/bin"; mkdir -p "$BIN"
# Copy the script to a stable path: the job must not depend on which branch the main checkout has checked out.
cp "$(cd "$(dirname "$0")" && pwd)/mac_worktree_reaper.py" "$BIN/mac_worktree_reaper.py"; chmod +x "$BIN/mac_worktree_reaper.py"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>$PY</string><string>$BIN/mac_worktree_reaper.py</string><string>--apply</string></array>
<key>StartInterval</key><integer>900</integer>
<key>RunAtLoad</key><true/>
<key>EnvironmentVariables</key><dict><key>ROXIRA_REPO</key><string>$REPO</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>StandardOutPath</key><string>$HOME/Library/Logs/roxira-reaper.out</string>
<key>StandardErrorPath</key><string>$HOME/Library/Logs/roxira-reaper.err</string>
</dict></plist>
P
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL (every 15 min). Log: ~/Library/Logs/roxira-reaper.log"
