#!/usr/bin/env bash
# Restore a Roxira restic snapshot.
#
#   Drill (default, safe): restore into a scratch dir and verify the dumps - touches nothing live.
#   --full               : apply to this host (fresh server): files, Postgres, Qdrant, compose up.
#
# Usage: restore.sh [--dry-run] [--repo sftp|s3|local] [--snapshot latest|<id>] [--scratch DIR] [--full] [--yes]
#                   [--cron hold|apply|skip]      (default hold)  [--from-step N]  (resume at step 5-7, needs --full --scratch DIR)
#        restore.sh --apply-cron [--dry-run] [--yes]   activate the held cron jobs after you reviewed them
#
# Cron safety: the backup holds the OLD host's crontabs and /etc/cron.d (daily marketing campaign, crawlers, mesh
# jobs). Restoring them live would run those jobs on the new host (and on the old one) at once. So --full stops cron,
# puts them under /var/lib/roxira/cron-held, and PRINTS every active job. Review, then run --apply-cron at cutover.
# Compose services restored by name: RESTORE_DB_SERVICES (default postgres_prod), RESTORE_QDRANT_SERVICE (qdrant_prod),
# RESTORE_COMPOSE_FILE. Twenty (roxira_twenty_db) comes from docker-compose.modern-stack.yml (RESTORE_TWENTY_COMPOSE),
# which reads its TWENTY_* values from the repo .env; twenty_db/twenty_redis start first, twenty_crm after the DB restore.
#
# Needs /etc/roxira/backup.env and the restic password file (copy them from the owner's Mac/password
# manager onto a fresh host first; they are never stored in the repo or in the backup itself).
# Exit codes: 0 ok, 3 = PARTIAL restore (some Postgres databases skipped), other = failure.
#--end-help--
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

REPO_CHOICE="sftp"
SNAPSHOT="latest"
SCRATCH=""
FULL=0
ASSUME_YES=0
CRON_MODE="hold"
APPLY_CRON=0
FROM_STEP=1
RESTORED_PG=""
SKIPPED_PG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --repo) REPO_CHOICE="${2:?}"; shift 2 ;;
    --snapshot) SNAPSHOT="${2:?}"; shift 2 ;;
    --scratch) SCRATCH="${2:?}"; shift 2 ;;
    --full) FULL=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    --cron) CRON_MODE="${2:?--cron needs hold|apply|skip}"; shift 2 ;;
    --apply-cron) APPLY_CRON=1; shift ;;
    --from-step) FROM_STEP="${2:?--from-step needs 5, 6 or 7}"; shift 2 ;;
    -h|--help) sed -n '2,/^#--end-help--$/{/^#--end-help--$/d;p;}' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

case "$FROM_STEP" in 1|5|6|7) ;; *) die "--from-step must be 5, 6 or 7 (got '$FROM_STEP')" ;; esac
case "$CRON_MODE" in hold|apply|skip) ;; *) die "--cron must be hold, apply or skip" ;; esac
load_env
REPO_DIR="${ROXIRA_REPO_DIR:-/opt/roxira_platform}"
COMPOSE_FILE="${RESTORE_COMPOSE_FILE:-$REPO_DIR/docker-compose.prod.yml}"
DB_SERVICES="${RESTORE_DB_SERVICES:-postgres_prod}"
QDRANT_SERVICE="${RESTORE_QDRANT_SERVICE:-qdrant_prod}"
TWENTY_COMPOSE="${RESTORE_TWENTY_COMPOSE:-$REPO_DIR/docker-compose.modern-stack.yml}"
TWENTY_ENV="${RESTORE_TWENTY_ENV:-$REPO_DIR/.env}"   # compose reads TWENTY_DB_PASSWORD/APP_SECRET/ENCRYPTION_KEY from here
CRON_HOLD="${CRON_HOLD_DIR:-/var/lib/roxira/cron-held}"

