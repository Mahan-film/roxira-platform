#!/usr/bin/env bash
# Nightly backup: compressed pg_dump of Postgres + a Qdrant snapshot via its
# HTTP snapshot API, both with a 7-day retention window.
#
# Run this ON the production host, as root (cron/systemd already run as
# root there). Installed as a systemd timer via deploy/systemd/ (see that
# directory's README) once the owner approves it; the hub does not install
# it automatically.
#
# Note: /opt/roxira_platform/scripts/auto_backup_daemon.sh already runs
# hourly from root's crontab and covers the same two databases (Postgres via
# pg_dump, Qdrant via a raw tar of the storage directory). This script is a
# nightly, snapshot-API-based alternative requested for W23; see
# docs/ops/RESILIENCE.md for the tradeoffs. Do not install both timers for
# the same window without picking one — see the runbook.
set -euo pipefail

BACKUP_DIR="${ROXIRA_BACKUP_DIR:-/opt/roxira_backups}"
RETENTION_DAYS="${ROXIRA_BACKUP_RETENTION_DAYS:-7}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-roxira_postgres_prod}"
POSTGRES_USER="${POSTGRES_USER:-enterprise_admin}"
POSTGRES_DB="${POSTGRES_DB:-enterprise_db}"
QDRANT_CONTAINER="${QDRANT_CONTAINER:-roxira_qdrant_prod}"
QDRANT_URL="${QDRANT_URL:-http://127.0.0.1:6333}"
LOCK_FILE="${ROXIRA_BACKUP_LOCK:-/var/lock/roxira_nightly_backup.lock}"

DATE="$(date +%Y%m%d_%H%M%S)"
PG_TARGET="${BACKUP_DIR}/postgres_${DATE}.sql.gz"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

mkdir -p "$BACKUP_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "another backup run is still in progress; exiting"
  exit 0
fi

log "starting nightly backup (retention: ${RETENTION_DAYS}d) in ${BACKUP_DIR}"

# ---------------------------------------------------------------------------
# 1) PostgreSQL — pg_dump, gzip -9.
# ---------------------------------------------------------------------------
if ! docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
  log "warning: Postgres container (${POSTGRES_CONTAINER}) not running; skipping"
else
  log "dumping Postgres (${POSTGRES_DB})..."
  if docker exec "$POSTGRES_CONTAINER" \
      pg_dump --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      | gzip -9 > "${PG_TARGET}.tmp"; then
    mv "${PG_TARGET}.tmp" "$PG_TARGET"
    log "Postgres backup OK: ${PG_TARGET} ($(du -h "$PG_TARGET" | cut -f1))"
  else
    rm -f "${PG_TARGET}.tmp"
    fail "pg_dump failed"
  fi
fi

# ---------------------------------------------------------------------------
# 2) Qdrant — full-storage snapshot via the HTTP snapshot API, then copy the
#    snapshot file out of the container and delete it there so the
#    container's disk does not grow unbounded.
# ---------------------------------------------------------------------------
if ! docker inspect -f '{{.State.Running}}' "$QDRANT_CONTAINER" >/dev/null 2>&1; then
  log "warning: Qdrant container (${QDRANT_CONTAINER}) not running; skipping"
else
  log "requesting Qdrant full-storage snapshot..."
  snapshot_json="$(docker exec "$QDRANT_CONTAINER" curl -sf -X POST "${QDRANT_URL}/snapshots" || true)"
  # Not every qdrant image ships curl on PATH as a non-root user; fall back
  # to hitting the API from the host, which is also published on 127.0.0.1.
  if [ -z "$snapshot_json" ]; then
    snapshot_json="$(curl -sf -X POST "${QDRANT_URL}/snapshots" || true)"
  fi
  [ -n "$snapshot_json" ] || fail "Qdrant snapshot request failed (empty response)"

  snapshot_name="$(printf '%s' "$snapshot_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['name'])" 2>/dev/null || true)"
  [ -n "$snapshot_name" ] || fail "could not parse Qdrant snapshot name from: ${snapshot_json}"

  QDRANT_TARGET="${BACKUP_DIR}/qdrant_${DATE}.snapshot"
  log "downloading Qdrant snapshot ${snapshot_name}..."
  if curl -sf -o "${QDRANT_TARGET}.tmp" "${QDRANT_URL}/snapshots/${snapshot_name}"; then
    mv "${QDRANT_TARGET}.tmp" "$QDRANT_TARGET"
    log "Qdrant backup OK: ${QDRANT_TARGET} ($(du -h "$QDRANT_TARGET" | cut -f1))"
  else
    rm -f "${QDRANT_TARGET}.tmp"
    fail "downloading Qdrant snapshot ${snapshot_name} failed"
  fi

  log "deleting server-side snapshot ${snapshot_name} (already copied out)"
  curl -sf -X DELETE "${QDRANT_URL}/snapshots/${snapshot_name}" >/dev/null \
    || log "warning: could not delete server-side snapshot ${snapshot_name}; it will accumulate in the container"
fi

# ---------------------------------------------------------------------------
# 3) Retention.
# ---------------------------------------------------------------------------
log "pruning backups older than ${RETENTION_DAYS} days..."
deleted="$(find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'postgres_*.sql.gz' -o -name 'qdrant_*.snapshot' \) -mtime "+${RETENTION_DAYS}" -print -delete | wc -l | tr -d ' ')"
log "removed ${deleted} old backup file(s)"

log "nightly backup finished successfully"
