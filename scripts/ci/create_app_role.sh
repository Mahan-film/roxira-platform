#!/usr/bin/env bash
# CI only: create the NOSUPERUSER NOBYPASSRLS application role `roxira_app` on a freshly migrated
# throwaway database, with the same grants production uses (scripts/ops/db_app_role.sh grants_sql).
# The password is a CI-only literal for a service container that dies with the job; not a secret.
# Env: DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, CI_ADMIN_USER (default postgres), CI_APP_PASSWORD.
set -euo pipefail
ROLE=roxira_app
OWNER="${CI_ADMIN_USER:-postgres}"
DB="${DATABASE_NAME:-rxfresh}"
PW="${CI_APP_PASSWORD:-app-role-test-only}"
psql -h "${DATABASE_HOST:-127.0.0.1}" -p "${DATABASE_PORT:-5432}" -U "$OWNER" -d "$DB" \
  -v ON_ERROR_STOP=1 -v pw="$PW" -qtAX <<SQL
BEGIN;
SELECT 'CREATE ROLE $ROLE LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$ROLE') \gexec
ALTER ROLE $ROLE LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD :'pw';
GRANT CONNECT ON DATABASE "$DB" TO $ROLE;
GRANT USAGE ON SCHEMA public TO $ROLE;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $ROLE;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $ROLE;
ALTER DEFAULT PRIVILEGES FOR ROLE $OWNER IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $ROLE;
ALTER DEFAULT PRIVILEGES FOR ROLE $OWNER IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO $ROLE;
REVOKE INSERT, UPDATE, DELETE ON migrations FROM $ROLE;
REVOKE UPDATE, DELETE ON audit_log FROM $ROLE;
COMMIT;
SELECT 'app role ready: ' || rolname || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls FROM pg_roles WHERE rolname = '$ROLE';
SQL
