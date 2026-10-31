#!/usr/bin/env bash
# Restore drill: prove that an off-site copy can really be restored. Restores into a SCRATCH
# postgres container (no published port, tmpfs data, removed afterwards) and runs smoke queries.
# It never writes to production or to Neon. See docs/ops/OFFSITE_BACKUP.md.
#
# Usage:
#   restore_drill.sh [--dry-run] neon  [DB ...]            # pull bk_<db> from Neon, restore into scratch
#   restore_drill.sh [--dry-run] file  DUMP.dump.age DB --identity KEYFILE   # from a local encrypted dump
#   restore_drill.sh [--dry-run] payload PAYLOAD.tar.age --identity KEYFILE  # hourly Postgres+configs payload:
#                                         decrypt, untar, restore EVERY pg dump, check the config tarball reads
#   restore_drill.sh [--dry-run] r2 --identity KEYFILE   # download the newest R2 payload first, then as above.
#                                         Run this on the Mac (the private key never reaches srv1).
# Exit 0 = PASS, 1 = FAIL; the last log line says "restore drill passed" or "restore drill FAILED".
# Env: NEON_BACKUP_URL (direct string; read from env only), default DBs "enterprise_db umami",
#      DRILL_MIN_ROWS (1: the biggest table must have at least this many rows).
# Works on the server or on the owner's Mac (needs docker; `file` mode also needs age).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=offsite_lib.sh
. "$SCRIPT_DIR/offsite_lib.sh"

MODE="" ; FILE="" ; FILE_DB="" ; IDENTITY="" ; DBS_ARG=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --identity) IDENTITY="${2:?--identity needs a key file}"; shift ;;
    -h | --help) sed -n '2,20p' "$0"; exit 0 ;;
    neon | file | payload | r2) MODE="$1" ;;
    *) if [ "$MODE" = payload ] && [ -z "$FILE" ]; then FILE="$1"
       elif [ "$MODE" = file ] && [ -z "$FILE" ]; then FILE="$1"; elif [ "$MODE" = file ] && [ -z "$FILE_DB" ]; then FILE_DB="$1"; else DBS_ARG+=("$1"); fi ;;
  esac
  shift
done
[ -n "$MODE" ] || die "mode required: neon | file | payload | r2 (see --help)"

NAME="roxira-drill-$$"
MIN_ROWS="${DRILL_MIN_ROWS:-1}"
export REDACT_ENV_NAMES="NEON_BACKUP_URL NEON_TARGET_URL"

if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] docker run -d --name $NAME --tmpfs /var/lib/postgresql -e PGDATA=/var/lib/postgresql/data -e POSTGRES_PASSWORD=<random> $PG_CLIENT_IMAGE   (no published ports)"
  if [ "$MODE" = payload ] || [ "$MODE" = r2 ]; then
    echo "[dry-run] ${MODE}: [r2_tools.py latest + get] age -d -i <identity> | tar -x; for every pg/<container>/<db>.dump: createdb + pg_restore --no-owner --no-acl in $NAME, smoke queries; tar -tzf configs/configs.tar.gz"
  elif [ "$MODE" = neon ]; then
    echo "[dry-run] per DB: pg_dump -Fc from Neon bk_<db> (client container, URL via env name) | docker exec -i $NAME pg_restore --no-owner --no-acl"
  else
    echo "[dry-run] age -d -i <identity> $FILE | docker exec -i $NAME pg_restore --no-owner --no-acl"
  fi
  echo "[dry-run] smoke: count(*) of the 10 biggest tables, require the largest >= $MIN_ROWS rows"
  echo "[dry-run] docker rm -f $NAME"
  exit 0
fi

command -v docker >/dev/null 2>&1 || die "docker not found"
SCRATCH_PW="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

