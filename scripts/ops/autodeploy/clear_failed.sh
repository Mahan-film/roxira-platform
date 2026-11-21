#!/usr/bin/env bash
# Clear a failed-target marker from /root/deploy-state/autodeploy-failed-shas so
# roxira-autodeploy.timer will retry the target on its next run (T232).
#
# Usage:
#   scripts/ops/autodeploy/clear_failed.sh <sha-or-prefix>
#   scripts/ops/autodeploy/clear_failed.sh --all
set -euo pipefail

STATE_DIR="${AUTODEPLOY_STATE_DIR:-/root/deploy-state}"
FAILED_SHAS="$STATE_DIR/autodeploy-failed-shas"

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <sha-or-prefix|--all>" >&2
  exit 2
fi

if [ ! -f "$FAILED_SHAS" ]; then
  echo "no failed-target marker file at $FAILED_SHAS; nothing to clear"
  exit 0
fi

if [ "$1" = "--all" ]; then
  : >"$FAILED_SHAS"
  echo "cleared all failed-target markers in $FAILED_SHAS"
  exit 0
fi

PREFIX="$1"
if ! [[ "$PREFIX" =~ ^[0-9a-fA-F]{4,40}$ ]]; then
  echo "ERROR: expected a 4-40 char hex SHA prefix or --all, got: $PREFIX" >&2
  exit 2
fi

TMP="$(mktemp "${FAILED_SHAS}.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
grep -ivE "^${PREFIX}" "$FAILED_SHAS" >"$TMP" || true
mv "$TMP" "$FAILED_SHAS"
echo "cleared failed-target marker(s) matching ${PREFIX} in $FAILED_SHAS"
