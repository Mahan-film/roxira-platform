#!/usr/bin/env bash
# Shared helpers for the Roxira emergency VPN scripts. Source, do not execute.
# shellcheck disable=SC2153
# Secrets are never echoed except by explicit "link" output to stdout.
ETC="${ROXIRA_VPN_ETC:-/etc/xray-vpn}"   # not under /etc/roxira (0700 root): the xray-vpn user must traverse it
XRAY_BIN="${XRAY_BIN:-xray}"
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${ROXIRA_VPN_TEMPLATE:-$LIB_DIR/config.json.tpl}"
RESERVED_PORTS="22 80 443 2053 2096 3000 3001 3002 3005 4000 4001 5432 6333 6379 6432 8000 8005 8090 8888 11111 62789"

log() { printf '%s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }
need_root() { [ "${ROXIRA_VPN_SKIP_ROOT:-0}" = 1 ] || [ "$(id -u)" = 0 ] || die "run as root (sudo)"; }
valid_name() { [[ "$1" =~ ^[A-Za-z0-9_-]{1,32}$ ]] || die "client name must match [A-Za-z0-9_-]{1,32}"; }
valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1024 ] && [ "$1" -le 65535 ] || die "port must be 1024-65535"
  local p; for p in $RESERVED_PORTS; do [ "$p" = "$1" ] && die "port $1 is reserved (AGENTS.md section 7)"; done; return 0; }
valid_host() { [[ "$1" =~ ^[A-Za-z0-9.-]+$ ]] || die "invalid hostname: $1"; }

# settings.env holds non-secret settings: PORT DEST SNI HOST (path 1, REALITY) and the optional
# PORT2 DEST2 SNI2 (path 2, second REALITY) and XHTTP_PORT XHTTP_HOST (path 3, XHTTP via Cloudflare).
# An install without the optional keys keeps rendering exactly the single-inbound config.
load_settings() { [ -f "$ETC/settings.env" ] || die "not installed ($ETC/settings.env missing)"
  PORT2="" DEST2="" SNI2="" XHTTP_PORT="" XHTTP_HOST=""
  # shellcheck disable=SC1091
  . "$ETC/settings.env"; }
save_settings() { umask 077
  { echo "PORT=$PORT"; echo "DEST=$DEST"; echo "SNI=$SNI"; echo "HOST=$HOST"
    echo "PORT2=${PORT2:-}"; echo "DEST2=${DEST2:-}"; echo "SNI2=${SNI2:-}"
    echo "XHTTP_PORT=${XHTTP_PORT:-}"; echo "XHTTP_HOST=${XHTTP_HOST:-}"; } >"$ETC/settings.env"; }

# port_busy N: true when something already listens on tcp N.
port_busy() { ss -tln 2>/dev/null | grep ":$1 " >/dev/null; }  # no grep -q: SIGPIPE on ss would fail the pipeline under pipefail
# valid_new_port N: valid_port plus not taken by this VPN's other paths and not 8443 (path 1 default).
valid_new_port() { valid_port "$1"; [ "$1" != 8443 ] || die "port 8443 belongs to path 1"
  local p; for p in "${PORT:-}" "${PORT2:-}" "${XHTTP_PORT:-}"; do [ "$p" = "$1" ] && die "port $1 is already used by another VPN path"; done; return 0; }
# valid_dest HOST:PORT (REALITY dest must carry an explicit port)
valid_dest() { [[ "$1" =~ ^[A-Za-z0-9.-]+:[0-9]+$ ]] && [ "${1##*:}" -ge 1 ] && [ "${1##*:}" -le 65535 ] \
  || die "dest must be <host>:<port> (e.g. www.microsoft.com:443), got: $1"; }
# backup_state: copy settings, config, keys and the XHTTP path to $ETC/backup/<time>/ and print that dir.
STATE_FILES="settings.env config.json reality.key reality.pub shortids reality2.key reality2.pub shortids2 xhttp.path"
backup_state() { local d f; d="$ETC/backup/$(date +%Y%m%d-%H%M%S)"; install -d -m 700 "$d"
  for f in $STATE_FILES; do [ -f "$ETC/$f" ] && cp -p "$ETC/$f" "$d/"; done; echo "$d"; }
