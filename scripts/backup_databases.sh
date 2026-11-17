#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/opt/roxira_backups"

# دامپ دیتابیس پستگرس و گراف
# T210: role "postgres" does not exist on prod; use the container's own role and db.
docker exec roxira_postgres_prod sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$BACKUP_DIR/postgres_$DATE.sql.gz"

# اسنپ‌شات وکتورهای Qdrant
tar -czf "$BACKUP_DIR/qdrant_$DATE.tar.gz" -C /opt/roxira_platform/data/qdrant_storage .

# نگهداری بکاپ‌های ۷ روز گذشته و حذف قدیمی‌ترها
find $BACKUP_DIR -type f -mtime +7 -delete
