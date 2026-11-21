#!/bin/sh
# archive_command wrapper: walg-archive %p
# - bounded time: a stalled upload is killed after WALG_PUSH_TIMEOUT_S (Postgres retries the segment).
# - disk guard: Postgres keeps every un-archived segment in pg_wal. If pg_wal grows past WALG_SPOOL_MAX_MB the
#   guard raises a flag (host status script alerts on Telegram) and, by default, DROPS the segment (exit 0) so the
#   primary never fills its disk and crashes. That breaks the PITR chain until the next base backup; the flag
#   CHAIN_BROKEN says so. WALG_SPOOL_ON_OVERFLOW=fail keeps the segment instead (safe for PITR, unsafe for disk).
# Flags live in WALG_STATE_DIR (bind mount, host /var/lib/roxira-backup/walg). No secrets are read or printed here.
set -u
seg="${1:?usage: walg-archive <wal path>}"
state="${WALG_STATE_DIR:-/walg-state}"
pgwal="${PGDATA:-/var/lib/postgresql/data}/pg_wal"
max_mb="${WALG_SPOOL_MAX_MB:-3072}"
warn_mb=$((max_mb / 2))
tmo="${WALG_PUSH_TIMEOUT_S:-45}"
mode="${WALG_SPOOL_ON_OVERFLOW:-drop}"

used_mb="$(du -sm "$pgwal" 2>/dev/null | cut -f1)"
used_mb="${used_mb:-0}"

if [ "$used_mb" -ge "$max_mb" ]; then
  printf 'pg_wal=%sMB limit=%sMB mode=%s at %s\n' "$used_mb" "$max_mb" "$mode" "$(date -u +%FT%TZ)" >"$state/SPOOL_OVER" 2>/dev/null || true
  if [ "$mode" = "drop" ]; then
    printf 'dropped %s at %s\n' "$(basename "$seg")" "$(date -u +%FT%TZ)" >>"$state/CHAIN_BROKEN" 2>/dev/null || true
    echo "walg-archive: pg_wal ${used_mb}MB >= ${max_mb}MB, dropping $(basename "$seg") to protect the disk (PITR chain broken)" >&2
    exit 0
  fi
  echo "walg-archive: pg_wal ${used_mb}MB >= ${max_mb}MB, archiving still failing (mode=fail)" >&2
elif [ "$used_mb" -ge "$warn_mb" ]; then
  printf 'pg_wal=%sMB warn=%sMB at %s\n' "$used_mb" "$warn_mb" "$(date -u +%FT%TZ)" >"$state/SPOOL_WARN" 2>/dev/null || true
else
  rm -f "$state/SPOOL_WARN" "$state/SPOOL_OVER" 2>/dev/null || true
fi

rc=0
timeout "$tmo" wal-g wal-push "$seg" || rc=$?
if [ "$rc" -eq 0 ]; then
  date +%s >"$state/last_push_epoch" 2>/dev/null || true
  exit 0
fi
date +%s >"$state/last_fail_epoch" 2>/dev/null || true
echo "walg-archive: wal-push failed rc=$rc for $(basename "$seg")" >&2
exit "$rc"