log "starting scratch container $NAME"
docker run -d --name "$NAME" --tmpfs /var/lib/postgresql -e PGDATA=/var/lib/postgresql/data -e POSTGRES_PASSWORD="$SCRATCH_PW" "$PG_CLIENT_IMAGE" >/dev/null || die "cannot start scratch container"
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 || die "scratch postgres did not become ready"

scratch_psql() { docker exec -i "$NAME" psql -U postgres -d "$1" -X -At -F '|' -v ON_ERROR_STOP=1; }

smoke() { # <db>
  local db="$1" sql lines biggest
  scratch_psql "$db" <<<"SELECT schemaname, relname FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;" >"$TMPDIR_DRILL/t.tsv" || return 1
  sql="$(python3 -I "$OFFSITE_TOOLS" count-sql <"$TMPDIR_DRILL/t.tsv")" || { log "[$db] no user tables after restore"; return 1; }
  lines="$(scratch_psql "$db" <<<"$sql")" || return 1
  printf '%s\n' "$lines" | sed 's/^/    /' >&2
  biggest="$(printf '%s\n' "$lines" | awk -F'|' 'BEGIN{m=0} {if ($2+0>m) m=$2+0} END{print m}')"
  if [ "$biggest" -lt "$MIN_ROWS" ]; then
    # Template databases hold a schema and no rows by design.
    case " ${DRILL_ALLOW_EMPTY_DBS:-agentdb_template} " in
      *" ${db%_[0-9]*} "*) log "[$db] empty by design, schema restored"; return 0 ;;
    esac
    log "[$db] largest table has only $biggest rows (< $MIN_ROWS)"; return 1
  fi
  return 0
}

TMPDIR_DRILL="$(mktemp -d "${TMPDIR:-/tmp}/drill.XXXXXX")"
trap 'cleanup; rm -f -- "$TMPDIR_DRILL"/* 2>/dev/null; rmdir -- "$TMPDIR_DRILL" 2>/dev/null || true' EXIT
FAIL=0

restore_stream_into_scratch() { # <db>; dump on stdin
  docker exec "$NAME" createdb -U postgres "$1" || return 1
  docker exec -i "$NAME" pg_restore -U postgres -d "$1" --no-owner --no-acl 2>"$TMPDIR_DRILL/restore.err"
}

if [ "$MODE" = neon ]; then
  load_names NEON_BACKUP_URL
  [ -n "${NEON_BACKUP_URL:-}" ] || die "NEON_BACKUP_URL is not set"
  DBS="${DBS_ARG[*]:-enterprise_db umami}"
  for db in $DBS; do
    [[ "$db" =~ ^[a-z0-9_]{1,40}$ ]] || { log "bad db name $db"; FAIL=1; continue; }
    NEON_TARGET_URL="$(python3 -I "$OFFSITE_TOOLS" url-db NEON_BACKUP_URL "bk_$db")" || { FAIL=1; continue; }
    export NEON_TARGET_URL
    log "[$db] pulling bk_$db from Neon and restoring into scratch"
    # default bridge network is enough for outbound access to Neon (works on Linux and Docker Desktop)
    if docker run --rm -i -e NEON_TARGET_URL "$PG_CLIENT_IMAGE" sh -c 'exec pg_dump -Fc --no-owner --no-acl "$NEON_TARGET_URL"' 2>"$TMPDIR_DRILL/dump.err" \
      | restore_stream_into_scratch "$db"; then
      smoke "$db" && log "[$db] DRILL OK" || { log "[$db] DRILL FAILED (smoke)"; FAIL=1; }
    else
      log "[$db] DRILL FAILED (restore): $(head -c 300 "$TMPDIR_DRILL/dump.err" "$TMPDIR_DRILL/restore.err" 2>/dev/null | tr '\n' ' ')"
      FAIL=1
    fi
  done
