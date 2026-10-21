#!/usr/bin/env bash
# Free off-site copy of the production databases on Neon (serverless Postgres, Frankfurt).
# Neon is a BACKUP COPY, never the live database. See docs/ops/OFFSITE_BACKUP.md.
#
# Runs ON the production host as root from roxira-neon-offsite.timer (daily 02:40 UTC). For each
# database in NEON_BACKUP_DBS (default "enterprise_db umami"):
#   1. pg_dump -Fc inside the Postgres container (docker exec; no host port)
#   2. pg_restore --clean --if-exists --no-owner --no-acl into the Neon database bk_<db>
#      (created on first run), from a throwaway postgres:17-alpine container on the host network
#   3. verify: exact count(*) of the 10 biggest tables, source vs Neon (small drift tolerated)
#   4. keep the dump locally, age-encrypted to BACKUP_AGE_RECIPIENT (same key as the DR bundle),
#      newest NEON_KEEP_LOCAL (default 7) per database
# Failure or mismatch: exit 1 + owner bot message. Success: owner bot message at most weekly.
#
# Usage: neon_offsite.sh [--dry-run]
# Env (never printed): NEON_BACKUP_URL  DIRECT (non-pooler) Neon connection string, set with
#                      scripts/ops/set_server_env.sh NEON_BACKUP_URL
#   NEON_BACKUP_DBS, NEON_PG_CONTAINER (roxira_postgres_prod), NEON_LOCAL_DIR (/opt/roxira_backups/neon),
#   NEON_KEEP_LOCAL (7), NEON_COUNT_TOLERANCE_PCT (2), NEON_COUNT_TOLERANCE_ABS (10), BACKUP_AGE_RECIPIENT
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=offsite_lib.sh
. "$SCRIPT_DIR/offsite_lib.sh"

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help) sed -n '2,22p' "$0"; exit 0 ;;
    *) die "unknown argument: $arg" ;;
  esac
done

load_names NEON_BACKUP_URL NEON_BACKUP_DBS BACKUP_AGE_RECIPIENT
DBS="${NEON_BACKUP_DBS:-enterprise_db umami}"
PG_CONTAINER="${NEON_PG_CONTAINER:-roxira_postgres_prod}"
LOCAL_DIR="${NEON_LOCAL_DIR:-/opt/roxira_backups/neon}"
KEEP="${NEON_KEEP_LOCAL:-7}"
TOL_PCT="${NEON_COUNT_TOLERANCE_PCT:-2}"
TOL_ABS="${NEON_COUNT_TOLERANCE_ABS:-10}"
STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
export REDACT_ENV_NAMES="NEON_BACKUP_URL NEON_TARGET_URL"
FAILS=()

# --- dry run: print the plan (no URL needed, nothing executed) ---------------------------------
if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] databases: $DBS  (source container: $PG_CONTAINER)"
  for db in $DBS; do
    printf '[dry-run] dump    : '; build_pg_dump_exec "$PG_CONTAINER" "$db" | show_cmd; echo "> \$WORK/$db.dump"
    printf '[dry-run] restore : '; build_pg_restore_run | show_cmd; echo "< \$WORK/$db.dump   (NEON_TARGET_URL = NEON_BACKUP_URL with database bk_$db)"
    echo "[dry-run] verify  : count(*) of the 10 biggest tables, tolerance max(${TOL_ABS}, ${TOL_PCT}%)"
    echo "[dry-run] local   : age -r \$BACKUP_AGE_RECIPIENT -> $LOCAL_DIR/$db/${db}_${STAMP}.dump.age (keep $KEEP)"
  done
  exit 0
fi

# --- preflight ---------------------------------------------------------------------------------
[ -n "${NEON_BACKUP_URL:-}" ] || die "NEON_BACKUP_URL is not set (scripts/ops/set_server_env.sh NEON_BACKUP_URL)"
python3 -I "$OFFSITE_TOOLS" check-url NEON_BACKUP_URL
rc=$?
if [ "$rc" = 3 ]; then die "NEON_BACKUP_URL is a pooler URL; use the DIRECT connection string (host without -pooler)"; fi
if [ "$rc" != 0 ]; then die "NEON_BACKUP_URL is not a valid postgres:// URL"; fi
for tool in docker python3; do command -v "$tool" >/dev/null 2>&1 || die "$tool not found"; done

