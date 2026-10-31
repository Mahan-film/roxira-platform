#!/usr/bin/env bash
# Throwaway-database rehearsal of docs/ops/APP_DB_ROLE.md: builds a private Postgres, runs every
# migration as the owner, then runs scripts/ops/db_app_role.sh and all e2e suites as the restricted
# role. Never touches another database. Needs initdb on PATH or PG_BIN, and npm ci in the hub.
set -euo pipefail
export LC_ALL=C
HUB="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="$(cd "$HUB/../.." && pwd)"
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@15/bin}"
export PATH="$PG_BIN:$PATH"
WORK="$(mktemp -d)"
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
OWNER=enterprise_admin DBNAME=roxira_role_test OWNER_PW=owner-test-only

cleanup() { pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

printf '%s' "$OWNER_PW" > "$WORK/pw"
initdb -D "$WORK/data" -U "$OWNER" --pwfile="$WORK/pw" -A scram-sha-256 -E UTF8 >/dev/null
pg_ctl -D "$WORK/data" -w -l "$WORK/pg.log" \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start >/dev/null
export PGPASSWORD="$OWNER_PW"
createdb -h 127.0.0.1 -p "$PORT" -U "$OWNER" "$DBNAME"

cd "$HUB"
export DATABASE_HOST=127.0.0.1 DATABASE_PORT="$PORT" DATABASE_USER="$OWNER" DATABASE_PASSWORD="$OWNER_PW" DATABASE_NAME="$DBNAME"
echo "== migrations as the owner"
node_modules/.bin/typeorm-ts-node-commonjs -d data-source.ts migration:run 2>&1 | tail -1

ROLE_SCRIPT="$ROOT/scripts/ops/db_app_role.sh"
export APP_ROLE_DB="$DBNAME" APP_ROLE_SECRET_FILE="$WORK/app_db.env"
export APP_ROLE_ADMIN_PSQL="psql -h 127.0.0.1 -p $PORT -U $OWNER -d $DBNAME"
export APP_ROLE_APP_PSQL="psql -h 127.0.0.1 -p ${APP_PROXY_PORT:-$PORT} -U roxira_app -d $DBNAME"

echo "== plan leaves no trace"
bash "$ROLE_SCRIPT" plan
[ "$($APP_ROLE_ADMIN_PSQL -qtAX -c "select count(*) from pg_roles where rolname='roxira_app'")" = 0 ]
echo "== apply twice (idempotent), then verify"
bash "$ROLE_SCRIPT" apply --yes
bash "$ROLE_SCRIPT" apply --yes
[ "$(stat -f %Lp "$WORK/app_db.env" 2>/dev/null || stat -c %a "$WORK/app_db.env")" = 600 ]
bash "$ROLE_SCRIPT" verify

echo "== a table from a later migration reaches the role"
$APP_ROLE_ADMIN_PSQL -q -c "create table later_table (id serial primary key)"
APP_PW="$(sed -n 's/^APP_DB_PASSWORD=//p' "$WORK/app_db.env")"
PGPASSWORD="$APP_PW" $APP_ROLE_APP_PSQL -qtAX -c "insert into later_table default values returning id" | grep -qx 1
$APP_ROLE_ADMIN_PSQL -q -c "drop table later_table"

echo "== audit"
bash "$ROLE_SCRIPT" audit | tail -5

echo "== all e2e as roxira_app"
DATABASE_USER=roxira_app DATABASE_PASSWORD="$APP_PW" APP_E2E_ADMIN_PASSWORD="$OWNER_PW" \
  node_modules/.bin/jest --config ./test/jest-e2e.json --runInBand --silent 2>&1 | grep -vE "LOG|^\s*$" | tail -"${E2E_TAIL:-30}"
echo "APP ROLE REHEARSAL PASSED"
