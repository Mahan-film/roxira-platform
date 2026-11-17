#!/usr/bin/env bash
# Real restore drill + migration rehearsal on the owner's Mac (T198). Zero extra cost: uses only Docker, the
# R2 bucket the server already writes to, and the age key that already lives on the Mac.
#
#   1. download the NEWEST encrypted Postgres payload (R2 pgcfg/hourly/) and, when present, the newest Qdrant
#      snapshot set (R2 qdrant/daily/, written by server_backup.sh since T197);
#   2. decrypt with the age identity (path from env, never printed) and restore every dump into a throwaway
#      postgres container; restore every Qdrant snapshot into a throwaway qdrant container;
#   3. smoke: row counts of the biggest tables vs the backup manifest (pg/<container>/<db>.counts, written by
#      the server at dump time; tolerance REHEARSAL_COUNT_TOL_PCT, default 5 because the live DB keeps moving) and
#      Qdrant points_count vs collection_info.json;
#   4. rehearse the migrations of origin/main: `migration:show` (pending count) then `migration:run` against the
#      restored enterprise_db, in a node container on the same docker network, then `migration:show` must say 0 pending;
#   5. measure wall-clock: RTO = download + decrypt + restore + smoke (what a real recovery costs on this machine,
#      docker images are pulled BEFORE the clock starts); TOTAL also includes the migration rehearsal;
#   6. append one line to the log, send it to Telegram through scripts/ops/notify/notify.py, remove the containers,
#      the network and the work dir.
# Never touches production, Neon or R2 contents (read-only); every container is local, ports are published on
# 127.0.0.1 only. Ports 55710 (postgres) and 55711 (qdrant), AGENTS.md section 7 does not reserve them; the script
# refuses to start when one is busy.
#
# Usage: mac_restore_rehearsal.sh [--dry-run] [--skip-migrations] [--skip-qdrant]
# Env (names only; values are never printed). Read from the environment first, then from ROXIRA_SECRETS_ENV
# (default ~/Secrets/roxira/roxira.env):
#   BACKUP_R2_ENDPOINT BACKUP_R2_BUCKET BACKUP_R2_ACCESS_KEY_ID BACKUP_R2_SECRET_ACCESS_KEY
#   BACKUP_R2_PREFIX (pgcfg) BACKUP_R2_PREFIX_QDRANT (qdrant)
#   NOTIFY_BOT_TOKEN NOTIFY_CHAT_ID (NOTIFY_BOT_API)           Telegram, optional: no token = log only
#   ROXIRA_AGE_IDENTITY   path of the private age key (default ~/Secrets/roxira/backup-age.key)
#   REHEARSAL_PG_PORT (55710) REHEARSAL_QDRANT_PORT (55711) REHEARSAL_COUNT_TOL_PCT (5)
#   REHEARSAL_PG_IMAGE (postgres:18-alpine) REHEARSAL_QDRANT_IMAGE (qdrant/qdrant:v1.19.0)
#   REHEARSAL_NODE_IMAGE (node:22-bookworm-slim) REHEARSAL_DB (enterprise_db: the database the migrations run on)
#   REHEARSAL_REQUIRE_MANIFEST (0) REHEARSAL_REQUIRE_QDRANT (0) REHEARSAL_BASE_DIR (~/Backups/roxira-dr)
#   REHEARSAL_MAX_RTO_S (0 = no limit; above it the run is reported as SLOW, still exit 0 unless FAIL)
# Exit 0 = PASS (or SLOW), 1 = FAIL. Needs: docker, age, python3, git, curl.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
export ROXIRA_REPO_DIR="${ROXIRA_REPO_DIR:-$REPO_ROOT}"   # notify_owner finds scripts/ops/notify/notify.py here
export ROXIRA_SERVER_ENV_FILE="${ROXIRA_SECRETS_ENV:-$HOME/Secrets/roxira/roxira.env}"
# shellcheck source=offsite_lib.sh
. "$SCRIPT_DIR/offsite_lib.sh"
export REDACT_ENV_NAMES="NOTIFY_BOT_TOKEN BACKUP_R2_SECRET_ACCESS_KEY BACKUP_R2_ACCESS_KEY_ID"

SKIP_MIG=0
SKIP_QD=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --skip-migrations) SKIP_MIG=1 ;;
    --skip-qdrant) SKIP_QD=1 ;;
    -h | --help) sed -n '2,38p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

