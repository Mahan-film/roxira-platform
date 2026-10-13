#!/usr/bin/env bash
# Cutover step run by the owner from the Mac: freeze writes on OLD, take a final
# local DR set, stream it to NEW (secrets never land on the Mac disk).
# Rollback (before DNS switch): ssh root@$OLD 'systemctl start cron; systemctl start "roxira-*.timer";
#   cd /opt/roxira_platform && docker compose -f docker-compose.prod.yml up -d; docker start roxira_twenty_crm'
set -euo pipefail
OLD="${OLD:-5.75.200.67}"
NEW="${NEW:-91.107.248.99}"
log() { printf '[cutover] %s\n' "$*"; }

log "1/3 freeze writes on OLD ($OLD): cron, timers, app containers, Twenty"
ssh "root@$OLD" 'set -e
systemctl stop cron
systemctl stop "roxira-*.timer" || true
cd /opt/roxira_platform
docker compose -f docker-compose.prod.yml stop roxira_enterprise_frontend roxira_enterprise_backend enterprise_app nginx_gateway
docker stop roxira_twenty_crm >/dev/null || true'

log "2/3 final backup set on OLD"
ssh "root@$OLD" '/opt/roxira_platform/scripts/ops/backup/server_backup.sh run >/root/final-backup.log 2>&1; grep -E "^LAST_(RESULT|OK)=" /var/lib/roxira-backup/status.env'
TS="$(ssh "root@$OLD" 'basename "$(readlink -f /opt/roxira_backups/dr/sets/latest)"')"
log "latest set: $TS"

log "3/3 stream set to NEW:/var/lib/roxira/incoming-set/$TS"
ssh "root@$NEW" "install -d -m 700 /var/lib/roxira/incoming-set/$TS"
ssh "root@$OLD" "tar -C /opt/roxira_backups/dr/sets/$TS -cf - ." | ssh "root@$NEW" "tar -C /var/lib/roxira/incoming-set/$TS -xf - && du -sh /var/lib/roxira/incoming-set/$TS"
log "DONE. Tell the hub: set $TS is on NEW."
