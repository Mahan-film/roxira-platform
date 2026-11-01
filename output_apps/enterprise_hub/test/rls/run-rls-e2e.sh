#!/usr/bin/env bash
# Tenant-isolation proof for the RLS rollout: real PostgreSQL 17 and the production PgBouncer image
# in transaction mode; the spec connects as the non-superuser `roxira_app` through PgBouncer.
# Publishes two ports on 127.0.0.1 only for the run and removes everything on exit.
#   bash output_apps/enterprise_hub/test/rls/run-rls-e2e.sh
set -euo pipefail
HUB="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="$(cd "$HUB/../.." && pwd)"
PGB_IMAGE="$(sed -n 's/^ *image: \(edoburu\/pgbouncer@.*\)$/\1/p' "$ROOT/docker-compose.prod.yml")"
ID="rxrls$$" NET="$ID-net" PG="$ID-pg" PGB="$ID-pgb"
PG_PORT="${RLS_PG_PORT:-55461}" PGB_PORT="${RLS_PGB_PORT:-55462}"
for p in "$PG_PORT" "$PGB_PORT"; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then echo "port $p is busy; set RLS_PG_PORT / RLS_PGB_PORT"; exit 1; fi
done
cleanup() { docker rm -f "$PG" "$PGB" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" -p "127.0.0.1:$PG_PORT:5432" --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=enterprise_admin -e POSTGRES_PASSWORD=owner-test-only -e POSTGRES_DB=postgres postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do docker exec "$PG" pg_isready -U enterprise_admin -q && break; sleep 1; done
sleep 2
# Same settings as pgbouncer_prod in docker-compose.prod.yml.
docker run -d --name "$PGB" --network "$NET" -p "127.0.0.1:$PGB_PORT:6432" -e DB_HOST="$PG" -e DB_PORT=5432 \
  -e DB_USER=enterprise_admin -e DB_PASSWORD=owner-test-only -e AUTH_TYPE=scram-sha-256 -e POOL_MODE=transaction \
  -e LISTEN_PORT=6432 -e LISTEN_ADDR=0.0.0.0 -e IGNORE_STARTUP_PARAMETERS=extra_float_digits,options \
  -e MAX_CLIENT_CONN=200 -e DEFAULT_POOL_SIZE=2 "$PGB_IMAGE" >/dev/null
sleep 3

cd "$HUB"
ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT="$PG_PORT" ROXIRA_TEST_PG_USER=enterprise_admin \
ROXIRA_TEST_PG_PASSWORD=owner-test-only ROXIRA_TEST_PGB_HOST=127.0.0.1 ROXIRA_TEST_PGB_PORT="$PGB_PORT" \
  npx jest modules/access/rls/tenant-rls.pg.spec.ts --runInBand "$@"