elif [ "$MODE" = payload ] || [ "$MODE" = r2 ]; then
  [ -f "$IDENTITY" ] || die "$MODE mode needs --identity KEYFILE"
  command -v age >/dev/null || die "age not found"
  if [ "$MODE" = r2 ]; then
    load_names BACKUP_R2_ENDPOINT BACKUP_R2_BUCKET BACKUP_R2_ACCESS_KEY_ID BACKUP_R2_SECRET_ACCESS_KEY BACKUP_R2_PREFIX
    latest_line="$(python3 -I "$SCRIPT_DIR/r2_tools.py" latest "${BACKUP_R2_PREFIX:-pgcfg}/hourly/")" || die "no R2 payload found"
    FILE="$TMPDIR_DRILL/payload.tar.age"
    python3 -I "$SCRIPT_DIR/r2_tools.py" get "${latest_line%% *}" "$FILE" || die "R2 download failed"
    log "downloaded ${latest_line%% *} (age ${latest_line##* } s)"
  fi
  [ -f "$FILE" ] || die "payload file missing"
  mkdir -p "$TMPDIR_DRILL/x"
  if ! age -d -i "$IDENTITY" "$FILE" | tar -x -C "$TMPDIR_DRILL/x" 2>"$TMPDIR_DRILL/dec.err"; then
    log "DRILL FAILED (decrypt/untar): $(head -c 300 "$TMPDIR_DRILL/dec.err" | tr '\n' ' ')"; FAIL=1
  else
    n=0
    for dump in "$TMPDIR_DRILL"/x/pg/*/*.dump; do
      [ -f "$dump" ] || continue
      n=$((n + 1))
      db="$(basename "$dump" .dump)"
      [[ "$db" =~ ^[A-Za-z0-9_]{1,40}$ ]] || { log "bad db name $db"; FAIL=1; continue; }
      sdb="$(printf '%s' "$db" | tr 'A-Z' 'a-z')_$n"   # unique per dump even if two containers share a name
      log "[$sdb] restoring $(basename "$(dirname "$dump")")/$db"
      if restore_stream_into_scratch "$sdb" <"$dump"; then
        smoke "$sdb" && log "[$sdb] DRILL OK" || { log "[$sdb] DRILL FAILED (smoke)"; FAIL=1; }
      else
        log "[$sdb] DRILL FAILED (restore): $(head -c 300 "$TMPDIR_DRILL/restore.err" | tr '\n' ' ')"; FAIL=1
      fi
    done
    [ "$n" -ge 1 ] || { log "DRILL FAILED: no Postgres dump in the payload"; FAIL=1; }
    if [ -s "$TMPDIR_DRILL/x/configs/configs.tar.gz" ] && tar -tzf "$TMPDIR_DRILL/x/configs/configs.tar.gz" >/dev/null 2>&1; then
      log "config tarball readable"
    else
      log "DRILL FAILED: config tarball missing or unreadable"; FAIL=1
    fi
    rm -rf -- "$TMPDIR_DRILL/x"
  fi
else
  [ -f "$FILE" ] && [ -n "$FILE_DB" ] && [ -f "$IDENTITY" ] || die "file mode needs: DUMP.dump.age DB --identity KEYFILE"
  command -v age >/dev/null 2>&1 || die "age not found"
  [[ "$FILE_DB" =~ ^[a-z0-9_]{1,40}$ ]] || die "bad db name"
  log "[$FILE_DB] decrypting $FILE into scratch"
  if age -d -i "$IDENTITY" "$FILE" | restore_stream_into_scratch "$FILE_DB"; then
    smoke "$FILE_DB" && log "[$FILE_DB] DRILL OK" || { log "[$FILE_DB] DRILL FAILED (smoke)"; FAIL=1; }
  else
    log "[$FILE_DB] DRILL FAILED (restore): $(head -c 300 "$TMPDIR_DRILL/restore.err" 2>/dev/null | tr '\n' ' ')"
    FAIL=1
  fi
fi

[ "$FAIL" = 0 ] && log "restore drill passed" || log "restore drill FAILED"
exit "$FAIL"
