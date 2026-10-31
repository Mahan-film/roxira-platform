#!/usr/bin/env bash
# Build the enterprise hub database from zero with the TypeORM migrations and check that
# the result is repeatable. Run by scripts/dev/local_ci.sh when migrations change, or directly.
#
#   1. start a throwaway Postgres 17 container (tmpfs, host network, free port);
#   2. migration:run on the empty database            -> every migration must succeed;
#   3. migration:run again                            -> nothing may be pending;
#   4. forget the baseline row and run it once more on the fully migrated schema
#      (the production situation: the legacy tables already exist) -> schema must be
#      byte-identical before and after, i.e. the baseline is a no-op there;
#   5. migration:revert every migration, then migration:run again -> must succeed.
#
# Needs docker and `npm ci` done in output_apps/enterprise_hub. Never touches any other
# database: it only talks to the container it started, and removes it on exit.
#
# Env: FRESH_DB_PORT (default 55432), FRESH_DB_IMAGE (default postgres:17),
#      FRESH_DB_SKIP_REVERT=1 to skip step 5.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HUB="$ROOT/output_apps/enterprise_hub"
PORT="${FRESH_DB_PORT:-55432}"
IMAGE="${FRESH_DB_IMAGE:-postgres:17}"
CTR="rx-fresh-db-$$"
BASELINE="LegacyBaseline1789000000000"
WORK="$(mktemp -d)"

log() { printf '[fresh-db] %s\n' "$*"; }
die() { printf '[fresh-db] FAIL: %s\n' "$*" >&2; exit 1; }
cleanup() { docker rm -f "$CTR" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

[ -d "$HUB/node_modules" ] || die "run 'npm ci' in output_apps/enterprise_hub first"

# Port reservation policy (AGENTS.md §7): never bind to a port in use.
port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -tln | awk '{print $4}' | grep -Eq "[:.]$1\$"
  else
    local hex; hex="$(printf '%04X' "$1")"
    awk 'NR>1 && $4=="0A" {print $2}' /proc/net/tcp /proc/net/tcp6 2>/dev/null | grep -q ":$hex\$"
  fi
}
port_in_use "$PORT" && die "port $PORT is in use; set FRESH_DB_PORT to a free port"

log "starting $IMAGE on 127.0.0.1:$PORT"
# Docker Desktop's host network does not reach the Mac, so publish the port there instead.
if [ "$(uname -s)" = "Darwin" ]; then
  NET_ARGS=(-p "127.0.0.1:$PORT:$PORT"); LISTEN='*'
else
  NET_ARGS=(--network host); LISTEN=127.0.0.1
fi
docker run -d --name "$CTR" "${NET_ARGS[@]}" --tmpfs /var/lib/postgresql \
  -e PGPORT="$PORT" -e POSTGRES_USER=rx -e POSTGRES_PASSWORD=rx -e POSTGRES_DB=rxfresh \
  "$IMAGE" -c "listen_addresses=$LISTEN" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$CTR" pg_isready -q -h 127.0.0.1 -p "$PORT" -U rx -d rxfresh 2>/dev/null && break
  sleep 1
done
docker exec "$CTR" pg_isready -q -h 127.0.0.1 -p "$PORT" -U rx -d rxfresh || die "postgres did not become ready"

export DATABASE_HOST=127.0.0.1 DATABASE_PORT="$PORT" DATABASE_USER=rx DATABASE_PASSWORD=rx DATABASE_NAME=rxfresh
psql_q() { docker exec "$CTR" psql -h 127.0.0.1 -p "$PORT" -U rx -d rxfresh -v ON_ERROR_STOP=1 -Atc "$1"; }
schema_dump() { docker exec "$CTR" pg_dump -h 127.0.0.1 -p "$PORT" -U rx -d rxfresh --schema-only --no-owner --no-privileges |
  grep -Ev '^\\(un)?restrict '; }  # pg_dump 17.6+ prints a random per-dump token
typeorm() { (cd "$HUB" && npm run -s "$@") >"$WORK/out.log" 2>&1 || { tail -30 "$WORK/out.log" >&2; return 1; }; }

[ "$(psql_q "select count(*) from pg_tables where schemaname='public'")" = 0 ] || die "database is not empty"

log "1/4 migration:run on an empty database"
typeorm migration:run || die "migrations failed on an empty database"
ran="$(grep -c 'has been executed successfully' "$WORK/out.log" || true)"
total="$(find "$HUB/migrations" -maxdepth 1 -name '*.ts' | wc -l | tr -d ' ')"
[ "$ran" = "$total" ] || die "ran $ran of $total migrations"
log "    $ran migrations executed"

log "2/4 migration:run again (must be a no-op)"
typeorm migration:run || die "second migration:run failed"
grep -q 'No migrations are pending' "$WORK/out.log" || die "second run executed something: $(cat "$WORK/out.log")"

log "3/4 baseline on an already migrated schema (production case) must change nothing"
schema_dump >"$WORK/before.sql"
psql_q "delete from migrations where name = '$BASELINE'" >/dev/null
typeorm migration:run || die "baseline failed on a migrated schema"
grep -q "Migration $BASELINE has been executed successfully" "$WORK/out.log" || die "baseline did not run"
schema_dump >"$WORK/after.sql"
diff -u "$WORK/before.sql" "$WORK/after.sql" || die "baseline changed an existing schema"

if [ "${FRESH_DB_SKIP_REVERT:-0}" = 1 ]; then
  log "4/4 revert skipped (FRESH_DB_SKIP_REVERT=1)"
else
  log "4/4 migration:revert all $total, then migration:run again"
  for i in $(seq 1 "$total"); do
    typeorm migration:revert || die "revert #$i failed"
  done
  [ "$(psql_q 'select count(*) from migrations')" = 0 ] || die "migrations table not empty after revert"
  typeorm migration:run || die "migration:run after a full revert failed"
  ran="$(grep -c 'has been executed successfully' "$WORK/out.log" || true)"
  [ "$ran" = "$total" ] || die "re-run after revert executed $ran of $total migrations"
fi

log "OK: $(psql_q "select count(*) from pg_tables where schemaname='public'") tables, $total migrations"