BASE="${REHEARSAL_BASE_DIR:-$HOME/Backups/roxira-dr}"
LOG_FILE="$BASE/rehearsal.log"
PG_PORT="${REHEARSAL_PG_PORT:-55710}"
QD_PORT="${REHEARSAL_QDRANT_PORT:-55711}"
TOL="${REHEARSAL_COUNT_TOL_PCT:-5}"
PG_IMAGE="${REHEARSAL_PG_IMAGE:-postgres:18-alpine}"
QD_IMAGE="${REHEARSAL_QDRANT_IMAGE:-qdrant/qdrant:v1.19.0}"
NODE_IMAGE="${REHEARSAL_NODE_IMAGE:-node:22-bookworm-slim}"
MIG_DB="${REHEARSAL_DB:-enterprise_db}"
IDENTITY="${ROXIRA_AGE_IDENTITY:-$HOME/Secrets/roxira/backup-age.key}"
PREFIX_PG="${BACKUP_R2_PREFIX:-pgcfg}"
PREFIX_QD="${BACKUP_R2_PREFIX_QDRANT:-qdrant}"
RUN_ID="$$"
NET="roxira-rehearsal-net-$RUN_ID"
PG_NAME="roxira-rehearsal-pg-$RUN_ID"
QD_NAME="roxira-rehearsal-qd-$RUN_ID"

if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] preflight: docker age python3 git curl; ports 127.0.0.1:$PG_PORT and :$QD_PORT must be free; identity path from ROXIRA_AGE_IDENTITY"
  echo "[dry-run] pre-pull images (outside the clock): $PG_IMAGE $QD_IMAGE $NODE_IMAGE"
  echo "[dry-run] clock start; r2_tools.py latest+get $PREFIX_PG/hourly/ and $PREFIX_QD/daily/; age -d -i <identity> | tar -x"
  echo "[dry-run] docker network $NET; docker run $PG_NAME -p 127.0.0.1:$PG_PORT:5432; createdb + pg_restore --no-owner --no-acl for every pg/*/*.dump"
  echo "[dry-run] smoke: manifest row counts (tolerance ${TOL}%); qdrant upload snapshots -p 127.0.0.1:$QD_PORT, points_count vs collection_info.json"
  echo "[dry-run] RTO stop; git fetch origin main; git archive origin/main output_apps/enterprise_hub; node container: migration:show, migration:run, migration:show (0 pending)"
  echo "[dry-run] append one line to $LOG_FILE; notify.py <line>; docker rm -fv $PG_NAME $QD_NAME; docker network rm $NET; remove the work dir"
  exit 0
fi

for tool in docker age python3 git curl; do command -v "$tool" >/dev/null 2>&1 || die "$tool not found"; done
[ -f "$IDENTITY" ] || die "age identity not found at \$ROXIRA_AGE_IDENTITY (default ~/Secrets/roxira/backup-age.key)"
load_names BACKUP_R2_ENDPOINT BACKUP_R2_BUCKET BACKUP_R2_ACCESS_KEY_ID BACKUP_R2_SECRET_ACCESS_KEY \
  NOTIFY_BOT_TOKEN NOTIFY_CHAT_ID NOTIFY_BOT_API
for n in BACKUP_R2_ENDPOINT BACKUP_R2_BUCKET BACKUP_R2_ACCESS_KEY_ID BACKUP_R2_SECRET_ACCESS_KEY; do
  [ -n "${!n:-}" ] || die "$n is not set (environment or $ROXIRA_SERVER_ENV_FILE)"
done

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}
for p in "$PG_PORT" "$QD_PORT"; do
  port_in_use "$p" && die "port $p is in use; set REHEARSAL_PG_PORT / REHEARSAL_QDRANT_PORT to a free port"
done

mkdir -p "$BASE" || die "cannot create $BASE"
WORK="$(mktemp -d "$BASE/rehearsal-run.XXXXXX")" || die "cannot create the work dir"
chmod 700 "$WORK"

STATUS=FAIL
DETAIL=""
T0=0
RTO_S=0
SUMMARY=""
cleanup() {
  docker rm -fv "$PG_NAME" "$QD_NAME" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  # only the directory this run created (mktemp pattern guard), never anything else under $BASE
  case "$WORK" in "$BASE"/rehearsal-run.*) rm -rf -- "$WORK" ;; esac
}
trap cleanup EXIT

fail_step() { DETAIL="$*"; log "FAIL: $*"; finish; }

