#!/usr/bin/env bash
# Read-only health check. Never prints config contents or secrets.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
load_settings; rc=0
if systemctl is-active --quiet xray-vpn.service; then log "OK   service active"; else log "FAIL service not active"; rc=1; fi
if ss -tln 2>/dev/null | grep -q ":$PORT "; then log "OK   port $PORT listening"; else log "FAIL port $PORT not listening"; rc=1; fi
if "$XRAY_BIN" run -test -c "$ETC/config.json" >/dev/null 2>&1; then log "OK   config test passed"; else log "FAIL config test failed"; rc=1; fi
log "--- last 20 log lines (secrets redacted)"
journalctl -u xray-vpn.service -n 20 --no-pager 2>/dev/null \
  | sed -E 's/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/<uuid>/g; s/[A-Za-z0-9_-]{43}/<key>/g; s/vless:\/\/[^ ]+/<link>/g'
exit $rc
