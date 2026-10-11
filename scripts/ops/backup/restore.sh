#!/usr/bin/env bash
# Restore a Roxira restic snapshot.
#
#   Drill (default, safe): restore into a scratch dir and verify the dumps - touches nothing live.
#   --full               : apply to this host (fresh server): files, Postgres, Qdrant, compose up.
#
# Usage: restore.sh [--dry-run] [--repo sftp|s3|local] [--snapshot latest|<id>] [--scratch DIR] [--full] [--yes]
#
# Needs /etc/roxira/backup.env and the restic password file (copy them from the owner's Mac/password
# manager onto a fresh host first; they are never stored in the repo or in the backup itself).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

REPO_CHOICE="sftp"
SNAPSHOT="latest"
SCRATCH=""
FULL=0
ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --repo) REPO_CHOICE="${2:?}"; shift 2 ;;
    --snapshot) SNAPSHOT="${2:?}"; shift 2 ;;
    --scratch) SCRATCH="${2:?}"; shift 2 ;;
    --full) FULL=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

load_env
REPO_DIR="${ROXIRA_REPO_DIR:-/opt/roxira_platform}"
QDRANT_URL="${QDRANT_URL:-http://127.0.0.1:6333}"
PG_CONTAINERS="${BACKUP_PG_CONTAINERS:-roxira_postgres_prod roxira_twenty_db}"
SCRATCH="${SCRATCH:-/var/tmp/roxira-restore-$(date -u +%Y%m%dT%H%M%SZ)}"
STAGE_REL="${BACKUP_LOCAL_DIR:-/opt/roxira_backups/dr}/stage"
SRC="$SCRATCH$STAGE_REL"

if [ "$FULL" = 1 ] && [ "$DRY_RUN" != 1 ] && [ "$ASSUME_YES" != 1 ]; then
  printf 'FULL restore overwrites files and databases on THIS host (%s). Type "restore" to continue: ' "$(hostname)" >&2
  read -r reply
  [ "$reply" = "restore" ] || die "aborted"
fi

step "1/7 preflight (restic, repo '$REPO_CHOICE', snapshot '$SNAPSHOT', scratch $SCRATCH)"
if [ "$DRY_RUN" != 1 ]; then
  command -v restic >/dev/null || die "restic missing (apt-get install -y restic)"
  [ -r "${RESTIC_PASSWORD_FILE}" ] || die "restic password file missing"
  restic_on "$REPO_CHOICE" snapshots --host roxira-prod --latest 3 || die "cannot read repository"
else
  echo "[dry-run] restic snapshots --host roxira-prod (repo $REPO_CHOICE)"
fi

step "2/7 restic restore -> scratch"
run mkdir -p "$SCRATCH"
run restic_on "$REPO_CHOICE" restore "$SNAPSHOT" --target "$SCRATCH"

step "3/7 verify dumps in scratch"
if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] pg_restore --list on every $SRC/pg/*/*.dump; check qdrant snapshot files are non-empty"
else
  [ -d "$SRC" ] || die "stage dir $SRC missing in snapshot"
  bad=0
  for f in "$SRC"/pg/*/*.dump; do
    [ -e "$f" ] || continue
    c="$(basename "$(dirname "$f")")"
    if docker exec -i "$c" pg_restore -l <"$f" >/dev/null 2>&1; then echo "ok  $f"; else echo "BAD $f"; bad=1; fi
  done
  while IFS= read -r q; do [ -s "$q" ] && echo "ok  $q" || { echo "BAD $q"; bad=1; }; done < <(find "$SRC/qdrant" -name '*.snapshot' 2>/dev/null)
  [ "$bad" = 0 ] || warn "some dumps failed verification (pg checks need the container running)"
fi

if [ "$FULL" != 1 ]; then
  echo
  echo "Drill finished. Restored tree: $SCRATCH (delete it when done: rm -rf $SCRATCH)."
  echo "Re-run with --full on a fresh host to apply."
  exit 0
fi

step "4/7 place files (config, env, certs, ssh, cron, systemd, data)"
for p in /opt/roxira_platform/data /opt/roxira_platform/.env /opt/roxira_platform/docker /opt/roxira_platform/nginx \
  /etc/nginx /etc/letsencrypt /etc/ufw /etc/x-ui /usr/local/x-ui/bin /root/deploy-state /root/.ssh /etc/roxira; do
  if [ "$DRY_RUN" = 1 ]; then echo "[dry-run] rsync -a $SCRATCH$p/ -> $p/"; continue; fi
  [ -e "$SCRATCH$p" ] || continue
  if [ -d "$SCRATCH$p" ]; then mkdir -p "$p" && rsync -a "$SCRATCH$p/" "$p/"; else rsync -a "$SCRATCH$p" "$p"; fi
