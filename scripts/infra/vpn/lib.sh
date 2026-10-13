#!/usr/bin/env bash
# Shared helpers for the Roxira emergency VPN scripts. Source, do not execute.
# Secrets are never echoed except by explicit "link" output to stdout.
ETC="${ROXIRA_VPN_ETC:-/etc/roxira/vpn}"
XRAY_BIN="${XRAY_BIN:-xray}"
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${ROXIRA_VPN_TEMPLATE:-$LIB_DIR/config.json.tpl}"
RESERVED_PORTS="22 80 443 2053 2096 3000 3001 3002 4000 4001 5432 6333 6379 6432 8000 8005 8888 11111 62789"

log() { printf '%s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }
need_root() { [ "${ROXIRA_VPN_SKIP_ROOT:-0}" = 1 ] || [ "$(id -u)" = 0 ] || die "run as root (sudo)"; }
valid_name() { [[ "$1" =~ ^[A-Za-z0-9_-]{1,32}$ ]] || die "client name must match [A-Za-z0-9_-]{1,32}"; }
valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1024 ] && [ "$1" -le 65535 ] || die "port must be 1024-65535"
  local p; for p in $RESERVED_PORTS; do [ "$p" = "$1" ] && die "port $1 is reserved (AGENTS.md section 7)"; done; return 0; }
valid_host() { [[ "$1" =~ ^[A-Za-z0-9.-]+$ ]] || die "invalid hostname: $1"; }

# settings.env holds non-secret settings: PORT DEST SNI HOST
load_settings() { [ -f "$ETC/settings.env" ] || die "not installed ($ETC/settings.env missing)"
  # shellcheck disable=SC1091
  . "$ETC/settings.env"; }
save_settings() { umask 077; { echo "PORT=$PORT"; echo "DEST=$DEST"; echo "SNI=$SNI"; echo "HOST=$HOST"; } >"$ETC/settings.env"; }

new_uuid() { if [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid; else uuidgen | tr '[:upper:]' '[:lower:]'; fi; }

# gen_reality_keys: writes reality.key (private) and reality.pub, short ids.
gen_reality_keys() {
  local out priv pub
  out="$("$XRAY_BIN" x25519)" || die "xray x25519 failed"
  priv="$(printf '%s\n' "$out" | sed -n 's/^Private *[Kk]ey: *//p')"
  pub="$(printf '%s\n' "$out" | sed -n -e 's/^Public *[Kk]ey: *//p' -e 's/^Password[^:]*: *//p' | head -1)"
  [ -n "$priv" ] && [ -n "$pub" ] || die "could not parse xray x25519 output"
  umask 077
  printf '%s\n' "$priv" >"$ETC/reality.key"
  printf '%s\n' "$pub" >"$ETC/reality.pub"
  { openssl rand -hex 8; openssl rand -hex 4; } >"$ETC/shortids"
}

# render_config: builds $ETC/config.json from template + state files.
render_config() {
  load_settings
  local clients="" sids="" f n u priv
  for f in "$ETC"/clients/*.uuid; do
    [ -e "$f" ] || continue
    n="$(basename "$f" .uuid)"; u="$(cat "$f")"
    [ -n "$clients" ] && clients="$clients,"$'\n'
    clients="$clients          { \"id\": \"$u\", \"flow\": \"xtls-rprx-vision\", \"email\": \"$n\" }"
  done
  [ -n "$clients" ] || die "no clients defined"
  while read -r f; do [ -n "$f" ] && sids="${sids:+$sids, }\"$f\""; done <"$ETC/shortids"
  priv="$(cat "$ETC/reality.key")"
  local tpl; tpl="$(cat "$TEMPLATE")"
  tpl="${tpl//__PORT__/$PORT}"; tpl="${tpl//__DEST__/$DEST}"; tpl="${tpl//__SNI__/$SNI}"
  tpl="${tpl//__PRIVATE_KEY__/$priv}"; tpl="${tpl//__SHORT_IDS__/$sids}"; tpl="${tpl//__CLIENTS__/$clients}"
  umask 077
  printf '%s\n' "$tpl" >"$ETC/config.new.json"
  if [ "${ROXIRA_VPN_SKIP_ROOT:-0}" != 1 ]; then chown root:xray-vpn "$ETC/config.new.json"; fi
  chmod 640 "$ETC/config.new.json"
  "$XRAY_BIN" run -test -c "$ETC/config.new.json" >/dev/null 2>&1 || { rm -f "$ETC/config.new.json"; die "xray rejected rendered config (not applied)"; }
  mv "$ETC/config.new.json" "$ETC/config.json"
}

restart_xray() { systemctl restart xray-vpn.service; }

# client_link NAME -> vless:// link for that client only
client_link() {
  load_settings
  local n="$1" f="$ETC/clients/$1.uuid" sid
  [ -f "$f" ] || die "no such client: $n"
  sid="$(head -1 "$ETC/shortids")"
  printf 'vless://%s@%s:%s?encryption=none&flow=xtls-rprx-vision&security=reality&sni=%s&fp=chrome&pbk=%s&sid=%s&type=tcp#%s\n' \
    "$(cat "$f")" "$HOST" "$PORT" "$SNI" "$(cat "$ETC/reality.pub")" "$sid" "roxira-$n"
}
print_link() { local l; l="$(client_link "$1")"; printf '%s\n' "$l"
  if command -v qrencode >/dev/null 2>&1; then printf '%s' "$l" | qrencode -t ANSIUTF8; fi; }
