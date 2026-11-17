#!/usr/bin/env bash
# Nightly WAL-G base backup + retention (roxira-walg-backup.timer, 02:20 UTC).
#   1. wal-g backup-push   (full base backup of enterprise_db's cluster, encrypted with libsodium, to R2 walg/)
#   2. wal-g delete retain FULL $WALG_RETAIN_FULL --confirm   (default 7; also drops WAL older than the oldest kept backup)
#   3. writes walg_base.env, clears the CHAIN_BROKEN flag on success, then runs walg_status.sh
# Usage: walg_nightly.sh [--dry-run]
set -euo pipefail
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ops/walg/walg_lib.sh
. "$here/walg_lib.sh"
load_walg_env

if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] docker exec -u postgres $WALG_CONTAINER wal-g backup-push \$PGDATA"
  echo "[dry-run] docker exec -u postgres $WALG_CONTAINER wal-g delete retain FULL $WALG_RETAIN_FULL --confirm"
  echo "[dry-run] write $WALG_BASE_FILE, then $here/walg_status.sh"
  exit 0
fi

mkdir -p "$WALG_STATE_DIR"
exec 9>"${WALG_LOCK_FILE:-/var/lock/roxira-walg-backup.lock}"
flock -n 9 || { log "another walg backup is running; exiting"; exit 0; }

started="$(date -u +%Y%m%dT%H%M%SZ)"
err=""
if ! docker exec -u postgres "$WALG_CONTAINER" sh -c 'wal-g backup-push "$PGDATA"' >/dev/null 2>"$WALG_STATE_DIR/walg_last_error.txt"; then
  err="backup-push failed: $(tail -c 300 "$WALG_STATE_DIR/walg_last_error.txt" | tr -d "'\n")"
elif ! walg_exec delete retain FULL "$WALG_RETAIN_FULL" --confirm >/dev/null 2>"$WALG_STATE_DIR/walg_last_error.txt"; then
  err="retention failed: $(tail -c 300 "$WALG_STATE_DIR/walg_last_error.txt" | tr -d "'\n")"
fi

if [ -z "$err" ]; then
  : >"$WALG_FLAG_DIR/CHAIN_BROKEN" 2>/dev/null || true   # a fresh base backup restarts the chain
  env_write "$WALG_BASE_FILE" "WALG_BASE_RESULT=OK" "WALG_BASE_LAST_OK=$started" "WALG_BASE_LAST_OK_EPOCH=$(date +%s)"
  log "walg base backup ok ($started)"
  "$here/walg_status.sh" || true
  exit 0
fi

# keep the last good time so the status script can still judge the age of the newest good base backup
prev_ok="" prev_epoch=0
if [ -r "$WALG_BASE_FILE" ]; then
  # shellcheck disable=SC1090
  . "$WALG_BASE_FILE"
  prev_ok="${WALG_BASE_LAST_OK:-}"; prev_epoch="${WALG_BASE_LAST_OK_EPOCH:-0}"
fi
env_write "$WALG_BASE_FILE" "WALG_BASE_RESULT=FAIL" "WALG_BASE_ERROR=$err" \
  "WALG_BASE_LAST_OK=$prev_ok" "WALG_BASE_LAST_OK_EPOCH=$prev_epoch"
alert "WALG base backup FAILED" "$err"
"$here/walg_status.sh" || true
exit 1
