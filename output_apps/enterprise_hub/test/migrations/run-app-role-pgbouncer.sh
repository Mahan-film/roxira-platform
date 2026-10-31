#!/usr/bin/env bash
# Docker rehearsal of the parts run-app-role-e2e.sh cannot cover: login through the production
# PgBouncer image, and db_app_role.sh switch / rollback including the automatic rollback.
# Uses a private network, publishes no port and removes everything on exit.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SCRIPT="$ROOT/scripts/ops/db_app_role.sh"
PGB_IMAGE="$(sed -n 's/^ *image: \(edoburu\/pgbouncer@.*\)$/\1/p' "$ROOT/docker-compose.prod.yml")"
ID="rxapprole$$" NET="$ID-net" PG="$ID-pg" PGB="$ID-pgb" BACKEND="$ID-backend"
WORK="$(mktemp -d)"
cleanup() {
  (cd "$WORK" && docker compose -p "$ID" -f docker-compose.prod.yml down -v >/dev/null 2>&1) || true
  docker rm -f "$PG" "$PGB" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=enterprise_admin -e POSTGRES_PASSWORD=owner-test-only -e POSTGRES_DB=enterprise_db postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do docker exec "$PG" pg_isready -U enterprise_admin -d enterprise_db -q && break; sleep 1; done
sleep 2
docker exec -i "$PG" psql -q -U enterprise_admin -d enterprise_db -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE users (id serial PRIMARY KEY);
CREATE TABLE migrations (id serial PRIMARY KEY, name text);
CREATE TABLE audit_log (id bigserial PRIMARY KEY, tenant_id uuid, action text);
CREATE TABLE tenant_roles (id serial PRIMARY KEY, tenant_id uuid);
ALTER TABLE tenant_roles ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY p ON tenant_roles USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY p ON audit_log FOR SELECT USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
INSERT INTO tenant_roles (tenant_id) VALUES ('aaaaaaaa-0000-4000-8000-000000000001');
SQL
# Same settings as pgbouncer_prod in docker-compose.prod.yml.
docker run -d --name "$PGB" --network "$NET" -e DB_HOST="$PG" -e DB_PORT=5432 -e DB_USER=enterprise_admin \
  -e DB_PASSWORD=owner-test-only -e DB_NAME=enterprise_db -e AUTH_TYPE=scram-sha-256 -e POOL_MODE=transaction -e LISTEN_PORT=6432 -e LISTEN_ADDR=0.0.0.0 \
  -e IGNORE_STARTUP_PARAMETERS=extra_float_digits,options "$PGB_IMAGE" >/dev/null
sleep 3

compose_file() {  # compose_file <healthcheck command>
  cat > docker-compose.prod.yml <<YML
# marker for the switch guard: APP_DB_PASSWORD:-
services:
  $BACKEND:
    image: postgres:17-alpine
    container_name: $BACKEND
    command: ["sh", "-c", "sleep 600"]
    environment:
      - DATABASE_USER=\${APP_DB_USER:-enterprise_admin}
    healthcheck: { test: ["CMD-SHELL", "$1"], interval: 2s, timeout: 2s, retries: 2, start_period: 1s }
YML
}
cd "$WORK"
printf 'POSTGRES_PASSWORD=x\nOTHER=1\n' > .env
compose_file "true"
export APP_ROLE_PG_CONTAINER="$PG" APP_ROLE_PGB_HOST="$PGB" APP_ROLE_BACKEND_CONTAINER="$BACKEND"
export APP_ROLE_SECRET_FILE="$WORK/app_db.env" APP_ROLE_ENV_FILE="$WORK/.env" APP_ROLE_HEALTH_WAIT=30
export APP_ROLE_COMPOSE="docker compose -p $ID -f docker-compose.prod.yml"
on_owner() {  # backend on the owner role and .env free of the switch
  [ "$(user)" = enterprise_admin ] || { echo "FAIL: backend on $(user)"; exit 1; }
  if grep -q '^APP_DB_' .env; then echo "FAIL: .env still has APP_DB_*"; exit 1; fi
}
user() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$BACKEND" | sed -n 's/^DATABASE_USER=//p'; }

$APP_ROLE_COMPOSE up -d >/dev/null 2>&1
echo "== plan, apply, verify through PgBouncer"
bash "$SCRIPT" plan
bash "$SCRIPT" apply --yes
bash "$SCRIPT" verify

echo "== tenant setting works per transaction and does not outlive it (transaction pooling)"
got="$(APP_ROLE_PW="$(sed -n 's/^APP_DB_PASSWORD=//p' app_db.env)"; printf '%s\n' "$APP_ROLE_PW" | docker exec -i "$PG" sh -c \
  'read -r PGPASSWORD; export PGPASSWORD; psql -h "$0" -p 6432 -U roxira_app -d enterprise_db -qtAX \
   -c "BEGIN" -c "SELECT set_config('"'"'app.tenant_id'"'"', '"'"'aaaaaaaa-0000-4000-8000-000000000001'"'"', true)" \
   -c "SELECT count(*) FROM tenant_roles" -c "COMMIT" -c "SELECT count(*) FROM tenant_roles"' "$PGB" | tr '\n' ' ')"
[ "$got" = "aaaaaaaa-0000-4000-8000-000000000001 1 0 " ] || { echo "FAIL: got '$got'"; exit 1; }

echo "== switch"
bash "$SCRIPT" switch --yes 2>&1 | tail -2
[ "$(user)" = roxira_app ]; grep -q '^APP_DB_USER=roxira_app$' .env
echo "== rollback"
bash "$SCRIPT" rollback --yes 2>&1 | tail -1
on_owner; grep -q '^OTHER=1$' .env

echo "== switch rolls itself back when the backend turns unhealthy"
compose_file 'test $$DATABASE_USER = enterprise_admin'
if APP_ROLE_HEALTH_WAIT=15 bash "$SCRIPT" switch --yes > switch.log 2>&1; then fail=0; else fail=$?; fi
[ "$fail" -ne 0 ] || { echo "FAIL: switch did not report the failure"; exit 1; }
tail -3 switch.log
on_owner
echo "PGBOUNCER REHEARSAL PASSED"
