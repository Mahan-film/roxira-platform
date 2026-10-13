#!/usr/bin/env bash
# Rotate port and/or dest/serverName and/or keys. Dry-run by default.
# Usage: rotate.sh [--port N] [--dest host:443] [--sni name] [--keys] [--apply]
set -euo pipefail
. "$(dirname "$0")/lib.sh"
apply=0 newport="" newdest="" newsni="" keys=0
while [ $# -gt 0 ]; do case "$1" in
  --apply) apply=1 ;; --keys) keys=1 ;;
  --port) newport="$2"; shift ;; --dest) newdest="$2"; shift ;; --sni) newsni="$2"; shift ;;
  *) die "unknown arg: $1" ;; esac; shift; done
load_settings
oldport="$PORT"
if [ -n "$newport" ]; then valid_port "$newport"; PORT="$newport"; fi
if [ -n "$newdest" ]; then valid_host "${newdest%%:*}"; DEST="$newdest"; [ -n "$newsni" ] || SNI="${newdest%%:*}"; fi
if [ -n "$newsni" ]; then valid_host "$newsni"; SNI="$newsni"; fi
if [ "$PORT" != "$oldport" ] && ss -tln | grep -q ":$PORT "; then die "port $PORT is busy"; fi
log "plan: port $oldport -> $PORT, dest=$DEST, sni=$SNI, new keys=$keys (new keys invalidate all old links)"
[ "$apply" = 1 ] || { log "dry-run: nothing changed. Re-run with --apply."; exit 0; }
need_root
if [ "$keys" = 1 ]; then gen_reality_keys; fi
save_settings; render_config
if [ "$PORT" != "$oldport" ]; then
  ufw allow "$PORT/tcp" comment 'roxira-vpn xray reality' >/dev/null
  ufw delete allow "$oldport/tcp" >/dev/null 2>&1 || log "note: remove old ufw rule for $oldport manually"
fi
restart_xray
for f in "$ETC"/clients/*.uuid; do print_link "$(basename "$f" .uuid)"; done
