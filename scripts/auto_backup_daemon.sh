#!/usr/bin/env bash
# ==============================================================================
# Roxira Automated Backup Daemon
# ==============================================================================
# تهیه نسخه پشتیبان ساعتی از PostgreSQL و Qdrant با فشرده‌سازی gzip و
# نگهداری ۷ روزه. این اسکریپت برای اجرا از کرون‌جاب طراحی شده است:
#
#   0 * * * * /opt/roxira_platform/scripts/auto_backup_daemon.sh >> /var/log/roxira_backup.log 2>&1
#
# زیرساخت (docker-compose.prod.yml):
#   - Postgres : roxira_postgres_prod  (db=enterprise_db, user=enterprise_admin)
#   - Qdrant   : roxira_qdrant_prod    (storage=/qdrant/storage)
# ==============================================================================

set -euo pipefail

# ------------------------------------------------------------------------------
# پیکربندی (قابل بازنویسی با متغیر محیطی)
# ------------------------------------------------------------------------------
BACKUP_DIR="${ROXIRA_BACKUP_DIR:-/opt/roxira_backups}"
RETENTION_DAYS="${ROXIRA_BACKUP_RETENTION_DAYS:-7}"

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-roxira_postgres_prod}"
POSTGRES_USER="${POSTGRES_USER:-enterprise_admin}"
POSTGRES_DB="${POSTGRES_DB:-enterprise_db}"

QDRANT_CONTAINER="${QDRANT_CONTAINER:-roxira_qdrant_prod}"
QDRANT_STORAGE_PATH="${QDRANT_STORAGE_PATH:-/qdrant/storage}"

LOCK_FILE="${ROXIRA_BACKUP_LOCK:-/var/lock/roxira_backup.lock}"

DATE="$(date +%Y%m%d_%H%M%S)"
PG_TARGET="${BACKUP_DIR}/postgres_${DATE}.sql.gz"
QDRANT_TARGET="${BACKUP_DIR}/qdrant_${DATE}.tar.gz"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

# ------------------------------------------------------------------------------
# جلوگیری از اجرای هم‌زمان (مثلاً اگر بکاپ قبلی طول بکشد)
# ------------------------------------------------------------------------------
mkdir -p "$BACKUP_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "نسخه پشتیبان قبلی هنوز در حال اجراست؛ این اجرا لغو شد."
  exit 0
fi

log "شروع بکاپ خودکار (نگهداری ${RETENTION_DAYS} روزه) در ${BACKUP_DIR}"

# ------------------------------------------------------------------------------
# ۱) PostgreSQL — pg_dump با فرمت SQL و فشرده‌سازی gzip
# ------------------------------------------------------------------------------
if ! docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
  log "هشدار: کانتینر Postgres (${POSTGRES_CONTAINER}) در دسترس نیست؛ از این بخش عبور می‌شود."
else
  log "در حال دامپ PostgreSQL (${POSTGRES_DB}) ..."
  if docker exec "$POSTGRES_CONTAINER" \
      pg_dump --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      | gzip -9 > "$PG_TARGET.tmp"; then
    mv "$PG_TARGET.tmp" "$PG_TARGET"
    log "Postgres backup OK: ${PG_TARGET} ($(du -h "$PG_TARGET" | cut -f1))"
  else
    rm -f "$PG_TARGET.tmp"
    fail "دامپ PostgreSQL شکست خورد."
  fi
fi

# ------------------------------------------------------------------------------
# ۲) Qdrant — آرشیو فشرده gzip از دایرکتوری storage کانتینر
# ------------------------------------------------------------------------------
if ! docker inspect -f '{{.State.Running}}' "$QDRANT_CONTAINER" >/dev/null 2>&1; then
  log "هشدار: کانتینر Qdrant (${QDRANT_CONTAINER}) در دسترس نیست؛ از این بخش عبور می‌شود."
else
  log "در حال آرشیو Qdrant (${QDRANT_STORAGE_PATH}) ..."
  if docker exec "$QDRANT_CONTAINER" \
      tar czf - -C "$QDRANT_STORAGE_PATH" . > "$QDRANT_TARGET.tmp"; then
    mv "$QDRANT_TARGET.tmp" "$QDRANT_TARGET"
    log "Qdrant backup OK: ${QDRANT_TARGET} ($(du -h "$QDRANT_TARGET" | cut -f1))"
  else
    rm -f "$QDRANT_TARGET.tmp"
    fail "آرشیو Qdrant شکست خورد."
  fi
fi

# ------------------------------------------------------------------------------
# ۳) نگهداری ۷ روزه — حذف نسخه‌های قدیمی‌تر
# ------------------------------------------------------------------------------
log "پاک‌سازی بکاپ‌های قدیمی‌تر از ${RETENTION_DAYS} روز ..."
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'postgres_*.sql.gz' -o -name 'qdrant_*.tar.gz' \) \
  -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)"
log "تعداد ${DELETED} فایل قدیمی حذف شد."

log "بکاپ خودکار با موفقیت پایان یافت."