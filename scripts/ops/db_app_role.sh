#!/usr/bin/env bash
# Move the NestJS backend from the superuser to a restricted role, so row-level security applies.
# Runbook: docs/ops/APP_DB_ROLE.md. Run on the server from the repo root.
#
#   scripts/ops/db_app_role.sh audit             # read-only: RLS state of every table
#   scripts/ops/db_app_role.sh plan              # dry run: applies the grants in a transaction, then rolls back
#   scripts/ops/db_app_role.sh apply --yes       # create/refresh the role and grants; backend untouched
#   scripts/ops/db_app_role.sh verify            # read-only: checks the role through PgBouncer
#   scripts/ops/db_app_role.sh switch --yes      # point the backend at the role; rolls back itself if unhealthy
#   scripts/ops/db_app_role.sh rollback --yes    # point the backend back at the owner role
#
# The password never appears in arguments or output. It lives in $APP_ROLE_SECRET_FILE (mode 600).
set -euo pipefail

ROLE="roxira_app"
OWNER="${APP_ROLE_OWNER:-enterprise_admin}"
DB="${APP_ROLE_DB:-enterprise_db}"
PG="${APP_ROLE_PG_CONTAINER:-roxira_postgres_prod}"
BACKEND="${APP_ROLE_BACKEND_CONTAINER:-roxira_enterprise_backend}"
PGB_HOST="${APP_ROLE_PGB_HOST:-roxira_pgbouncer}"
PGB_PORT="${APP_ROLE_PGB_PORT:-6432}"
SECRET_FILE="${APP_ROLE_SECRET_FILE:-/etc/roxira/app_db.env}"
ENV_FILE="${APP_ROLE_ENV_FILE:-.env}"
COMPOSE="${APP_ROLE_COMPOSE:-docker compose -f docker-compose.prod.yml}"
HEALTH_WAIT="${APP_ROLE_HEALTH_WAIT:-120}"

log() { printf '[app-role] %s\n' "$*"; }
die() { printf '[app-role] FAIL: %s\n' "$*" >&2; exit 1; }

# APP_ROLE_ADMIN_PSQL and APP_ROLE_APP_PSQL replace the docker commands in the throwaway-database test.
admin_psql() {
  if [ -n "${APP_ROLE_ADMIN_PSQL:-}" ]; then ${APP_ROLE_ADMIN_PSQL} "$@"
  else docker exec -i "$PG" psql -U "$OWNER" -d "$DB" "$@"; fi
}
app_sql() {  # app_sql <sql>: run one statement as the role, through PgBouncer
  local pw; pw="$(secret)"
  if [ -n "${APP_ROLE_APP_PSQL:-}" ]; then
    PGPASSWORD="$pw" ${APP_ROLE_APP_PSQL} -v ON_ERROR_STOP=1 -qtAX -c "$1"
  else
    printf '%s\n%s\n' "$pw" "$1" | docker exec -i "$PG" sh -c \
      'read -r PGPASSWORD; export PGPASSWORD; exec psql -h "$0" -p "$1" -U "$2" -d "$3" -v ON_ERROR_STOP=1 -qtAX' \
      "$PGB_HOST" "$PGB_PORT" "$ROLE" "$DB"
  fi
}
secret() {
  [ -r "$SECRET_FILE" ] || die "$SECRET_FILE not readable: run apply first"
  sed -n 's/^APP_DB_PASSWORD=//p' "$SECRET_FILE" | head -n1
}

grants_sql() {  # the password arrives as psql variable :pw, on stdin only
  cat <<SQL
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL log_statement = 'none';
SELECT 'CREATE ROLE $ROLE LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$ROLE') \gexec
ALTER ROLE $ROLE LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD :'pw';
GRANT CONNECT ON DATABASE "$DB" TO $ROLE;
GRANT USAGE ON SCHEMA public TO $ROLE;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $ROLE;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $ROLE;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO $ROLE;
-- Tables created by later migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE $OWNER IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $ROLE;
ALTER DEFAULT PRIVILEGES FOR ROLE $OWNER IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO $ROLE;
ALTER DEFAULT PRIVILEGES FOR ROLE $OWNER IN SCHEMA public GRANT EXECUTE ON ROUTINES TO $ROLE;
-- The application reads migration history and appends to the audit log, nothing more.
REVOKE INSERT, UPDATE, DELETE ON migrations FROM $ROLE;
REVOKE UPDATE, DELETE ON audit_log FROM $ROLE;
SELECT 'tables granted: ' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND has_table_privilege('$ROLE', c.oid, 'SELECT');
SQL
}

cmd_audit() {
  admin_psql -v ON_ERROR_STOP=1 -qtAX -F ' | ' <<'SQL'
SELECT c.relname, CASE WHEN a.attname IS NULL THEN 'no-tenant-col' ELSE 'tenant-col' END,
       CASE WHEN c.relrowsecurity THEN 'rls' ELSE 'NO-RLS' END,
       CASE WHEN c.relforcerowsecurity THEN 'force' ELSE '-' END,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) || ' policies'
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
 WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
 ORDER BY 2 DESC, 3, 1;
SQL
}