done
for p in /var/spool/cron/crontabs /etc/cron.d /etc/systemd/system; do
  if [ "$DRY_RUN" != 1 ] && [ ! -e "$SCRATCH$p" ]; then warn "not in snapshot, skipped: $p"; continue; fi
  run mkdir -p "$p"
  run rsync -a "$SCRATCH$p/" "$p/"
done
run chmod 700 /root/.ssh
run systemctl daemon-reload

step "5/7 start databases and restore Postgres"
run docker compose -f "$REPO_DIR/docker-compose.prod.yml" up -d postgres twenty_db 2>/dev/null || warn "compose service names differ; start postgres containers manually"
for c in $PG_CONTAINERS; do
  if [ "$DRY_RUN" = 1 ]; then echo "[dry-run] wait for $c; psql globals.sql; createdb + pg_restore --clean --if-exists --no-owner for each $c/*.dump"; continue; fi
  for _ in $(seq 1 60); do docker exec "$c" pg_isready >/dev/null 2>&1 && break; sleep 2; done
  [ -f "$SRC/pg/$c/globals.sql" ] && docker exec -i "$c" sh -c 'psql -U "$POSTGRES_USER" -d postgres -q' <"$SRC/pg/$c/globals.sql" >/dev/null 2>&1 || true
  for f in "$SRC/pg/$c"/*.dump; do
    [ -e "$f" ] || continue
    db="$(basename "$f" .dump)"
    if ! [[ "$db" =~ ^[A-Za-z0-9_]+$ ]]; then warn "skipping dump with unsafe database name: $f"; continue; fi
    # $DB / $POSTGRES_USER are expanded inside the container from its environment, never spliced into the script text.
    docker exec -e "DB=$db" "$c" sh -c 'psql -U "$POSTGRES_USER" -d postgres -Atc "select 1 from pg_database where datname='"'"'$DB'"'"'" | grep -q 1 || createdb -U "$POSTGRES_USER" "$DB"'
    docker exec -i -e "DB=$db" "$c" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$DB" --clean --if-exists --no-owner' <"$f" || warn "pg_restore of $c/$db reported errors (often harmless on --clean)"
    log "restored $c/$db"
  done
done

step "6/7 start Qdrant and upload collection snapshots"
run docker compose -f "$REPO_DIR/docker-compose.prod.yml" up -d qdrant 2>/dev/null || warn "start the qdrant container manually"
if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] for each $SRC/qdrant/<collection>/*.snapshot: POST $QDRANT_URL/collections/<c>/snapshots/upload?priority=snapshot"
else
  for _ in $(seq 1 60); do curl -fsS "$QDRANT_URL/readyz" >/dev/null 2>&1 && break; sleep 2; done
  key=(); [ -n "${QDRANT_API_KEY:-}" ] && key=(-H "api-key: ${QDRANT_API_KEY}")
  for d in "$SRC"/qdrant/*/; do
    [ -d "$d" ] || continue
    c="$(basename "$d")"
    snap="$(find "$d" -maxdepth 1 -name '*.snapshot' | head -1)"
    [ -n "$snap" ] || continue
    curl -fsS "${key[@]}" -X POST "$QDRANT_URL/collections/$c/snapshots/upload?priority=snapshot&wait=true" -F "snapshot=@$snap" >/dev/null \
      && log "qdrant restored: $c" || warn "qdrant upload failed for $c" # best effort per collection
  done
fi

step "7/7 bring the stack up and smoke-test"
run docker compose -f "$REPO_DIR/docker-compose.prod.yml" up -d
if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] curl -fsS http://127.0.0.1:3000/health ; curl -fsS $QDRANT_URL/collections ; docker ps"
else
  sleep 15
  docker ps --format '{{.Names}}\t{{.Status}}'
  curl -fsS "$QDRANT_URL/collections" | head -c 300 || warn "qdrant not answering"
fi
echo
echo "Restore complete. Next: DNS checklist in docs/ops/DISASTER_RECOVERY.md, then delete $SCRATCH."
