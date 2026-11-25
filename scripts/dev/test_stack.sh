#!/usr/bin/env bash
# Manage the local multi-lane test stack: Postgres 17, Valkey 8, Qdrant (#1319).
# Runs on unreserved ports (AGENTS.md sec 7) with low memory limits.
# Supports sharing one stack across multiple lanes with one database per lane.
#
# Usage:
#   bash scripts/dev/test_stack.sh up              # Start containers, bootstrap roxira_app, print env
#   bash scripts/dev/test_stack.sh down            # Stop test containers
#   bash scripts/dev/test_stack.sh status          # Check health and print connection info
#   bash scripts/dev/test_stack.sh create-db <id>  # Create isolated database for a lane (e.g. l1, l2)
#   bash scripts/dev/test_stack.sh env [lane_id]   # Print shell export lines
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.test.yml"

PG_PORT="${ROXIRA_TEST_PG_PORT:-54380}"
PG_PASSWORD="${ROXIRA_TEST_PG_PASSWORD:-}"
PG_APP_PASSWORD="${ROXIRA_TEST_PG_APP_PASSWORD:-}"
VALKEY_PORT="${ROXIRA_TEST_VALKEY_PORT:-6385}"
QDRANT_PORT="${ROXIRA_TEST_QDRANT_PORT:-6338}"
QDRANT_GRPC_PORT="${ROXIRA_TEST_QDRANT_GRPC_PORT:-6339}"

require_passwords() {
  if [ -z "$PG_PASSWORD" ] || [ -z "$PG_APP_PASSWORD" ]; then
    echo "test_stack.sh: ERROR: ROXIRA_TEST_PG_PASSWORD and ROXIRA_TEST_PG_APP_PASSWORD must be set." >&2
    exit 2
  fi
}

print_env() {
  local db="${1:-roxira_test}"
  cat <<EOF
# Roxira local test stack environment (#1319)
export ROXIRA_TEST_PG_HOST=127.0.0.1
export ROXIRA_TEST_PG_PORT=$PG_PORT
export ROXIRA_TEST_PG_USER=postgres
export ROXIRA_TEST_PG_PASSWORD=${PG_PASSWORD}
export ROXIRA_TEST_PG_ADMIN_USER=postgres
export ROXIRA_TEST_PG_ADMIN_PASSWORD=${PG_PASSWORD}
export ROXIRA_TEST_PG_APP_USER=roxira_app
export ROXIRA_TEST_PG_APP_PASSWORD=${PG_APP_PASSWORD}
export ROXIRA_TEST_PG_DB=$db
export ROXIRA_TEST_VALKEY_PORT=$VALKEY_PORT
export ROXIRA_TEST_REDIS_PORT=$VALKEY_PORT
export ROXIRA_TEST_QDRANT_HOST=127.0.0.1
export ROXIRA_TEST_QDRANT_PORT=$QDRANT_PORT
export ROXIRA_TEST_QDRANT_URL=http://127.0.0.1:$QDRANT_PORT
EOF
}

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "test_stack.sh: ERROR: docker is not installed." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "test_stack.sh: ERROR: docker daemon is not running." >&2
    exit 1
  fi
}

cmd_up() {
  check_docker
  require_passwords

  echo "test_stack.sh: starting local test stack..."
  docker compose -f "$COMPOSE_FILE" up -d

  echo "test_stack.sh: waiting for services to become healthy..."
  local timeout=45
  local elapsed=0
  while [ $elapsed -lt $timeout ]; do
    local pg_status valkey_status qdrant_status
    pg_status="$(docker inspect --format='{{.State.Health.Status}}' roxira_test_postgres 2>/dev/null || echo 'starting')"
    valkey_status="$(docker inspect --format='{{.State.Health.Status}}' roxira_test_valkey 2>/dev/null || echo 'starting')"
    qdrant_status="$(docker inspect --format='{{.State.Health.Status}}' roxira_test_qdrant 2>/dev/null || echo 'starting')"

    if [ "$pg_status" = "healthy" ] && [ "$valkey_status" = "healthy" ] && [ "$qdrant_status" = "healthy" ]; then
      break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  # Verify roxira_app role and default database permissions
  docker compose -f "$COMPOSE_FILE" exec -T postgres_test psql -v ON_ERROR_STOP=1 -v app_pwd="$PG_APP_PASSWORD" -U postgres -d roxira_test >/dev/null <<'EOSQL'
SELECT format(
  'CREATE ROLE roxira_app WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE',
  :'app_pwd'
)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'roxira_app') \gexec
GRANT ALL PRIVILEGES ON DATABASE roxira_test TO roxira_app;
GRANT ALL ON SCHEMA public TO roxira_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO roxira_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO roxira_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO roxira_app;
EOSQL

  echo "test_stack.sh: test stack is ready."
  echo ""
  print_env "roxira_test"
}