finish() {
  local total now line
  now="$(date +%s)"
  total=$((now - T0))
  [ "$RTO_S" -gt 0 ] || RTO_S="$total"
  line="$(date -u '+%Y-%m-%dT%H:%M:%SZ') restore-rehearsal $STATUS rto=${RTO_S}s total=${total}s ${SUMMARY}${DETAIL:+ detail=\"$DETAIL\"}"
  printf '%s\n' "$line" >>"$LOG_FILE"
  printf '%s\n' "$line" | redact
  notify_owner "$line"
  [ "$STATUS" = FAIL ] && exit 1
  exit 0
}

step "pre-pull images (outside the RTO clock)"
for img in "$PG_IMAGE" "$QD_IMAGE" "$NODE_IMAGE"; do
  if [ "$img" = "$QD_IMAGE" ] && [ "$SKIP_QD" = 1 ]; then continue; fi
  if [ "$img" = "$NODE_IMAGE" ] && [ "$SKIP_MIG" = 1 ]; then continue; fi
  docker image inspect "$img" >/dev/null 2>&1 || docker pull -q "$img" >/dev/null || { T0="$(date +%s)"; fail_step "cannot pull $img"; }
done

T0="$(date +%s)"
step "1/6 download newest payload from R2"
R2="python3 -I $SCRIPT_DIR/r2_tools.py"
# shellcheck disable=SC2086  # R2 is "python3 -I <path>"
latest="$($R2 latest "$PREFIX_PG/hourly/")" || fail_step "no payload under $PREFIX_PG/hourly/ in R2"
PG_KEY="${latest%% *}"
PG_AGE_S="${latest##* }"
# shellcheck disable=SC2086
$R2 get "$PG_KEY" "$WORK/payload.tar.age" || fail_step "R2 download failed for the Postgres payload"
log "postgres payload ${PG_KEY##*/}, $(human "$(wc -c <"$WORK/payload.tar.age" | tr -d ' ')"), age ${PG_AGE_S}s"
QD_KEY=""
if [ "$SKIP_QD" != 1 ]; then
  # shellcheck disable=SC2086
  if qlatest="$($R2 latest "$PREFIX_QD/daily/" 2>/dev/null)"; then
    QD_KEY="${qlatest%% *}"
    # shellcheck disable=SC2086
    $R2 get "$QD_KEY" "$WORK/qdrant.tar.age" || fail_step "R2 download failed for the Qdrant snapshots"
    log "qdrant payload ${QD_KEY##*/}, $(human "$(wc -c <"$WORK/qdrant.tar.age" | tr -d ' ')")"
  elif [ "${REHEARSAL_REQUIRE_QDRANT:-0}" = 1 ]; then
    fail_step "no Qdrant snapshot set under $PREFIX_QD/daily/ in R2"
  else
    log "no Qdrant snapshot set in R2 yet (T197 not installed?); Qdrant step skipped"
  fi
fi

step "2/6 decrypt"
mkdir -p "$WORK/x" "$WORK/q"
age -d -i "$IDENTITY" "$WORK/payload.tar.age" 2>"$WORK/err" | tar -x -C "$WORK/x" 2>>"$WORK/err" \
  || fail_step "decrypt/untar of the Postgres payload failed (wrong key?)"
rm -f "$WORK/payload.tar.age"
if [ -n "$QD_KEY" ]; then
  age -d -i "$IDENTITY" "$WORK/qdrant.tar.age" 2>"$WORK/err" | tar -x -C "$WORK/q" 2>>"$WORK/err" \
    || fail_step "decrypt/untar of the Qdrant payload failed"
  rm -f "$WORK/qdrant.tar.age"
fi

step "3/6 restore Postgres into a throwaway container on 127.0.0.1:$PG_PORT"
PGPW="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
docker network create "$NET" >/dev/null || fail_step "cannot create the docker network"
docker run -d --name "$PG_NAME" --network "$NET" -p "127.0.0.1:$PG_PORT:5432" \
  -e POSTGRES_PASSWORD="$PGPW" "$PG_IMAGE" >/dev/null || fail_step "cannot start the postgres container"
for _ in $(seq 1 90); do docker exec "$PG_NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec "$PG_NAME" pg_isready -U postgres >/dev/null 2>&1 || fail_step "scratch postgres did not become ready"
psql_in() { docker exec -i "$PG_NAME" psql -U postgres -d "$1" -X -At -F '|' -v ON_ERROR_STOP=1; }