# list_cron <dir...>: print the ACTIVE entries (no comments, blanks or VAR=value lines) of crontab files, tagged by file.
list_cron() {
  local d f n=0
  for d in "$@"; do
    [ -d "$d" ] || continue
    for f in "$d"/*; do
      [ -f "$f" ] || continue
      # shellcheck disable=SC2094
      while IFS= read -r line; do
        case "$line" in ''|'#'*) continue ;; esac
        [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] && continue
        printf '  %s: %s\n' "$(basename "$f")" "$line" >&2
        n=$((n + 1))
      done <"$f"
    done
  done
  log "$n active cron entries listed"
}

if [ "$APPLY_CRON" = 1 ]; then
  step "apply held cron jobs from $CRON_HOLD"
  if [ ! -d "$CRON_HOLD" ] && [ "$DRY_RUN" != 1 ]; then die "nothing held at $CRON_HOLD (run --full first)"; fi
  list_cron "$CRON_HOLD/cron.d" "$CRON_HOLD/crontabs"
  if [ "$DRY_RUN" != 1 ] && [ "$ASSUME_YES" != 1 ]; then
    printf 'Activate ALL jobs listed above on THIS host (%s)? Type "cron" to continue: ' "$(hostname)" >&2
    read -r reply
    [ "$reply" = "cron" ] || die "aborted"
  fi
  [ -d "$CRON_HOLD/cron.d" ] && run rsync -a "$CRON_HOLD/cron.d/" /etc/cron.d/
  [ -d "$CRON_HOLD/crontabs" ] && run rsync -a "$CRON_HOLD/crontabs/" /var/spool/cron/crontabs/
  run systemctl unmask cron 2>/dev/null || true
  run systemctl start cron
  exit 0
fi
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

if [ "$FROM_STEP" -le 4 ]; then
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
  while IFS= read -r q; do if [ -s "$q" ]; then echo "ok  $q"; else echo "BAD $q"; bad=1; fi; done < <(find "$SRC/qdrant" -name '*.snapshot' 2>/dev/null)
  [ "$bad" = 0 ] || warn "some dumps failed verification (pg checks need the container running)"
fi

if [ "$FULL" != 1 ]; then
  echo
  echo "Drill finished. Restored tree: $SCRATCH (delete it when done: rm -rf $SCRATCH)."
  echo "Re-run with --full on a fresh host to apply."
  exit 0
fi

step "4/7 place files (config, env, certs, ssh, systemd, data) and HOLD cron"
if [ "$DRY_RUN" != 1 ] && [ "$CRON_MODE" != "apply" ] && command -v systemctl >/dev/null 2>&1; then
  # Stop cron BEFORE anything old lands, so no restored job can fire while we are still restoring.
  run systemctl stop cron 2>/dev/null || true
fi
for p in /opt/roxira_platform/data /opt/roxira_platform/.env /opt/roxira_platform/docker /opt/roxira_platform/nginx \
  /opt/roxira_platform/twenty_data/server \
  /etc/nginx /etc/letsencrypt /etc/ufw /etc/x-ui /usr/local/x-ui/bin /root/deploy-state /root/.ssh /etc/roxira; do
  if [ "$DRY_RUN" = 1 ]; then echo "[dry-run] rsync -a $SCRATCH$p/ -> $p/"; continue; fi
  [ -e "$SCRATCH$p" ] || continue
  if [ -d "$SCRATCH$p" ]; then mkdir -p "$p" && rsync -a "$SCRATCH$p/" "$p/"; else rsync -a "$SCRATCH$p" "$p"; fi
done

# Cron: hold (default) = copy to $CRON_HOLD and list; apply = old behaviour (live); skip = ignore.
case "$CRON_MODE" in
  hold)
    log "cron mode 'hold': old crontabs are NOT activated. Held under $CRON_HOLD"
    for cp in /etc/cron.d /var/spool/cron/crontabs; do
      if [ "$DRY_RUN" != 1 ] && [ ! -e "$SCRATCH$cp" ]; then warn "not in snapshot, nothing to hold: $cp"; fi
    done
    run mkdir -p "$CRON_HOLD/cron.d" "$CRON_HOLD/crontabs"
    if [ "$DRY_RUN" = 1 ]; then
      echo "[dry-run] rsync -a $SCRATCH/etc/cron.d/ -> $CRON_HOLD/cron.d/ ; $SCRATCH/var/spool/cron/crontabs/ -> $CRON_HOLD/crontabs/"
    else
      if [ -d "$SCRATCH/etc/cron.d" ]; then rsync -a "$SCRATCH/etc/cron.d/" "$CRON_HOLD/cron.d/"; fi
      if [ -d "$SCRATCH/var/spool/cron/crontabs" ]; then rsync -a "$SCRATCH/var/spool/cron/crontabs/" "$CRON_HOLD/crontabs/"; fi
    fi
    log "jobs in the backup (review them; campaigns/crawlers must not run on two hosts):"
    list_cron "$SCRATCH/etc/cron.d" "$SCRATCH/var/spool/cron/crontabs"
    log "activate later with: $0 --apply-cron"
    ;;
  apply)
    for p in /var/spool/cron/crontabs /etc/cron.d; do
      if [ "$DRY_RUN" != 1 ] && [ ! -e "$SCRATCH$p" ]; then warn "not in snapshot, skipped: $p"; continue; fi
      run mkdir -p "$p"
      run rsync -a "$SCRATCH$p/" "$p/"
    done
    list_cron "$SCRATCH/etc/cron.d" "$SCRATCH/var/spool/cron/crontabs"
    warn "cron mode 'apply': these jobs are now LIVE on this host"
    ;;
  skip) log "cron mode 'skip': crontabs not restored" ;;
esac
if [ "$DRY_RUN" != 1 ] && [ ! -e "$SCRATCH/etc/systemd/system" ]; then
  warn "not in snapshot, skipped: /etc/systemd/system"
else
  run mkdir -p /etc/systemd/system
  run rsync -a "$SCRATCH/etc/systemd/system/" /etc/systemd/system/
fi
run chmod 700 /root/.ssh
run systemctl daemon-reload
if [ "$DRY_RUN" != 1 ]; then
  enabled_timers="$(find /etc/systemd/system/timers.target.wants -maxdepth 1 -name 'roxira-*.timer' -printf '%f ' 2>/dev/null || true)"
  [ -z "$enabled_timers" ] || warn "restored units enable these timers at the next boot/enable: $enabled_timers (stop them until cutover: systemctl stop 'roxira-*.timer')"
fi

fi # FROM_STEP -le 4

# have_container <name>: true when the container exists and is running
have_container() { docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$1"; }

if [ "$FROM_STEP" -le 5 ]; then
step "5/7 start databases and restore Postgres"
if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] docker compose -f $COMPOSE_FILE up -d $DB_SERVICES"
else
  read -r -a db_svc <<<"$DB_SERVICES"
  docker compose -f "$COMPOSE_FILE" up -d "${db_svc[@]}" || die "compose could not start '$DB_SERVICES' from $COMPOSE_FILE (service names: docker compose -f $COMPOSE_FILE config --services). Fix and re-run."
fi
if [[ " $PG_CONTAINERS " == *" roxira_twenty_db "* ]]; then
  if [ "$DRY_RUN" = 1 ]; then
    echo "[dry-run] twenty: if $TWENTY_COMPOSE and $TWENTY_ENV exist -> docker compose -f $TWENTY_COMPOSE --env-file $TWENTY_ENV up -d twenty_db twenty_redis (CRM app is started in step 7)"
  elif [ -f "$TWENTY_COMPOSE" ] && [ -f "$TWENTY_ENV" ]; then
    docker compose -f "$TWENTY_COMPOSE" --env-file "$TWENTY_ENV" up -d twenty_db twenty_redis \
      || warn "could not start the Twenty database from $TWENTY_COMPOSE; its dump is skipped"
  else
    warn "Twenty compose/env missing ($TWENTY_COMPOSE, $TWENTY_ENV): roxira_twenty_db is not started by this script (docker-compose.modern-stack.yml and the repo .env must be restored first); its dump is skipped unless the container is already running"
  fi
fi
for c in $PG_CONTAINERS; do
  if [ "$DRY_RUN" = 1 ]; then echo "[dry-run] wait for $c; psql globals.sql; createdb + pg_restore --clean --if-exists --no-owner for each $c/*.dump"; continue; fi
  ready=0
  for _ in $(seq 1 60); do
    if docker exec "$c" pg_isready >/dev/null 2>&1; then ready=1; break; fi
    sleep 2
  done
  if [ "$ready" != 1 ]; then
    warn "SKIPPED $c: container not running/ready after 2 minutes. Restore its dumps by hand from $SRC/pg/$c/ once it is up."
    SKIPPED_PG="${SKIPPED_PG:-} $c"
    continue
  fi
  if [ -f "$SRC/pg/$c/globals.sql" ]; then
    docker exec -i "$c" sh -c 'psql -U "$POSTGRES_USER" -d postgres -q' <"$SRC/pg/$c/globals.sql" >/dev/null 2>&1 || warn "globals.sql for $c reported errors (roles may already exist)"
  fi
  for f in "$SRC/pg/$c"/*.dump; do
    [ -e "$f" ] || continue
    db="$(basename "$f" .dump)"
    if ! [[ "$db" =~ ^[A-Za-z0-9_]+$ ]]; then warn "skipping dump with unsafe database name: $f"; continue; fi
    # $DB / $POSTGRES_USER are expanded inside the container from its environment, never spliced into the script text.
    if ! docker exec -e "DB=$db" "$c" sh -c 'psql -U "$POSTGRES_USER" -d postgres -Atc "select 1 from pg_database where datname='"'"'$DB'"'"'" | grep -q 1 || createdb -U "$POSTGRES_USER" "$DB"'; then
      warn "could not create database $db in $c; skipped"; SKIPPED_PG="${SKIPPED_PG:-} $c/$db"; continue
    fi
    docker exec -i -e "DB=$db" "$c" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$DB" --clean --if-exists --no-owner' <"$f" || warn "pg_restore of $c/$db reported errors (often harmless on --clean)"
    log "restored $c/$db"
    RESTORED_PG="${RESTORED_PG} $c/$db"
  done
done

if [ "$DRY_RUN" != 1 ]; then
  # plain "KEY<TAB>space-separated container/db names" lines; read back by parsing, never sourced
  printf 'RESTORED_PG\t%s\nSKIPPED_PG\t%s\n' "$RESTORED_PG" "$SKIPPED_PG" >"$SCRATCH/.restore_state"
fi
else
  # Resuming after step 5: recover its result so the final PARTIAL banner / exit 3 still fire.
  if [ -f "$SCRATCH/.restore_state" ]; then
    while IFS=$'\t' read -r key val; do
      val="$(printf '%s' "$val" | tr -cd 'A-Za-z0-9_/ .-')"  # names are container/db identifiers only
      case "$key" in RESTORED_PG) RESTORED_PG="$val" ;; SKIPPED_PG) SKIPPED_PG="$val" ;; esac
    done <"$SCRATCH/.restore_state"
    log "resumed: loaded step-5 state from $SCRATCH/.restore_state (skipped:${SKIPPED_PG:- none})"
  else
    warn "no $SCRATCH/.restore_state: cannot know whether step 5 skipped databases; verify Postgres by hand"
  fi
fi # FROM_STEP -le 5

if [ "$FROM_STEP" -le 6 ]; then
step "6/7 start Qdrant and upload collection snapshots"
if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] docker compose -f $COMPOSE_FILE up -d $QDRANT_SERVICE"
  echo "[dry-run] for each $SRC/qdrant/<collection>/*.snapshot: POST $QDRANT_URL/collections/<c>/snapshots/upload?priority=snapshot"
else
  resume_hint() {
    warn "Already done: files placed (step 4); Postgres restored:${RESTORED_PG:- none}; skipped:${SKIPPED_PG:- none}. Qdrant NOT restored."
    warn "Fix the cause, then resume with:  $0 --repo $REPO_CHOICE --full --yes --scratch $SCRATCH --from-step 6"
  }
  docker compose -f "$COMPOSE_FILE" up -d "$QDRANT_SERVICE" || { resume_hint; die "compose could not start '$QDRANT_SERVICE' (see docker compose -f $COMPOSE_FILE config --services)"; }
  qready=0
  for _ in $(seq 1 60); do if curl -fsS "$QDRANT_URL/readyz" >/dev/null 2>&1; then qready=1; break; fi; sleep 2; done
  [ "$qready" = 1 ] || { resume_hint; die "Qdrant not ready at $QDRANT_URL after 2 minutes; nothing uploaded"; }
  key=(); [ -n "${QDRANT_API_KEY:-}" ] && key=(-H "api-key: ${QDRANT_API_KEY}")
  for d in "$SRC"/qdrant/*/; do
    [ -d "$d" ] || continue
    c="$(basename "$d")"
    snap="$(find "$d" -maxdepth 1 -name '*.snapshot' | head -1)"
    [ -n "$snap" ] || continue
    # best effort per collection
    if curl -fsS "${key[@]}" -X POST "$QDRANT_URL/collections/$c/snapshots/upload?priority=snapshot&wait=true" -F "snapshot=@$snap" >/dev/null; then
      log "qdrant restored: $c"
    else
      warn "qdrant upload failed for $c"
    fi
  done
fi

fi # FROM_STEP -le 6

step "7/7 bring the stack up and smoke-test"
if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] docker compose -f $COMPOSE_FILE up -d ; twenty: docker compose -f $TWENTY_COMPOSE --env-file $TWENTY_ENV up -d twenty_crm (if present)"
  echo "[dry-run] curl -fsS http://127.0.0.1:3000/health ; curl -fsS $QDRANT_URL/collections ; docker ps"