mkdir -p "$OFFSITE_STATE_DIR" && chmod 700 "$OFFSITE_STATE_DIR"
exec 9>"$OFFSITE_STATE_DIR/neon.lock"
flock -n 9 || die "another neon_offsite.sh run is in progress"
WORK="$(mktemp -d "$OFFSITE_STATE_DIR/work.XXXXXX")" || die "cannot create work dir"
chmod 700 "$WORK"
cleanup() { # only files this run created; the plaintext dumps never outlive the run
  rm -f -- "$WORK"/*.dump "$WORK"/*.tsv "$WORK"/*.sql 2>/dev/null
  rmdir -- "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

# client <urlvar> <args...>: run a command in the throwaway client container.
client() {
  local -a argv=()
  while IFS= read -r -d '' a; do argv+=("$a"); done < <(build_client_run "$@")
  "${argv[@]}"
}

neon_psql() { # SQL on stdin; connects to $NEON_TARGET_URL (read inside the container)
  client NEON_TARGET_URL sh -c 'exec psql "$NEON_TARGET_URL" -X -At -F "|" -v ON_ERROR_STOP=1'
}

src_psql() { # <db>  (SQL on stdin)
  docker exec -i "$PG_CONTAINER" sh -c 'exec psql -U "$POSTGRES_USER" -d "$0" -X -At -F "|" -v ON_ERROR_STOP=1' "$1"
}

has_age() { command -v age >/dev/null 2>&1 && [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; }

backup_one() { # <db>; returns non-zero on failure (reason already logged)
  local db="$1" dump="$WORK/$1.dump" target_url
  [[ "$db" =~ ^[a-z0-9_]{1,40}$ ]] || { log "skip: bad database name '$db'"; return 1; }

  log "[$db] top-10 table list + source counts"
  src_psql "$db" <<<"SELECT schemaname, relname FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;" >"$WORK/$db.tables.tsv" 2>"$WORK/$db.err" \
    || { log "[$db] cannot list tables: $(head -c 300 "$WORK/$db.err")"; return 1; }
  python3 -I "$OFFSITE_TOOLS" count-sql <"$WORK/$db.tables.tsv" >"$WORK/$db.count.sql" || { log "[$db] no user tables found"; return 1; }
  src_psql "$db" <"$WORK/$db.count.sql" >"$WORK/$db.src.tsv" 2>"$WORK/$db.err" \
    || { log "[$db] source count failed: $(head -c 300 "$WORK/$db.err")"; return 1; }

  log "[$db] pg_dump -Fc"
  local -a dump_argv=()
  while IFS= read -r -d '' a; do dump_argv+=("$a"); done < <(build_pg_dump_exec "$PG_CONTAINER" "$db")
  "${dump_argv[@]}" >"$dump" 2>"$WORK/$db.err" || { log "[$db] pg_dump failed: $(head -c 300 "$WORK/$db.err")"; return 1; }
  [ -s "$dump" ] || { log "[$db] empty dump"; return 1; }
  export NEON_TARGET_URL
  client NEON_TARGET_URL pg_restore -l <"$dump" >/dev/null 2>"$WORK/$db.err" \
    || { log "[$db] dump is not a readable archive: $(head -c 300 "$WORK/$db.err")"; return 1; }

  target_url="$(python3 -I "$OFFSITE_TOOLS" url-db NEON_BACKUP_URL "bk_$db")" || { log "[$db] cannot build target URL"; return 1; }
  NEON_TARGET_URL="$target_url"
  local admin_sql
  admin_sql="SELECT format('CREATE DATABASE %I', 'bk_${db}') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'bk_${db}') \\gexec"
  NEON_TARGET_URL="$NEON_BACKUP_URL" neon_psql <<<"$admin_sql" >/dev/null 2>"$WORK/$db.err" \
    || { log "[$db] cannot create/see Neon database bk_$db: $(head -c 300 "$WORK/$db.err")"; return 1; }
  NEON_TARGET_URL="$target_url"

  log "[$db] pg_restore into Neon bk_$db"
  local -a restore_argv=()
  while IFS= read -r -d '' a; do restore_argv+=("$a"); done < <(build_pg_restore_run)
  "${restore_argv[@]}" <"$dump" >/dev/null 2>"$WORK/$db.err"
  local rrc=$?
  if [ "$rrc" != 0 ]; then
    warn "[$db] pg_restore exit $rrc (often harmless: extensions/roles); last lines: $(tail -n 3 "$WORK/$db.err" | tr '\n' ' ' | head -c 400)"
  fi

  log "[$db] verify row counts"
  neon_psql <"$WORK/$db.count.sql" >"$WORK/$db.dst.tsv" 2>"$WORK/$db.err" \
    || { log "[$db] Neon count failed: $(head -c 300 "$WORK/$db.err")"; return 1; }
  local diff
  if ! diff="$(python3 -I "$OFFSITE_TOOLS" compare "$WORK/$db.src.tsv" "$WORK/$db.dst.tsv" "$TOL_PCT" "$TOL_ABS")"; then
    log "[$db] ROW COUNT MISMATCH: $(printf '%s' "$diff" | tr '\n' ';' | head -c 600)"
    return 1
  fi
  log "[$db] verified $(wc -l <"$WORK/$db.src.tsv" | tr -d ' ') tables"

  # local encrypted copy (failure here is a warning: the Neon copy already succeeded)
  if has_age; then
    mkdir -p "$LOCAL_DIR/$db" && chmod 700 "$LOCAL_DIR" "$LOCAL_DIR/$db"
    if age -r "$BACKUP_AGE_RECIPIENT" -o "$LOCAL_DIR/$db/${db}_${STAMP}.dump.age" "$dump"; then
      local v
      while IFS= read -r v; do [ -n "$v" ] && rm -f -- "$v"; done < <(retention_victims "$LOCAL_DIR/$db" "$KEEP")
    else
      warn "[$db] age encryption failed; no local copy kept"
    fi
  else
    warn "[$db] age or BACKUP_AGE_RECIPIENT missing; local encrypted copy skipped (plaintext is never kept)"
  fi
  return 0
}

for db in $DBS; do
  if ! backup_one "$db"; then FAILS+=("$db"); fi
done

if [ "${#FAILS[@]}" -gt 0 ]; then
  log "FAILED databases: ${FAILS[*]}"
  notify_owner "Neon off-site backup FAILED for: ${FAILS[*]}. See: journalctl -u roxira-neon-offsite -n 80"
  exit 1
fi

log "all databases backed up and verified: $DBS"
if due_since "$OFFSITE_STATE_DIR/neon.last_notice" $((6 * 86400 + 43200)); then
  notify_owner "Neon off-site backup OK (weekly note): $DBS restored and row counts verified."
  : >"$OFFSITE_STATE_DIR/neon.last_notice"
fi
exit 0