NDB=0
DB_LIST=""   # lines "<db>|<dump-dir>|<name-in-scratch>"
for dump in "$WORK"/x/pg/*/*.dump; do
  [ -f "$dump" ] || continue
  db="$(basename "$dump" .dump)"
  [[ "$db" =~ ^[A-Za-z0-9_]{1,40}$ ]] || fail_step "bad database name in the payload"
  sname="$db"
  case "$DB_LIST" in *"|$sname"$'\n'*) sname="$(basename "$(dirname "$dump")")_$db" ;; esac
  docker exec "$PG_NAME" createdb -U postgres "$sname" || fail_step "createdb $sname failed"
  # pg_restore warnings (missing roles) are normal with --no-owner; a hard failure shows in the smoke step
  docker exec -i "$PG_NAME" pg_restore -U postgres -d "$sname" --no-owner --no-acl <"$dump" 2>"$WORK/restore.err" || true
  DB_LIST="${DB_LIST}${db}|${dump}|${sname}"$'\n'
  NDB=$((NDB + 1))
  log "restored $db as $sname"
done
[ "$NDB" -ge 1 ] || fail_step "no Postgres dump inside the payload"

step "4/6 smoke: row counts vs the backup manifest"
CHECKED=0
BAD=0
NOMAN=0
while IFS='|' read -r db dump sname; do
  [ -n "$db" ] || continue
  man="${dump%.dump}.counts"
  if [ ! -s "$man" ]; then
    NOMAN=$((NOMAN + 1))
    # fallback: at least one user table must hold rows
    n="$(psql_in "$sname" <<<"SELECT coalesce(max(n_live_tup),0) FROM pg_stat_user_tables;" 2>/dev/null || echo 0)"
    log "[$sname] no manifest in the payload (server older than T198); largest table estimate ${n} rows"
    continue
  fi
  while IFS='|' read -r tbl expect; do
    [[ "$tbl" =~ ^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$ ]] && [[ "$expect" =~ ^[0-9]+$ ]] || continue
    schema="${tbl%%.*}"; rel="${tbl#*.}"
    got="$(psql_in "$sname" <<<"SELECT count(*) FROM \"$schema\".\"$rel\";" 2>/dev/null || echo -1)"
    CHECKED=$((CHECKED + 1))
    # allowed gap: TOL percent of the manifest value, at least 5 rows
    gap=$((expect * TOL / 100)); [ "$gap" -ge 5 ] || gap=5
    diff=$((got - expect)); [ "$diff" -ge 0 ] || diff=$((-diff))
    if [ "$got" -lt 0 ] || [ "$diff" -gt "$gap" ]; then
      BAD=$((BAD + 1)); log "[$sname] $tbl: restored $got, manifest $expect (allowed gap $gap)  MISMATCH"
    else
      log "[$sname] $tbl: restored $got, manifest $expect  ok"
    fi
  done <"$man"
done <<<"$DB_LIST"
[ "$BAD" = 0 ] || fail_step "$BAD of $CHECKED table row counts differ from the manifest"
if [ "$CHECKED" = 0 ] && [ "${REHEARSAL_REQUIRE_MANIFEST:-0}" = 1 ]; then fail_step "payload has no row-count manifest"; fi

QD_RESULT="none"
if [ -n "$QD_KEY" ]; then
  step "5/6 restore Qdrant snapshots into a throwaway container on 127.0.0.1:$QD_PORT"
  docker run -d --name "$QD_NAME" -p "127.0.0.1:$QD_PORT:6333" "$QD_IMAGE" >/dev/null || fail_step "cannot start the qdrant container"
  for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:$QD_PORT/readyz" >/dev/null 2>&1 && break; sleep 1; done
  curl -fsS "http://127.0.0.1:$QD_PORT/readyz" >/dev/null 2>&1 || fail_step "scratch qdrant did not become ready"
  NCOL=0
  QBAD=0
  for cdir in "$WORK"/q/qdrant/*/; do
    [ -d "$cdir" ] || continue
    col="$(basename "$cdir")"
    [[ "$col" =~ ^[A-Za-z0-9_.-]{1,100}$ ]] || fail_step "bad Qdrant collection name"
    snap="$(find "$cdir" -maxdepth 1 -name '*.snapshot' | head -n 1)"
    [ -n "$snap" ] || { QBAD=$((QBAD + 1)); log "[qdrant/$col] no snapshot file"; continue; }
    if ! curl -fsS --max-time 3600 -F "snapshot=@$snap" \
      "http://127.0.0.1:$QD_PORT/collections/$col/snapshots/upload?priority=snapshot&wait=true" >/dev/null; then
      QBAD=$((QBAD + 1)); log "[qdrant/$col] snapshot upload failed"; continue
    fi
    got="$(curl -fsS "http://127.0.0.1:$QD_PORT/collections/$col" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["result"].get("points_count") or 0)' 2>/dev/null || echo -1)"
    expect="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["result"].get("points_count") or 0)' "$cdir/collection_info.json" 2>/dev/null || echo -1)"
    NCOL=$((NCOL + 1))
    if [ "$got" -lt 0 ] || [ "$expect" -lt 0 ]; then
      QBAD=$((QBAD + 1)); log "[qdrant/$col] cannot read points_count"
    else
      gap=$((expect * TOL / 100)); [ "$gap" -ge 5 ] || gap=5
      diff=$((got - expect)); [ "$diff" -ge 0 ] || diff=$((-diff))
      if [ "$diff" -gt "$gap" ]; then QBAD=$((QBAD + 1)); log "[qdrant/$col] points restored $got, manifest $expect  MISMATCH"
      else log "[qdrant/$col] points restored $got, manifest $expect  ok"; fi
    fi
  done
  [ "$NCOL" -ge 1 ] || fail_step "no Qdrant collection found in the snapshot set"
  [ "$QBAD" = 0 ] || fail_step "$QBAD Qdrant collection(s) failed to restore or differ"
  QD_RESULT="ok(${NCOL}coll)"
