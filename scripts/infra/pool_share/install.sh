#!/usr/bin/env bash
# Install / remove the launchd agent ir.roxira.pool-share (Mac only). Starts at login, restarts on failure.
#   install.sh [--uninstall]     ROXIRA_REPO=<checkout> to render from a specific checkout
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${ROXIRA_REPO:-$HOME/Developer/roxira-platform}"
LABEL=ir.roxira.pool-share; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if [ "${1:-}" = "--uninstall" ]; then launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true; rm -f "$PLIST"; docker rm -f pool-share >/dev/null 2>&1 || true; echo "removed $LABEL (db container + volume kept)"; exit 0; fi
mkdir -p "$HOME/Library/Logs/roxira-pool-share" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$REPO/scripts/infra/pool_share/pool_share.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>ROXIRA_REPO</key><string>$REPO</string>
    <key>POOL_SHARE_PORT</key><string>${POOL_SHARE_PORT:-4180}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/roxira-pool-share/out.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/roxira-pool-share/err.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
for _ in 1 2 3 4 5 6 7 8 9 10; do launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null && break; sleep 2; done  # bootout is async
launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || { echo "launchd bootstrap failed" >&2; exit 1; }
echo "installed $LABEL (repo $REPO). Logs: ~/Library/Logs/roxira-pool-share/"
