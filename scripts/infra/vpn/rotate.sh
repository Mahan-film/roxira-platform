#!/usr/bin/env bash
# Rotate port and/or dest/serverName and/or keys of path 1, or of path 2 (second REALITY) with the *2 flags.
# Dry-run by default.
# Usage: rotate.sh [--port N] [--dest host:443] [--sni name] [--keys] [--apply]
#        rotate.sh [--port2 N] [--dest2 host:443] [--sni2 name] [--keys2] [--apply]
set -euo pipefail
. "$(dirname "$0")/lib.sh"
apply=0 newport="" newdest="" newsni="" keys=0 newport2="" newdest2="" newsni2="" keys2=0
while [ $# -gt 0 ]; do case "$1" in
  --apply) apply=1 ;; --keys) keys=1 ;; --keys2) keys2=1 ;;
  --port2) newport2="$2"; shift ;; --dest2) newdest2="$2"; shift ;; --sni2) newsni2="$2"; shift ;;
  --port) newport="$2"; shift ;; --dest) newdest="$2"; shift ;; --sni) newsni="$2"; shift ;;
  *) die "unknown arg: $1" ;; esac; shift; done
load_settings
oldport="$PORT" oldport2="$PORT2"
port_clash() { local n="$1"; shift; local o; for o in "$@"; do [ "$o" = "$n" ] && die "port $n is already used by another VPN path"; done; return 0; }
if [ -n "$newport2$newdest2$newsni2" ] || [ "$keys2" = 1 ]; then [ -n "$PORT2" ] || die "path 2 is not enabled (run add_paths.sh first)"; fi
if [ -n "$newport2" ]; then valid_port "$newport2"; port_clash "$newport2" "$PORT" "$XHTTP_PORT"; PORT2="$newport2"; fi
if [ -n "$newdest2" ]; then valid_dest "$newdest2"; valid_host "${newdest2%%:*}"; DEST2="$newdest2"; [ -n "$newsni2" ] || SNI2="${newdest2%%:*}"; fi
if [ -n "$newsni2" ]; then valid_host "$newsni2"; SNI2="$newsni2"; fi
if [ "$PORT2" != "$oldport2" ] && ss -tln | grep -q ":$PORT2 "; then die "port $PORT2 is busy"; fi
if [ -n "$newport" ]; then valid_port "$newport"; port_clash "$newport" "$PORT2" "$XHTTP_PORT"; PORT="$newport"; fi
if [ -n "$newdest" ]; then valid_dest "$newdest"; valid_host "${newdest%%:*}"; DEST="$newdest"; [ -n "$newsni" ] || SNI="${newdest%%:*}"; fi
if [ -n "$newsni" ]; then valid_host "$newsni"; SNI="$newsni"; fi
if [ "$PORT" != "$oldport" ] && ss -tln | grep -q ":$PORT "; then die "port $PORT is busy"; fi
log "plan: port $oldport -> $PORT, dest=$DEST, sni=$SNI, new keys=$keys (new keys invalidate all old links)"
[ -z "$PORT2" ] || log "      path 2: port $oldport2 -> $PORT2, dest=$DEST2, sni=$SNI2, new keys=$keys2"
[ "$apply" = 1 ] || { log "dry-run: nothing changed. Re-run with --apply."; exit 0; }
need_root
bk="$(backup_state)"; log "state backup: $bk"
undo() { restore_state "$bk"; restart_xray || true; die "$1; previous state restored from $bk"; }
if [ "$keys" = 1 ]; then gen_reality_keys; fi
if [ "$keys2" = 1 ]; then gen_reality_keys 2; fi
save_settings
if ! ( render_config ); then restore_state "$bk"; die "config rejected; previous state restored from $bk"; fi
restart_xray
wait_up || undo "service or ports did not come up after restart"
if [ "$PORT" != "$oldport" ]; then
  ufw allow "$PORT/tcp" comment 'roxira-vpn xray reality' >/dev/null
  ufw delete allow "$oldport/tcp" >/dev/null 2>&1 || log "note: remove old ufw rule for $oldport manually"
fi
if [ "$PORT2" != "$oldport2" ]; then
  ufw allow "$PORT2/tcp" comment 'roxira-vpn xray reality 2' >/dev/null
  ufw delete allow "$oldport2/tcp" >/dev/null 2>&1 || log "note: remove old ufw rule for $oldport2 manually"
fi
for f in "$ETC"/clients/*.uuid; do print_link "$(basename "$f" .uuid)"; done
