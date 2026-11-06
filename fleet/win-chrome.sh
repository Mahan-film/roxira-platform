#!/usr/bin/env bash
# win-chrome.sh start|stop -- headless Windows Chrome with CDP on 127.0.0.1:9333 and a throwaway profile.
# Playwright's own browser download gets 403 here. WSL networking is mirrored, so localhost is shared:
# chromium.connectOverCDP('http://127.0.0.1:9333') reaches this browser, and it reaches local dev servers.
P=9333; C="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
case "${1:-start}" in
  start) curl -s -m 2 "http://127.0.0.1:$P/json/version" >/dev/null && { echo running; exit 0; }
    (cd /mnt/c/Users/mahan && nohup "$C" --headless=new --disable-gpu --no-first-run --remote-debugging-port=$P --user-data-dir='C:\Users\mahan\AppData\Local\Temp\rx-cdp' about:blank </dev/null >/dev/null 2>&1 &)
    for i in $(seq 1 30); do curl -s -m 2 "http://127.0.0.1:$P/json/version" >/dev/null && { echo started; exit 0; }; read -t 1 </dev/zero || true; done; echo "no CDP"; exit 1;;
  stop) W=$(curl -s -m 3 "http://127.0.0.1:$P/json/version" | python3 -c 'import json,sys;print(json.load(sys.stdin)["webSocketDebuggerUrl"])' 2>/dev/null); [ -n "$W" ] || { echo "not running"; exit 0; }
    node -e 'const w=new WebSocket(process.argv[1]);w.onopen=()=>{w.send(JSON.stringify({id:1,method:"Browser.close"}));setTimeout(()=>process.exit(0),800)};w.onerror=()=>process.exit(0)' "$W"; curl -s -m 2 "http://127.0.0.1:$P/json/version" >/dev/null && { echo "stop failed"; exit 1; }
    echo stopped;;
esac
