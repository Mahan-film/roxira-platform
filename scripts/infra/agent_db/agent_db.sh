#!/usr/bin/env bash
# Throwaway Postgres databases for agent migration tests ("Neon branching" on our own Postgres).
# Runs ON srv1 as root. Every write is dry-run unless --apply. Docs: docs/infra/AGENT_DB.md
#
#   agent_db.sh template [--apply]      rebuild agentdb_template: live schema + migrations rows, no data
#   agent_db.sh create <slug> [--apply] CREATE DATABASE agentdb_<slug> TEMPLATE agentdb_template (prints the name only)
#   agent_db.sh drop <slug> [--apply]   DROP DATABASE agentdb_<slug>
#   agent_db.sh gc [--apply]            drop agentdb_* (not the template) created more than 24 h ago
#   agent_db.sh list                    agentdb_* databases with their age
#
# Safety: only names matching ^agentdb_[a-z0-9_]{1,40}$ are ever created or dropped; enterprise_db and every
# other database are out of reach. No password or connection URL is ever printed.
set -euo pipefail

PG="${AGENTDB_PG_CONTAINER:-roxira_postgres_prod}"
BACKEND="${AGENTDB_BACKEND_CONTAINER:-roxira_enterprise_backend}"
TEMPLATE="agentdb_template"
MAX_AGE_S=$((24 * 3600))
NAME_RE='^agentdb_[a-z0-9_]{1,40}$'

log() { printf '[agent_db] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

safe_name() {  # safe_name <name>: refuse anything outside the agentdb_ namespace
  [[ "$1" =~ $NAME_RE ]] || die "refusing database name '$1' (must match $NAME_RE)"
}
slug_name() {  # slug -> agentdb_<slug>, sanitised
  local s; s="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_' '_' | sed 's/__*/_/g; s/^_//; s/_$//' | cut -c1-40)"
  [ -n "$s" ] || die "empty slug"
  [ "agentdb_$s" != "$TEMPLATE" ] || die "slug 'template' is reserved"
  printf 'agentdb_%s' "$s"
}
db_user() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$BACKEND" | sed -n 's/^DATABASE_USER=//p' | head -n1
}
psql_admin() {  # psql_admin <sql>: run against the maintenance DB
  docker exec -i "$PG" psql -U "$(db_user)" -d postgres -v ON_ERROR_STOP=1 -qtAX -c "$1"
}

APPLY=0
args=()
for a in "$@"; do [ "$a" = "--apply" ] && APPLY=1 || args+=("$a"); done
cmd="${args[0]:-}"

run_sql() {  # run_sql <sql>: print in dry-run, execute with --apply
  if [ "$APPLY" = 1 ]; then psql_admin "$1"; else printf 'dry-run SQL: %s\n' "$1"; fi
}

case "$cmd" in
  create)
    name="$(slug_name "${args[1]:-}")"; safe_name "$name"
    run_sql "CREATE DATABASE \"$name\" TEMPLATE \"$TEMPLATE\" OWNER \"$(db_user)\""
    run_sql "COMMENT ON DATABASE \"$name\" IS 'agentdb created:$(date +%s)'"
    [ "$APPLY" = 1 ] && printf '%s\n' "$name"
    ;;
  drop)
    name="$(slug_name "${args[1]:-}")"; safe_name "$name"
    run_sql "DROP DATABASE IF EXISTS \"$name\" WITH (FORCE)"
    ;;
  list)
    psql_admin "SELECT d.datname || ' ' || coalesce(shobj_description(d.oid, 'pg_database'), '') FROM pg_database d WHERE d.datname LIKE 'agentdb\_%' ORDER BY 1"
    ;;
  gc)
    now="$(date +%s)"
    psql_admin "SELECT d.datname || ' ' || coalesce(shobj_description(d.oid, 'pg_database'), '') FROM pg_database d WHERE d.datname LIKE 'agentdb\_%'" |
    while read -r name comment; do
      [ -n "$name" ] && [ "$name" != "$TEMPLATE" ] || continue
      safe_name "$name"
      created="$(printf '%s' "$comment" | sed -n 's/.*created:\([0-9]*\).*/\1/p')"
      if [ -z "$created" ] || [ $((now - created)) -gt "$MAX_AGE_S" ]; then
        log "gc: $name (created ${created:-unknown})"
        run_sql "DROP DATABASE IF EXISTS \"$name\" WITH (FORCE)"
      fi
    done
    ;;
  template)
    safe_name "$TEMPLATE"
    [ "$(docker inspect -f '{{.State.Running}}' "$PG")" = true ] || die "$PG not running"
    src="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$BACKEND" | sed -n 's/^DATABASE_NAME=//p' | head -n1)"
    [ -n "$src" ] || die "DATABASE_NAME not set in the $BACKEND env"
    if [ "$APPLY" != 1 ]; then
      log "dry-run: would rebuild $TEMPLATE = schema of $src + rows of its migrations table (no other data)"; exit 0
    fi
    # Our migrations are incremental (the first ones assume tables that already existed), so the
    # template copies the live SCHEMA plus the migrations bookkeeping rows; no customer data is copied.
    u="$(db_user)"
    psql_admin "DROP DATABASE IF EXISTS \"$TEMPLATE\" WITH (FORCE)"
    psql_admin "CREATE DATABASE \"$TEMPLATE\" OWNER \"$u\""
    docker exec "$PG" sh -c "pg_dump -U '$u' -d '$src' --schema-only --no-owner --no-privileges \
      | psql -U '$u' -d '$TEMPLATE' -v ON_ERROR_STOP=1 -q" >/dev/null || die "schema copy failed ($src untouched)"
    docker exec "$PG" sh -c "pg_dump -U '$u' -d '$src' --data-only --table=migrations \
      | psql -U '$u' -d '$TEMPLATE' -v ON_ERROR_STOP=1 -q" >/dev/null || die "migrations table copy failed"
    psql_admin "COMMENT ON DATABASE \"$TEMPLATE\" IS 'agentdb template: schema of $src at $(date -u +%FT%TZ)'"
    log "$TEMPLATE rebuilt: schema of $src + migrations rows, no data"
    ;;
  *)
    sed -n '2,13p' "$0"; exit 2 ;;
esac
