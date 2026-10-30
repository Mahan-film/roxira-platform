#!/usr/bin/env bash
# Print one client's link set for importing as a subscription (stdout only; links are secrets).
# Usage: subscription.sh NAME [--plain] [--write]
#   default: base64 text of the links (the standard subscription body Hiddify, v2rayNG, v2rayN accept;
#            paste it into the app: Add from clipboard)
#   --plain: the raw links, one per line (same content, easier to eyeball paths)
#   --write: also save the base64 body to $ETC/subscription/NAME.txt (mode 600) for serving by hand
# Each path has its own remark (roxira-NAME, -r2, -cdn); the app's URL-test / "auto" mode then picks the
# fastest one that works and falls over when one is blocked.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
name="${1:-}"; shift || true; plain=0 write=0
while [ $# -gt 0 ]; do case "$1" in --plain) plain=1 ;; --write) write=1 ;; *) die "unknown arg: $1" ;; esac; shift; done
need_root; valid_name "$name"
links=""; for k in $(enabled_paths); do links="$links$(client_link "$name" "$k")"$'\n'; done
if [ "$plain" = 1 ]; then printf '%s' "$links"; else printf '%s' "$links" | b64; echo; fi
if [ "$write" = 1 ]; then
  umask 077; install -d -m 700 "$ETC/subscription"
  printf '%s' "$links" | b64 >"$ETC/subscription/$name.txt"; log "saved $ETC/subscription/$name.txt"
fi
