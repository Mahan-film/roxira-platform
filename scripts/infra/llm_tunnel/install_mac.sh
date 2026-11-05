#!/usr/bin/env bash
# Install / remove the launchd agent ir.roxira.llm-tunnel (Mac): an ssh tunnel to the LLM gateway on srv1.
#   install_mac.sh [--uninstall]
# The gateway (LiteLLM, roxira_keypool) listens on srv1 127.0.0.1:4000 only. This agent forwards
# 127.0.0.1:${LLM_TUNNEL_PORT:-4181} on this Mac to it, so clients call http://127.0.0.1:4181/v1 with a virtual
# key and the request leaves from srv1's stable German IP (Groq/Gemini work there, a changing VPN IP does not).
# No public port is opened on srv1. ssh keeps the link alive (ServerAliveInterval) and launchd restarts it.
set -euo pipefail
LABEL=ir.roxira.llm-tunnel
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LPORT="${LLM_TUNNEL_PORT:-4181}"
RPORT="${LLM_TUNNEL_REMOTE_PORT:-4000}"
HOSTALIAS="${LLM_TUNNEL_HOST:-roxira-prod}"
LOGDIR="$HOME/Library/Logs/roxira-llm-tunnel"
if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true; rm -f "$PLIST"; echo "removed $LABEL"; exit 0
fi
if lsof -nP -iTCP:"$LPORT" -sTCP:LISTEN 2>/dev/null | grep -q . && ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "local port $LPORT is busy (lsof -nP -iTCP:$LPORT): stop what holds it first (AGENTS.md section 7)" >&2; exit 1
fi
mkdir -p "$LOGDIR" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/ssh</string><string>-N</string>
    <string>-o</string><string>BatchMode=yes</string>
    <string>-o</string><string>ExitOnForwardFailure=yes</string>
    <string>-o</string><string>ServerAliveInterval=15</string>
    <string>-o</string><string>ServerAliveCountMax=3</string>
    <string>-o</string><string>ConnectTimeout=15</string>
    <string>-L</string><string>127.0.0.1:$LPORT:127.0.0.1:$RPORT</string>
    <string>$HOSTALIAS</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGDIR/out.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/err.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
for _ in 1 2 3 4 5 6 7 8 9 10; do launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null && break; sleep 2; done
launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || { echo "launchd bootstrap failed" >&2; exit 1; }
echo "installed $LABEL: 127.0.0.1:$LPORT -> $HOSTALIAS:127.0.0.1:$RPORT. Check: curl -s http://127.0.0.1:$LPORT/health/liveliness"
