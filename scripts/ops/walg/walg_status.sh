#!/usr/bin/env bash
# Archive health check, run every 5 minutes by roxira-walg-status.timer and after each nightly base backup.
# Reads pg_stat_archiver and the flags written by walg-archive.sh, then writes the LAST result to
# $BACKUP_STATE_DIR/walg.env (same key='value' pattern as r2.env / drill.env) and alerts to Telegram on trouble.
#   WALG_RESULT = OK | FAIL | CHAIN_BROKEN | NOT_CONFIGURED
# Usage: walg_status.sh [--dry-run]
set -euo pipefail
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
# shellcheck source=scripts/ops/walg/walg_lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/walg_lib.sh"
load_walg_env

if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] status: psql pg_stat_archiver in $WALG_CONTAINER + flags in $WALG_FLAG_DIR -> $WALG_STATUS_FILE; alert on FAIL/CHAIN_BROKEN"
  exit 0
fi

now="$(date +%s)"
result=OK
problems=()
warns=()

row=""
if docker inspect -f '{{.State.Running}}' "$WALG_CONTAINER" 2>/dev/null | grep -q true; then
  row="$(docker exec "$WALG_CONTAINER" psql -U "${PGUSER:-enterprise_admin}" -d "${PGDATABASE:-enterprise_db}" -Atqc \
    "SELECT coalesce(extract(epoch FROM last_archived_time)::bigint,0), coalesce(extract(epoch FROM last_failed_time)::bigint,0), failed_count, archived_count, current_setting('archive_mode') FROM pg_stat_archiver" 2>/dev/null || true)"
fi

if [ -z "$row" ]; then
  result=FAIL
  problems+=("cannot read pg_stat_archiver from $WALG_CONTAINER")
  last_arch=0 last_fail=0 failed=0 archived=0 amode=unknown
else
  IFS='|' read -r last_arch last_fail failed archived amode <<<"$row"
  if [ "$amode" != "on" ] && [ "$amode" != "always" ]; then
    result=NOT_CONFIGURED
    problems+=("archive_mode=$amode (WAL-G not enabled)")
  else
    if [ "$last_fail" -gt "$last_arch" ]; then
      result=FAIL; problems+=("last archive attempt failed (failed_count=$failed)")
    fi
    if [ "$last_arch" -gt 0 ] && [ $(((now - last_arch) / 60)) -gt "$WALG_MAX_ARCHIVE_AGE_MIN" ]; then
      result=FAIL; problems+=("newest archived segment is $(((now - last_arch) / 60)) min old (limit $WALG_MAX_ARCHIVE_AGE_MIN)")
    fi
    if [ "$last_arch" -eq 0 ] && [ "$archived" -eq 0 ]; then
      result=FAIL; problems+=("nothing archived yet")
    fi
  fi
fi

[ -e "$WALG_FLAG_DIR/SPOOL_WARN" ] && warns+=("pg_wal spool above half of WALG_SPOOL_MAX_MB: $(cat "$WALG_FLAG_DIR/SPOOL_WARN")")
if [ -e "$WALG_FLAG_DIR/SPOOL_OVER" ]; then
  result=FAIL; problems+=("pg_wal spool over limit: $(cat "$WALG_FLAG_DIR/SPOOL_OVER")")
fi
if [ -s "$WALG_FLAG_DIR/CHAIN_BROKEN" ]; then
  [ "$result" = OK ] && result=CHAIN_BROKEN
  problems+=("PITR chain broken (segments dropped), run: systemctl start roxira-walg-backup")
fi

base_ok="" base_res=""
if [ -r "$WALG_BASE_FILE" ]; then
  # shellcheck disable=SC1090
  . "$WALG_BASE_FILE"
  base_ok="${WALG_BASE_LAST_OK:-}"; base_res="${WALG_BASE_RESULT:-}"
  base_epoch="${WALG_BASE_LAST_OK_EPOCH:-0}"
  if [ "$result" = OK ] && [ "$base_epoch" -gt 0 ] && [ $(((now - base_epoch) / 3600)) -gt "$WALG_MAX_BASE_AGE_H" ]; then
    result=FAIL; problems+=("last good base backup is $(((now - base_epoch) / 3600)) h old (limit $WALG_MAX_BASE_AGE_H)")
  fi
  [ "$base_res" = FAIL ] && { result=FAIL; problems+=("last base backup FAILED: ${WALG_BASE_ERROR:-unknown}"); }
fi

env_write "$WALG_STATUS_FILE" \
  "WALG_RESULT=$result" \
  "WALG_CHECKED_AT=$(date -u +%Y%m%dT%H%M%SZ)" \
  "WALG_LAST_ARCHIVED_EPOCH=$last_arch" \
  "WALG_ARCHIVED_COUNT=$archived" \
  "WALG_FAILED_COUNT=$failed" \
  "WALG_ARCHIVE_MODE=$amode" \
  "WALG_BASE_LAST_OK=$base_ok" \
  "WALG_PROBLEMS=${problems[*]:-}" \
  "WALG_WARNINGS=${warns[*]:-}"
log "walg status: $result ${problems[*]:-}"

case "$result" in
  FAIL) alert "WALG archive FAILED" "${problems[*]}" ;;
  CHAIN_BROKEN) alert "WALG chain broken FAILED" "${problems[*]}" ;;
  NOT_CONFIGURED) : ;;
  OK) [ "${#warns[@]}" -gt 0 ] && alert "WALG spool warning" "${warns[*]}" ;;
esac
[ "$result" = OK ] || [ "$result" = NOT_CONFIGURED ]