restore_state() { local f; for f in $STATE_FILES; do [ -f "$1/$f" ] && cp -p "$1/$f" "$ETC/$f"; done; return 0; }
# wait_up: service active and every enabled path port listening within ROXIRA_VPN_WAIT (default 10) seconds
wait_up() { local i=0 ok p
  while [ "$i" -le "${ROXIRA_VPN_WAIT:-10}" ]; do
    load_settings; ok=1; systemctl is-active --quiet xray-vpn.service || ok=0
    for p in "$PORT" "$PORT2" "$XHTTP_PORT"; do [ -z "$p" ] || port_busy "$p" || ok=0; done
    [ "$ok" = 1 ] && return 0; sleep 1; i=$((i + 1)); done; return 1; }
sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
b64() { base64 | tr -d '\n'; }
xray_asset() { case "$(uname -m)" in aarch64|arm64) echo Xray-linux-arm64-v8a.zip ;; x86_64|amd64) echo Xray-linux-64.zip ;; *) die "unsupported arch $(uname -m)" ;; esac; }

new_uuid() { if [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid; else uuidgen | tr '[:upper:]' '[:lower:]'; fi; }

# gen_reality_keys [SUFFIX]: writes reality<SUFFIX>.key (private), reality<SUFFIX>.pub, shortids<SUFFIX>.
# Path 2 passes "2" so its key pair is independent of path 1.
gen_reality_keys() {
  local sx="${1:-}" out priv pub
  out="$("$XRAY_BIN" x25519)" || die "xray x25519 failed"
  priv="$(printf '%s\n' "$out" | sed -n 's/^Private *[Kk]ey: *//p')"
  pub="$(printf '%s\n' "$out" | sed -n -e 's/^Public *[Kk]ey: *//p' -e 's/^Password[^:]*: *//p' | head -1)"
  [ -n "$priv" ] && [ -n "$pub" ] || die "could not parse xray x25519 output"
  umask 077
  printf '%s\n' "$priv" >"$ETC/reality$sx.key"
  printf '%s\n' "$pub" >"$ETC/reality$sx.pub"
  { openssl rand -hex 8; openssl rand -hex 4; } >"$ETC/shortids$sx"
}

# render_config: builds $ETC/config.json from template + state files. Path 2 / path 3 inbound fragments
# (inbound_reality2.json.tpl, inbound_xhttp.json.tpl) are appended only when their settings are present.
render_config() {
  load_settings
  local clients="" plain="" sids="" sids2="" f n u priv extra="" frag
  for f in "$ETC"/clients/*.uuid; do
    [ -e "$f" ] || continue
    n="$(basename "$f" .uuid)"; u="$(cat "$f")"
    [ -n "$clients" ] && clients="$clients,"$'\n' && plain="$plain,"$'\n'
    clients="$clients          { \"id\": \"$u\", \"flow\": \"xtls-rprx-vision\", \"email\": \"$n\" }"
    plain="$plain          { \"id\": \"$u\", \"email\": \"$n\" }"
  done
  [ -n "$clients" ] || die "no clients defined"
  while read -r f; do [ -n "$f" ] && sids="${sids:+$sids, }\"$f\""; done <"$ETC/shortids"
  priv="$(cat "$ETC/reality.key")"
  _fill() { local t="$1"
    t="${t//__PORT__/$PORT}"; t="${t//__DEST__/$DEST}"; t="${t//__SNI__/$SNI}"
    t="${t//__PRIVATE_KEY__/$priv}"; t="${t//__SHORT_IDS__/$sids}"
    t="${t//__PORT2__/${PORT2:-}}"; t="${t//__DEST2__/${DEST2:-}}"; t="${t//__SNI2__/${SNI2:-}}"
    t="${t//__PRIVATE_KEY2__/${priv2:-}}"; t="${t//__SHORT_IDS2__/${sids2:-}}"
    t="${t//__XHTTP_PORT__/${XHTTP_PORT:-}}"; t="${t//__XHTTP_HOST__/${XHTTP_HOST:-}}"
    t="${t//__XHTTP_PATH__/${xpath:-}}"
    t="${t//__CLIENTS_PLAIN__/$plain}"; t="${t//__CLIENTS__/$clients}"; printf '%s' "$t"; }
  local priv2="" xpath=""
  if [ -n "${PORT2:-}" ]; then
    [ -f "$ETC/reality2.key" ] || die "path 2 configured but $ETC/reality2.key is missing"
    priv2="$(cat "$ETC/reality2.key")"
    while read -r f; do [ -n "$f" ] && sids2="${sids2:+$sids2, }\"$f\""; done <"$ETC/shortids2"
    frag="$(_fill "$(cat "${TEMPLATE%/*}/inbound_reality2.json.tpl")")"; extra="$extra,"$'\n'"$frag"
  fi
  if [ -n "${XHTTP_PORT:-}" ]; then
    [ -f "$ETC/xhttp.path" ] || die "path 3 configured but $ETC/xhttp.path is missing"
    xpath="$(cat "$ETC/xhttp.path")"
    frag="$(_fill "$(cat "${TEMPLATE%/*}/inbound_xhttp.json.tpl")")"; extra="$extra,"$'\n'"$frag"
  fi
  local tpl; tpl="$(cat "$TEMPLATE")"
  tpl="${tpl//__EXTRA_INBOUNDS__/$extra}"
  tpl="$(_fill "$tpl")"
  umask 077
  printf '%s\n' "$tpl" >"$ETC/config.new.json"
  if [ "${ROXIRA_VPN_SKIP_ROOT:-0}" != 1 ]; then chown root:xray-vpn "$ETC/config.new.json"; fi
  chmod 640 "$ETC/config.new.json"
  "$XRAY_BIN" run -test -c "$ETC/config.new.json" >/dev/null 2>&1 || { rm -f "$ETC/config.new.json"; die "xray rejected rendered config (not applied)"; }
  mv "$ETC/config.new.json" "$ETC/config.json"
}

restart_xray() { systemctl restart xray-vpn.service; }

# enabled_paths: space-separated list of configured paths: reality reality2 xhttp
enabled_paths() { load_settings; local o="reality"
  [ -n "${PORT2:-}" ] && o="$o reality2"; [ -n "${XHTTP_PORT:-}" ] && o="$o xhttp"; echo "$o"; }

# client_link NAME [PATH] -> vless:// link for that client and path (default reality = path 1)
client_link() {
  load_settings
  local n="$1" kind="${2:-reality}" f="$ETC/clients/$1.uuid" xp
  [ -f "$f" ] || die "no such client: $n"
  case "$kind" in
    reality)
      printf 'vless://%s@%s:%s?encryption=none&flow=xtls-rprx-vision&security=reality&sni=%s&fp=chrome&pbk=%s&sid=%s&type=tcp#%s\n' \
        "$(cat "$f")" "$HOST" "$PORT" "$SNI" "$(cat "$ETC/reality.pub")" "$(head -1 "$ETC/shortids")" "roxira-$n" ;;
    reality2)
      [ -n "${PORT2:-}" ] || die "path 2 (second REALITY) is not enabled"
      printf 'vless://%s@%s:%s?encryption=none&flow=xtls-rprx-vision&security=reality&sni=%s&fp=chrome&pbk=%s&sid=%s&type=tcp#%s\n' \
        "$(cat "$f")" "$HOST" "$PORT2" "$SNI2" "$(cat "$ETC/reality2.pub")" "$(head -1 "$ETC/shortids2")" "roxira-$n-r2" ;;
    xhttp)
      [ -n "${XHTTP_PORT:-}" ] || die "path 3 (XHTTP via Cloudflare) is not enabled"
      xp="$(cat "$ETC/xhttp.path")"; xp="${xp//\//%2F}"
      printf 'vless://%s@%s:443?encryption=none&security=tls&sni=%s&alpn=h2&fp=chrome&type=xhttp&host=%s&path=%s&mode=auto#%s\n' \
        "$(cat "$f")" "$XHTTP_HOST" "$XHTTP_HOST" "$XHTTP_HOST" "$xp" "roxira-$n-cdn" ;;
    *) die "unknown path: $kind" ;;
  esac
}
# print_link NAME: one link per enabled path (stdout only), QR for path 1 when qrencode exists
print_link() { local k l first=1
  for k in $(enabled_paths); do l="$(client_link "$1" "$k")"; printf '%s\n' "$l"
    if [ "$first" = 1 ] && command -v qrencode >/dev/null 2>&1; then printf '%s' "$l" | qrencode -t ANSIUTF8; fi
    first=0; done; }