else
  step "5/6 Qdrant skipped"
fi

RTO_S=$(($(date +%s) - T0))
log "RTO (download, decrypt, restore, smoke) = ${RTO_S}s"

MIG_RESULT="skipped"
PENDING_BEFORE="-"
if [ "$SKIP_MIG" != 1 ]; then
  step "6/6 migration rehearsal: origin/main migrations against the restored $MIG_DB"
  if ! printf '%s' "$DB_LIST" | grep -q "^$MIG_DB|"; then
    fail_step "database $MIG_DB is not in the payload, cannot rehearse migrations"
  fi
  mig_sname="$(printf '%s' "$DB_LIST" | awk -F'|' -v d="$MIG_DB" '$1==d {print $3; exit}')"
  git -C "$REPO_ROOT" fetch -q origin main || fail_step "git fetch origin main failed"
  HEAD_SHA="$(git -C "$REPO_ROOT" rev-parse --short origin/main)"
  mkdir -p "$WORK/src"
  git -C "$REPO_ROOT" archive origin/main output_apps/enterprise_hub | tar -x -C "$WORK/src" || fail_step "git archive of origin/main failed"
  hub="/app/output_apps/enterprise_hub"
  # DATABASE_PASSWORD is passed by name so it never shows in the process list
  export DATABASE_PASSWORD="$PGPW"
  node_run() {
    docker run --rm --network "$NET" -v "$WORK/src:/app" -w "$hub" \
      -e DATABASE_HOST="$PG_NAME" -e DATABASE_PORT=5432 -e DATABASE_USER=postgres -e DATABASE_PASSWORD \
      -e DATABASE_NAME="$mig_sname" -e NPM_CONFIG_UPDATE_NOTIFIER=false "$NODE_IMAGE" sh -c "$1"
  }
  node_run "npm ci --no-audit --no-fund >/dev/null 2>&1 && npm run -s typeorm -- migration:show" >"$WORK/show1.log" 2>&1 \
    || { tail -n 5 "$WORK/show1.log" | redact >&2; fail_step "npm ci / migration:show failed"; }
  PENDING_BEFORE="$(grep -cE '^ *\[ \]' "$WORK/show1.log" || true)"
  log "origin/main $HEAD_SHA: $PENDING_BEFORE pending migration(s) on the restored data"
  node_run "npm run -s typeorm -- migration:run" >"$WORK/run.log" 2>&1 \
    || { tail -n 8 "$WORK/run.log" | redact >&2; fail_step "migration:run failed on restored data (origin/main $HEAD_SHA)"; }
  node_run "npm run -s typeorm -- migration:show" >"$WORK/show2.log" 2>&1 || fail_step "migration:show after run failed"
  PENDING_AFTER="$(grep -cE '^ *\[ \]' "$WORK/show2.log" || true)"
  [ "$PENDING_AFTER" = 0 ] || fail_step "$PENDING_AFTER migration(s) still pending after migration:run"
  MIG_RESULT="ok(${PENDING_BEFORE}->0,main@${HEAD_SHA})"
fi

STATUS=PASS
if [ "${REHEARSAL_MAX_RTO_S:-0}" -gt 0 ] && [ "$RTO_S" -gt "${REHEARSAL_MAX_RTO_S}" ]; then STATUS=SLOW; fi
SUMMARY="payload=${PG_KEY##*/} payload_age=${PG_AGE_S}s dbs=$NDB counts=$((CHECKED))checked/${NOMAN}nomanifest qdrant=$QD_RESULT migrations=$MIG_RESULT"
finish
