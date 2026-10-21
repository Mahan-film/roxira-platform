#!/usr/bin/env bash
# Free off-site copy of the production databases on Neon (serverless Postgres, Frankfurt).
# Neon is a BACKUP COPY, never the live database. See docs/ops/OFFSITE_BACKUP.md.
#
# Runs ON the production host as root from roxira-neon-offsite.timer (daily 02:40 UTC). For each
# database in NEON_BACKUP_DBS (default "enterprise_db umami") and each configured target:
#   1. pg_dump -Fc inside the Postgres container (docker exec; no host port)
#   2. pg_restore --clean --if-exists --no-owner --no-acl into the target database bk_<db>
#      (created on first run), from a throwaway postgres:18-alpine container on the host network
#   3. verify: exact count(*) of the 10 biggest tables, source vs target (small drift tolerated)
#   4. keep the dump locally, age-encrypted to BACKUP_AGE_RECIPIENT (same key as the DR bundle),
#      newest NEON_KEEP_LOCAL (default 7) per database
# One target failing does not stop the others; exit non-zero only when every target fails (or a
# dump cannot be produced). Failure: owner bot message. Success: owner bot message at most weekly.
#
# Usage: neon_offsite.sh [--dry-run]
# Env (never printed): NEON_BACKUP_URL  DIRECT (non-pooler) Neon connection string, set with
#                      scripts/ops/set_server_env.sh NEON_BACKUP_URL
#   NEON_BACKUP_URL_2..4 optional spare Neon accounts (same direct-connection rule), restored in order
#   NEON_BACKUP_DBS, NEON_PG_CONTAINER (roxira_postgres_prod), NEON_LOCAL_DIR (/opt/roxira_backups/neon),
#   NEON_KEEP_LOCAL (7), NEON_COUNT_TOLERANCE_PCT (2), NEON_COUNT_TOLERANCE_ABS (10), BACKUP_AGE_RECIPIENT
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=offsite_lib.sh
. "$SCRIPT_DIR/offsite_lib.sh"

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help) sed -n '2,21p' "$0"; exit 0 ;;
    *) die "unknown argument: $arg" ;;
  esac
done

load_names NEON_BACKUP_URL NEON_BACKUP_URL_2 NEON_BACKUP_URL_3 NEON_BACKUP_URL_4 \
  NEON_BACKUP_DBS BACKUP_AGE_RECIPIENT
DBS="${NEON_BACKUP_DBS:-enterprise_db umami}"
PG_CONTAINER="${NEON_PG_CONTAINER:-roxira_postgres_prod}"
LOCAL_DIR="${NEON_LOCAL_DIR:-/opt/roxira_backups/neon}"
KEEP="${NEON_KEEP_LOCAL:-7}"
TOL_PCT="${NEON_COUNT_TOLERANCE_PCT:-2}"
TOL_ABS="${NEON_COUNT_TOLERANCE_ABS:-10}"
STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
URL_NAMES=(NEON_BACKUP_URL NEON_BACKUP_URL_2 NEON_BACKUP_URL_3 NEON_BACKUP_URL_4)
export REDACT_ENV_NAMES="${URL_NAMES[*]} NEON_TARGET_URL"
FAILS=()
TARGET_FAILS=()

# targets: the env var *names* of every configured Neon account, in fallback order. Values are
# read only inside the throwaway container and are never passed on argv or printed.
TARGETS=()
for name in "${URL_NAMES[@]}"; do
  [ -n "${!name:-}" ] && TARGETS+=("$name")
done

# --- dry run: print the plan (no URL needed, nothing executed) ---------------------------------
if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] databases: $DBS  (source container: $PG_CONTAINER)"
  if [ "${#TARGETS[@]}" -gt 0 ]; then echo "[dry-run] targets  : ${TARGETS[*]}"; else echo "[dry-run] targets  : none configured"; fi
  for db in $DBS; do
    printf '[dry-run] dump    : '; build_pg_dump_exec "$PG_CONTAINER" "$db" | show_cmd; echo "> \$WORK/$db.dump"
    for name in ${TARGETS[@]+"${TARGETS[@]}"}; do
      printf '[dry-run] restore : '; build_pg_restore_run | show_cmd; echo "< \$WORK/$db.dump   (target $name, database bk_$db)"
      echo "[dry-run] verify  : count(*) of the 10 biggest tables, tolerance max(${TOL_ABS}, ${TOL_PCT}%)"
    done
    echo "[dry-run] local   : age -r \$BACKUP_AGE_RECIPIENT -> $LOCAL_DIR/$db/${db}_${STAMP}.dump.age (keep $KEEP)"
  done
  exit 0
fi

# --- preflight ---------------------------------------------------------------------------------
[ "${#TARGETS[@]}" -gt 0 ] || die "no Neon backup URL set (NEON_BACKUP_URL[_2..4]; scripts/ops/set_server_env.sh NEON_BACKUP_URL)"
for name in ${TARGETS[@]+"${TARGETS[@]}"}; do
  python3 -I "$OFFSITE_TOOLS" check-url "$name"
  rc=$?
  if [ "$rc" = 3 ]; then die "$name is a pooler URL; use the DIRECT connection string (host without -pooler)"; fi
  if [ "$rc" != 0 ]; then die "$name is not a valid postgres:// URL"; fi
