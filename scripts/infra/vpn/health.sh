#!/usr/bin/env bash
# Read-only health check, one line per path. Never prints config contents, links, UUIDs, keys or the XHTTP path.
# Usage: health.sh                         on the server (needs the install state)
#        health.sh --external HOST [--port N] [--port2 N] [--cdn-host H]
#                                          from any machine: TCP/TLS reachability of each path from HERE.
#                                          Run it from a network inside Iran to see what is filtered.
# Exit code 0 only if every enabled path is OK.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
rc=0
ok() { log "OK   $*"; }
bad() { log "FAIL $*"; rc=1; }
have() { command -v "$1" >/dev/null 2>&1; }

# cert_covers HOST PORT SNI: true when the certificate served on that endpoint covers SNI (SAN or wildcard,
# via openssl x509 -checkhost), so a dest whose leaf CN is another name still passes.
cert_covers() { have openssl || return 0
  local out; out="$(echo | timeout 8 openssl s_client -connect "$1:$2" -servername "$3" 2>/dev/null | openssl x509 -noout -checkhost "$3" 2>/dev/null)" || true
  case "$out" in *"does match"*) return 0 ;; *) return 1 ;; esac; }

if [ "${1:-}" = "--external" ]; then
  host="${2:-}"; [ -n "$host" ] || die "usage: $0 --external HOST [--port N] [--port2 N] [--cdn-host H]"; shift 2
  p1=8443 p2="" cdn=""
  while [ $# -gt 0 ]; do case "$1" in --port) p1="$2"; shift ;; --port2) p2="$2"; shift ;; --cdn-host) cdn="$2"; shift ;;
    *) die "unknown arg: $1" ;; esac; shift; done
  valid_host "$host"
  tcp() { if have nc && nc -z -w 6 "$1" "$2" >/dev/null 2>&1; then return 0; fi; return 1; }
  if tcp "$host" "$p1"; then ok "path 1 reality   tcp $host:$p1 reachable"; else bad "path 1 reality   tcp $host:$p1 NOT reachable"; fi
  if [ -n "$p2" ]; then if tcp "$host" "$p2"; then ok "path 2 reality   tcp $host:$p2 reachable"; else bad "path 2 reality   tcp $host:$p2 NOT reachable"; fi; fi
  if [ -n "$cdn" ]; then valid_host "$cdn"
    code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "https://$cdn/" 2>/dev/null || true)"
    if [ -n "$code" ] && [ "$code" != 000 ]; then ok "path 3 xhttp/cdn https://$cdn answers (HTTP $code; 444/empty is normal)"; else bad "path 3 xhttp/cdn https://$cdn NOT reachable"; fi
  fi
  exit $rc
fi

load_settings
if systemctl is-active --quiet xray-vpn.service; then ok "service xray-vpn active"; else bad "service xray-vpn not active"; fi
if "$XRAY_BIN" run -test -c "$ETC/config.json" >/dev/null 2>&1; then ok "config test passed"; else bad "config test failed"; fi
have "$XRAY_BIN" && log "info xray: $("$XRAY_BIN" version 2>/dev/null | head -1)"

# REALITY paths: port listening, and the dest answers with its own certificate when probed with the SNI
# (that is exactly what REALITY relays to unauthenticated probes; a mismatch means dest is unreachable from here).
reality_check() { local label="$1" port="$2" sni="$3"
  if ! port_busy "$port"; then bad "$label port $port not listening"; return; fi
  have openssl || { ok "$label port $port listening (openssl missing: dest probe skipped)"; return; }
  if cert_covers 127.0.0.1 "$port" "$sni"; then ok "$label port $port listening, dest $sni answers with its own certificate"
  else bad "$label port $port listening but dest probe for $sni failed (dest down or REALITY not relaying)"; fi; }
reality_check "path 1 reality   " "$PORT" "$SNI"
if [ -n "$PORT2" ]; then reality_check "path 2 reality   " "$PORT2" "$SNI2"; else log "skip path 2 reality   (not enabled)"; fi

if [ -n "$XHTTP_PORT" ]; then
  if ! port_busy "$XHTTP_PORT"; then bad "path 3 xhttp/cdn xray port $XHTTP_PORT not listening"
  else
    vhost="${NGINX_VHOST_DIR:-/opt/roxira_platform/nginx/sandboxes}/roxira-vpn-xhttp.conf"
    if [ -f "$vhost" ]; then ok "path 3 xhttp/cdn xray port $XHTTP_PORT listening, nginx vhost present"; else bad "path 3 xhttp/cdn nginx vhost $vhost missing"; fi
    # Probe Xray directly on loopback: the secret path never reaches nginx access logs (Xray access log is off).
    # Any HTTP answer means the XHTTP inbound is serving; 404 etc. is not a failure, only no answer is.
    if have curl && [ -f "$ETC/xhttp.path" ]; then
      code="$(curl -s -o /dev/null -m 8 -w '%{http_code}' -H "Host: $XHTTP_HOST" "http://127.0.0.1:$XHTTP_PORT$(cat "$ETC/xhttp.path")" 2>/dev/null || true)"
      case "$code" in 000|"") bad "path 3 xhttp/cdn xray did not answer on loopback" ;; *) ok "path 3 xhttp/cdn xray answers on loopback (HTTP $code)" ;; esac
    fi
    if have docker && docker exec "${NGINX_CONTAINER:-roxira_nginx_prod}" nginx -t >/dev/null 2>&1; then ok "path 3 xhttp/cdn nginx config valid"
    elif have docker; then bad "path 3 xhttp/cdn nginx -t failed"; fi
  fi
else log "skip path 3 xhttp/cdn (not enabled)"; fi
log "note: this checks the server side only. Whether Iran can reach each path: health.sh --external HOST ... from a machine inside Iran, or the client's URL-test."
log "--- last 20 log lines (secrets redacted)"
journalctl -u xray-vpn.service -n 20 --no-pager 2>/dev/null \
  | sed -E 's/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/<uuid>/g; s/[A-Za-z0-9_-]{43}/<key>/g; s/vless:\/\/[^ ]+/<link>/g'
exit $rc