cmd_down() {
  check_docker
  echo "test_stack.sh: stopping test stack..."
  docker compose -f "$COMPOSE_FILE" down
  echo "test_stack.sh: stopped."
}

cmd_status() {
  check_docker
  echo "=== Roxira Test Stack Status ==="
  docker compose -f "$COMPOSE_FILE" ps
  echo ""
  local pg_health
  pg_health="$(docker inspect --format='{{.State.Health.Status}}' roxira_test_postgres 2>/dev/null || echo 'not running')"
  echo "Postgres: $pg_health (Port $PG_PORT)"
  local valkey_health
  valkey_health="$(docker inspect --format='{{.State.Health.Status}}' roxira_test_valkey 2>/dev/null || echo 'not running')"
  echo "Valkey:   $valkey_health (Port $VALKEY_PORT)"
  local qdrant_health
  qdrant_health="$(docker inspect --format='{{.State.Health.Status}}' roxira_test_qdrant 2>/dev/null || echo 'not running')"
  echo "Qdrant:   $qdrant_health (HTTP Port $QDRANT_PORT, gRPC Port $QDRANT_GRPC_PORT)"
  echo ""
  if [ "$pg_health" = "healthy" ]; then
    print_env "roxira_test"
  fi
}

cmd_create_db() {
  local lane_input="${1:-}"
  if [ -z "$lane_input" ]; then
    echo "usage: $0 create-db <lane_id_or_db_name> (e.g. l1, l2, roxira_test_l3)" >&2
    exit 2
  fi
  if ! [[ "$lane_input" =~ ^[a-zA-Z0-9_-]{1,50}$ ]]; then
    echo "error: invalid lane_id_or_db_name '$lane_input' (allowed: [a-zA-Z0-9_-], max 50 chars)" >&2
    exit 2
  fi
  check_docker

  local db_name="$lane_input"
  case "$db_name" in
    roxira_test_*) ;;
    *) db_name="roxira_test_${lane_input}" ;;
  esac

  echo "test_stack.sh: creating isolated database '$db_name' for lane '$lane_input'..."
  docker compose -f "$COMPOSE_FILE" exec -T postgres_test psql -v ON_ERROR_STOP=1 -v db_name="$db_name" -U postgres -d roxira_test >/dev/null <<'EOSQL'
SELECT format('CREATE DATABASE %I OWNER postgres', :'db_name')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db_name') \gexec
EOSQL

  docker compose -f "$COMPOSE_FILE" exec -T postgres_test psql -v ON_ERROR_STOP=1 -v db_name="$db_name" -U postgres -d "$db_name" >/dev/null <<'EOSQL'
SELECT format('GRANT ALL PRIVILEGES ON DATABASE %I TO roxira_app', :'db_name') \gexec
GRANT ALL ON SCHEMA public TO roxira_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO roxira_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO roxira_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO roxira_app;
EOSQL

  echo "test_stack.sh: database '$db_name' ready."
  echo ""
  print_env "$db_name"
}

action="${1:-status}"
shift || true

case "$action" in
  up)
    cmd_up
    ;;
  down)
    cmd_down
    ;;
  status)
    cmd_status
    ;;
  env)
    target_lane="${1:-roxira_test}"
    case "$target_lane" in
      roxira_test*) print_env "$target_lane" ;;
      *) print_env "roxira_test_${target_lane}" ;;
    esac
    ;;
  create-db)
    cmd_create_db "${1:-}"
    ;;
  *)
    echo "usage: $0 {up|down|status|env|create-db <lane>}" >&2
    exit 2
    ;;
esac