done
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

# restore_into_target <db> <url-name> <dump> <count-sql> <src-tsv>: create bk_<db> on that Neon
# account, restore, verify. Returns non-zero on failure (reason already logged).
restore_into_target() {
  local db="$1" name="$2" dump="$3" count_sql="$4" src_tsv="$5"
  local base="${!name}" target_url err="$WORK/$db.$name.err"
  target_url="$(python3 -I "$OFFSITE_TOOLS" url-db "$name" "bk_$db")" \
    || { log "[$db/$name] cannot build target URL"; return 1; }

  local admin_sql
  admin_sql="SELECT format('CREATE DATABASE %I', 'bk_${db}') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'bk_${db}') \\gexec"
  NEON_TARGET_URL="$base" neon_psql <<<"$admin_sql" >/dev/null 2>"$err" \
    || { log "[$db/$name] cannot create/see Neon database bk_$db: $(head -c 300 "$err")"; return 1; }

  log "[$db/$name] pg_restore into Neon bk_$db"
  local -a restore_argv=()
  while IFS= read -r -d '' a; do restore_argv+=("$a"); done < <(build_pg_restore_run)
  NEON_TARGET_URL="$target_url" "${restore_argv[@]}" <"$dump" >/dev/null 2>"$err"
  local rrc=$?
  if [ "$rrc" != 0 ]; then
    warn "[$db/$name] pg_restore exit $rrc (often harmless: extensions/roles); last lines: $(tail -n 3 "$err" | tr '\n' ' ' | head -c 400)"
  fi

  log "[$db/$name] verify row counts"
  NEON_TARGET_URL="$target_url" neon_psql <"$count_sql" >"$WORK/$db.$name.dst.tsv" 2>"$err" \
    || { log "[$db/$name] Neon count failed: $(head -c 300 "$err")"; return 1; }
  local diff
  if ! diff="$(python3 -I "$OFFSITE_TOOLS" compare "$src_tsv" "$WORK/$db.$name.dst.tsv" "$TOL_PCT" "$TOL_ABS")"; then
    log "[$db/$name] ROW COUNT MISMATCH: $(printf '%s' "$diff" | tr '\n' ';' | head -c 600)"
    return 1
  fi
  log "[$db/$name] verified $(wc -l <"$src_tsv" | tr -d ' ') tables"
  return 0
}

backup_one() { # <db>; returns non-zero when no target could take the database
  local db="$1" dump="$WORK/$1.dump"
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
  NEON_TARGET_URL="${!TARGETS[0]}" client NEON_TARGET_URL pg_restore -l <"$dump" >/dev/null 2>"$WORK/$db.err" \
    || { log "[$db] dump is not a readable archive: $(head -c 300 "$WORK/$db.err")"; return 1; }

  # local encrypted copy (best-effort; a failure here never hides the Neon result)
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

  local name any_ok=0
  for name in ${TARGETS[@]+"${TARGETS[@]}"}; do
    if restore_into_target "$db" "$name" "$dump" "$WORK/$db.count.sql" "$WORK/$db.src.tsv"; then
      any_ok=1
    else
      TARGET_FAILS+=("$name/$db")
    fi
  done
  [ "$any_ok" = 1 ]
}

for db in $DBS; do
  if ! backup_one "$db"; then FAILS+=("$db"); fi
done

# A target is "good" when it verified every database. Success requires at least one good target
# and no un-dumped database; individual spare-account failures are reported but not fatal.
GOOD_TARGETS=()
FAILED_TARGETS=()
for name in ${TARGETS[@]+"${TARGETS[@]}"}; do
  failed=0
  if [ "${#TARGET_FAILS[@]}" -gt 0 ]; then
    for entry in "${TARGET_FAILS[@]}"; do
      case "$entry" in "$name/"*) failed=1; break ;; esac
    done
  fi
  if [ "$failed" = 1 ]; then FAILED_TARGETS+=("$name"); else GOOD_TARGETS+=("$name"); fi
done

if [ "${#FAILS[@]}" -gt 0 ] || [ "${#GOOD_TARGETS[@]}" -eq 0 ]; then
  log "FAILED databases: ${FAILS[*]:-none}; failed targets: ${FAILED_TARGETS[*]:-none}"
  notify_owner "Neon off-site backup FAILED (databases: ${FAILS[*]:-none}; targets: ${FAILED_TARGETS[*]:-none}). See: journalctl -u roxira-neon-offsite -n 80"
  exit 1
fi

if [ "${#FAILED_TARGETS[@]}" -gt 0 ]; then
  warn "some Neon targets failed: ${FAILED_TARGETS[*]} (every database still verified on ${GOOD_TARGETS[*]})"
  notify_owner "Neon off-site backup partial: targets ${FAILED_TARGETS[*]} failed; still OK on ${GOOD_TARGETS[*]}. See: journalctl -u roxira-neon-offsite -n 80"
fi

log "all databases backed up and verified on: ${GOOD_TARGETS[*]}"
if due_since "$OFFSITE_STATE_DIR/neon.last_notice" $((6 * 86400 + 43200)); then
  notify_owner "Neon off-site backup OK (weekly note): $DBS restored and row counts verified on ${GOOD_TARGETS[*]}."
  : >"$OFFSITE_STATE_DIR/neon.last_notice"
fi
exit 0
