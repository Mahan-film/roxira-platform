#!/usr/bin/env bash
# Manage VPN clients: vpn_client.sh add|remove|list|link NAME
set -euo pipefail
. "$(dirname "$0")/lib.sh"
cmd="${1:-}"; name="${2:-}"
case "$cmd" in
  list) need_root; for f in "$ETC"/clients/*.uuid; do [ -e "$f" ] && basename "$f" .uuid; done; exit 0 ;;
  add)
    need_root; valid_name "$name"; [ -e "$ETC/clients/$name.uuid" ] && die "client exists: $name"
    umask 077; new_uuid >"$ETC/clients/$name.uuid"
    render_config; restart_xray; print_link "$name" ;;
  remove)
    need_root; valid_name "$name"; [ -f "$ETC/clients/$name.uuid" ] || die "no such client: $name"
    [ "$(find "$ETC/clients" -name "*.uuid" | wc -l)" -gt 1 ] || die "refusing to remove the last client"
    rm -f "$ETC/clients/$name.uuid"; render_config; restart_xray; log "removed $name" ;;
  link) need_root; valid_name "$name"; print_link "$name" ;;
  *) die "usage: $0 add|remove|list|link NAME" ;;
esac