else
  docker compose -f "$COMPOSE_FILE" up -d || warn "compose up reported errors; check 'docker compose ps'"
  if [ -f "$TWENTY_COMPOSE" ] && [ -f "$TWENTY_ENV" ]; then
    docker compose -f "$TWENTY_COMPOSE" --env-file "$TWENTY_ENV" up -d twenty_crm || warn "Twenty CRM start reported errors"
  fi
  sleep 15
  docker ps --format '{{.Names}}\t{{.Status}}'
  curl -fsS "$QDRANT_URL/collections" | head -c 300 || warn "qdrant not answering"
fi
echo
if [ -n "$SKIPPED_PG" ]; then
  echo "################################################################" >&2
  echo "#  PARTIAL RESTORE - NOT COMPLETE                              #" >&2
  echo "################################################################" >&2
  warn "Postgres restore SKIPPED for:${SKIPPED_PG}"
  warn "Restored:${RESTORED_PG:- none}. Start the missing container(s), restore their dumps from $SRC/pg/<container>/, or re-run:"
  warn "  $0 --repo $REPO_CHOICE --full --yes --scratch $SCRATCH --from-step 5"
  [ "$CRON_MODE" != hold ] || warn "Held cron jobs are NOT active: $0 --apply-cron (after review)"
  exit 3
fi
echo "Restore complete (cron: mode '$CRON_MODE'). Next: DNS checklist in docs/ops/DISASTER_RECOVERY.md, then delete $SCRATCH."
[ "$CRON_MODE" != hold ] || echo "Held cron jobs are NOT active. Review the list above, then: $0 --apply-cron"
