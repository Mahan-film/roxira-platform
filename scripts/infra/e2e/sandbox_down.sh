#!/usr/bin/env bash
# Remove the Gate 3 sandbox: the rxtest_* containers and the rxtest_net network. Idempotent.
#
#   sandbox_down.sh [PRUNE]
#
# Removes the session files (they hold short-lived tokens) from $RX_OUT. With PRUNE the rxtest-*:<sha> images
# are removed too (otherwise they stay as a build cache for the next run). Never touches any object whose name
# does not start with rxtest_ / rxtest-, so production containers, volumes and networks are untouched.
set -uo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

command -v docker >/dev/null 2>&1 || rx_die "docker not found"
rx_cleanup

# Session files and the extracted fixture only; sources stay as a cache keyed by commit sha.
for f in "$RX_OUT"/session.*.json "$RX_OUT"/app_e2e.env "$RX_OUT"/erp_multicurrency_small.sqlite; do
  [ -f "$f" ] && rm -f -- "$f"
done

if [ "${1:-}" = PRUNE ]; then
  docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '^rxtest-(be|deps|fe):' |
    while IFS= read -r img; do docker image rm -f "$img" >/dev/null 2>&1 || true; done
fi
rx_log "sandbox removed"
exit 0
