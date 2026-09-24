#!/usr/bin/env bash
# Pull the latest production backups onto the owner's Mac (off-site copy, no extra cost).
#
# Read-only on the server: copies the newest hourly Postgres + Qdrant archives made by
# scripts/auto_backup_daemon.sh, and streams a pg_dump of the Twenty CRM database
# (which the hourly job does not cover). Nothing is written on the server.
#
# Installed by scripts/ops/install_mac_backup_pull.sh as a daily launchd job.
# Env overrides: ROXIRA_HOST, ROXIRA_BACKUP_DEST, ROXIRA_KEEP_DAYS.

set -euo pipefail

HOST="${ROXIRA_HOST:-5.75.200.67}"
DEST="${ROXIRA_BACKUP_DEST:-$HOME/RoxiraBackups}"
KEEP_DAYS="${ROXIRA_KEEP_DAYS:-30}"
REMOTE_DIR="/opt/roxira_backups"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=20 "root@${HOST}")

DAY="$(date +%Y-%m-%d)"
OUT="${DEST}/${DAY}"
LOG="${DEST}/pull.log"
mkdir -p "$OUT"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

notify() {
  # macOS banner; harmless if osascript is unavailable.
  osascript -e "display notification \"$2\" with title \"Roxira backup\" subtitle \"$1\"" >/dev/null 2>&1 || true
}

fail() {
  log "ERROR: $*"
  notify "FAILED" "$*"
  exit 1
}
trap 'fail "unexpected error on line $LINENO"' ERR

log "start -> ${OUT}"

# 1) Newest hourly Postgres + Qdrant archives.
for prefix in postgres qdrant; do
  remote="$("${SSH[@]}" "ls -1t ${REMOTE_DIR}/${prefix}_*.gz 2>/dev/null | head -1")" \
    || fail "cannot list ${prefix} backups on ${HOST}"
  [ -n "$remote" ] || fail "no ${prefix} backup found on ${HOST}"
  scp -q -o BatchMode=yes "root@${HOST}:${remote}" "${OUT}/" || fail "scp ${remote} failed"
  gzip -t "${OUT}/$(basename "$remote")" || fail "corrupt archive $(basename "$remote")"
  log "ok ${prefix}: $(basename "$remote") ($(du -h "${OUT}/$(basename "$remote")" | cut -f1))"
done

# 2) Twenty CRM database, streamed (not in the hourly job).
twenty="${OUT}/twenty_${DAY}.sql.gz"
# Single quotes reach the container's sh, so $POSTGRES_USER/$POSTGRES_DB expand there, not on the host.
"${SSH[@]}" 'docker exec roxira_twenty_db sh -c '"'"'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"'"'"'' \
  | gzip > "$twenty"
gzip -t "$twenty" || fail "corrupt twenty dump"
[ "$(gzip -dc "$twenty" | head -c 200 | wc -c)" -gt 0 ] || fail "empty twenty dump"
log "ok twenty: $(basename "$twenty") ($(du -h "$twenty" | cut -f1))"

# 3) Retention.
find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??' -mtime +"$KEEP_DAYS" -exec rm -rf {} +

total="$(du -sh "$OUT" | cut -f1)"
log "done ${DAY} (${total})"
notify "OK" "${DAY}: ${total} saved to ${DEST}"