cmd_plan() {
  log "dry run: role and grants are applied in a transaction, then rolled back"
  { printf '\\set pw %s\n' "'$(openssl rand -hex 32)'"; grants_sql; echo 'ROLLBACK;'; } | admin_psql -qtAX
  local n; n="$(admin_psql -qtAX -c "SELECT count(*) FROM pg_roles WHERE rolname = '$ROLE'")"
  log "dry run finished; nothing changed (role exists now: $n)"
}

cmd_apply() {
  [ "${1:-}" = "--yes" ] || die "apply changes the database: pass --yes (see 'plan' first)"
  if [ ! -s "$SECRET_FILE" ]; then
    ( umask 077; printf 'APP_DB_USER=%s\nAPP_DB_PASSWORD=%s\n' "$ROLE" "$(openssl rand -hex 32)" > "$SECRET_FILE" )
  fi
  { printf '\\set pw %s\n' "'$(secret)'"; grants_sql; echo 'COMMIT;'; } | admin_psql -qtAX
  log "role $ROLE ready; the backend still uses $OWNER"
}

CHECK_FAILED=0
ok() { printf '  ok   %s\n' "$1"; }
bad() { printf '  FAIL %s\n' "$1"; CHECK_FAILED=1; }
expect() {  # expect <label> <wanted> <sql>
  local got; got="$(app_sql "$3" 2>&1)" || got="error: $got"
  if [ "$got" = "$2" ]; then ok "$1"; else bad "$1 (got: $got)"; fi
}
denied() {  # denied <label> <sql>: the statement must be refused; a rollback guards a misconfigured role
  local got; got="$(app_sql "BEGIN; $2; ROLLBACK;" 2>&1)" && { bad "$1 (was allowed)"; return; }
  case "$got" in
    *"permission denied"*|*"must be owner"*) ok "$1" ;;
    *) bad "$1 (got: $got)" ;;
  esac
}

cmd_verify() {
  log "checks as $ROLE through PgBouncer"
  expect "connects as the role" "$ROLE" "SELECT current_user"
  expect "not superuser, no BYPASSRLS" "f|f" "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
  expect "reads an ordinary table" "t" "SELECT count(*) >= 0 FROM users"
  expect "RLS hides tenant_roles with no tenant set" "0" "SELECT count(*) FROM tenant_roles"
  expect "RLS hides audit_log with no tenant set" "0" "SELECT count(*) FROM audit_log"
  denied "cannot create tables" "CREATE TABLE app_role_probe (i int)"
  denied "cannot alter tables" "ALTER TABLE users ADD COLUMN app_role_probe int"
  denied "cannot truncate" "TRUNCATE users"
  denied "cannot change audit_log" "UPDATE audit_log SET action = action WHERE false"
  denied "cannot delete audit_log" "DELETE FROM audit_log WHERE false"
  denied "cannot write migrations" "DELETE FROM migrations WHERE false"
  local missing
  missing="$(admin_psql -qtAX -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT has_table_privilege('$ROLE', c.oid, 'SELECT')")"
  if [ "$missing" = 0 ]; then ok "every table is readable"; else bad "$missing tables without grants: rerun apply"; fi
  [ "$CHECK_FAILED" = 0 ] || die "verify failed; do not switch"
  log "verify passed"
}

strip_env() {  # rewrites in place, so the file keeps its owner and mode
  local kept; kept="$(grep -vE '^APP_DB_(USER|PASSWORD)=' "$ENV_FILE" || true)"
  printf '%s\n' "$kept" > "$ENV_FILE"
}
recreate() { $COMPOSE up -d --no-deps --force-recreate "$BACKEND"; }
backend_user() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$BACKEND" | sed -n 's/^DATABASE_USER=//p' | head -n1; }
wait_healthy() {
  local i=0
  while [ "$i" -lt "$HEALTH_WAIT" ]; do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$BACKEND" 2>/dev/null)" = healthy ] && return 0
    sleep 5; i=$((i + 5))
  done
  return 1
}

cmd_rollback() {
  [ "${1:-}" = "--yes" ] || die "rollback restarts the backend: pass --yes"
  strip_env
  recreate
  wait_healthy || die "backend not healthy after rollback: check 'docker logs $BACKEND'"
  log "backend is back on $(backend_user)"
}

cmd_switch() {
  [ "${1:-}" = "--yes" ] || die "switch restarts the backend: pass --yes"
  grep -q 'APP_DB_PASSWORD:-' docker-compose.prod.yml || die "compose file has no APP_DB_* support: deploy first"
  cmd_verify
  local saved; saved="$ENV_FILE.before-app-role.$(date +%Y%m%d-%H%M%S)"
  ( umask 077; cp "$ENV_FILE" "$saved" )
  chmod 600 "$saved"
  strip_env
  cat "$SECRET_FILE" >> "$ENV_FILE"
  if ! recreate || ! wait_healthy || [ "$(backend_user)" != "$ROLE" ]; then
    log "backend unhealthy or on the wrong role: rolling back"
    cmd_rollback --yes
    die "switch rolled back; see 'docker logs $BACKEND'"
  fi
  log "backend now runs as $ROLE"
}

case "${1:-}" in
  audit) cmd_audit ;;
  plan) cmd_plan ;;
  apply) cmd_apply "${2:-}" ;;
  verify) cmd_verify ;;
  switch) cmd_switch "${2:-}" ;;
  rollback) cmd_rollback "${2:-}" ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
