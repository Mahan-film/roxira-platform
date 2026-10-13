#!/usr/bin/env bash
# Offline test for restore.sh --from-set / set_to_scratch.sh. No docker, no network: docker/curl are stubs on PATH,
# the set is a tiny fake. Run: bash scripts/ops/backup/test_restore_from_set.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/rfs.XXXXXX")"
trap 'rm -rf -- "$T"' EXIT
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }

# --- fake set (layout of server_backup.sh stage) ---
S="$T/sets/20261013T120000Z"
mkdir -p "$S"/{meta,configs,pg/roxira_postgres_prod,pg/roxira_twenty_db,qdrant/legal_chunks,redis}
date -u >"$S/meta/backup_time.txt"; echo abcdef1234567890 >"$S/meta/repo_head.txt"
printf 'PGDMPfake' >"$S/pg/roxira_postgres_prod/app.dump"; echo 'CREATE ROLE x;' >"$S/pg/roxira_postgres_prod/globals.sql"
printf 'PGDMPfake' >"$S/pg/roxira_twenty_db/default.dump"
echo snap >"$S/qdrant/legal_chunks/legal_chunks-1.snapshot"
echo '{"result":{"points_count":42}}' >"$S/qdrant/legal_chunks/collection_info.json"
echo rdb >"$S/redis/dump.rdb"
ln -s "$S" "$T/sets/latest"
R="$T/root"
mkdir -p "$R"/opt/roxira_platform "$R"/etc/cron.d "$R"/etc/roxira "$R"/etc/nginx
echo 'TWENTY_DB_PASSWORD=x' >"$R/opt/roxira_platform/.env"; echo '0 3 * * * root /bin/true' >"$R/etc/cron.d/job"
echo env >"$R/etc/roxira/backup.env"; echo n >"$R/etc/nginx/nginx.conf"
tar -czf "$S/configs/configs.tar.gz" -C "$R" opt etc

# --- stubs ---
mkdir -p "$T/bin"
printf '#!/bin/sh\nexit 0\n' >"$T/bin/docker"; cp "$T/bin/docker" "$T/bin/curl"; cp "$T/bin/docker" "$T/bin/systemctl"
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH" BACKUP_ENV_FILE="$T/none.env" BACKUP_LOCAL_DIR="/opt/roxira_backups/dr"

# 1) --from-set --dry-run: plan printed, nothing created
SC="$T/scratch-dry"
out="$("$HERE/restore.sh" --from-set "$T/sets/latest" --scratch "$SC" --full --dry-run 2>&1)"
check "dry-run creates no scratch" '[ ! -e "$SC" ]'
for pat in "unpack local set" "tar -xzf" "ln -sfn" "rsync -a $SC/opt/roxira_platform/.env" "rsync -a $SC/etc/nginx/" \
  "$SC/opt/roxira_backups/dr/stage/pg/" "snapshots/upload" "points_count" "twenty_db twenty_redis" "twenty_crm" "cron-held"; do
  check "dry-run plan mentions: $pat" 'grep -qF -- "$pat" <<<"$out"'
done
check "dry-run has no restic call" '! grep -q "restic restore" <<<"$out"'

# 2) real drill (no --full): unpack + verify dumps, then scratch layout is what step 4 / 5 / 6 read
SC="$T/scratch"
out="$("$HERE/restore.sh" --from-set "$T/sets/latest" --scratch "$SC" 2>&1)" || { echo "$out"; fail=1; }
SRC="$SC/opt/roxira_backups/dr/stage"
check "drill verifies pg dumps" 'grep -q "^ok  .*app.dump" <<<"$out" && grep -q "^ok  .*default.dump" <<<"$out"'
check "drill verifies qdrant snapshot" 'grep -q "^ok  .*legal_chunks-1.snapshot" <<<"$out"'
for p in opt/roxira_platform/.env etc/cron.d/job etc/nginx/nginx.conf etc/roxira/backup.env; do
  check "step-4 path present: $p" '[ -e "$SC/$p" ]'
done
check "stage is a symlink to the set" '[ -L "$SRC" ] && [ "$(cd "$SRC" && pwd -P)" = "$(cd "$S" && pwd -P)" ]'
check "step-5 glob finds dumps" '[ -n "$(ls "$SRC"/pg/*/*.dump 2>/dev/null)" ] && [ -f "$SRC/pg/roxira_postgres_prod/globals.sql" ]'
check "step-6 glob finds snapshot+info" '[ -f "$SRC"/qdrant/legal_chunks/legal_chunks-1.snapshot ] && [ -f "$SRC"/qdrant/legal_chunks/collection_info.json ]'
check "set untouched (no new files)" '[ "$(find "$S" -type f | wc -l | tr -d " ")" = 9 ]'

# 3) refuses a truncated set
mkdir -p "$T/bad/pg"; check "rejects set without configs tarball" '! "$HERE/set_to_scratch.sh" "$T/bad" "$T/s2" >/dev/null 2>&1'

if [ "$fail" = 0 ]; then echo "ALL PASS"; else echo "FAILURES"; exit 1; fi
