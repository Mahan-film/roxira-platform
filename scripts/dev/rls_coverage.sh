#!/usr/bin/env bash
# T192 RLS coverage gate. Run against a database that already has every migration applied
# (CI "Fresh migrations" step, scripts/dev/fresh_db_migrate.sh). Fails when:
#   - a table in schema public has a tenant_id column but lacks ENABLE or FORCE ROW LEVEL SECURITY
#     or a policy that references app.tenant_id;
#   - a table has no tenant_id column and is not listed in scripts/dev/rls_allowlist.txt
#     (a new global table must be a conscious, reviewed choice);
#   - the allowlist names a table that does not exist, or lists a tenant_id table without the
#     reason prefix "TODO T192 follow-up:" (tenant tables may only be exempt as a tracked gap).
# The only tenant column the repo uses for row isolation is tenant_id (see rls_allowlist.txt for
# tables with other owner-like columns, which are global or pre-tenant).
#
# Usage:  bash scripts/dev/rls_coverage.sh            (libpq env: PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD)
#         RLS_PSQL="docker exec -i <ctr> psql -U rx -d rxfresh" bash scripts/dev/rls_coverage.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOW="${RLS_ALLOWLIST:-$ROOT/scripts/dev/rls_allowlist.txt}"
PSQL="${RLS_PSQL:-psql}"

[ -f "$ALLOW" ] || { echo "rls-coverage: missing $ALLOW" >&2; exit 2; }

SQL="$(mktemp)"; trap 'rm -f "$SQL"' EXIT
{
  echo "\\set ON_ERROR_STOP on"
  echo "create temp table rls_allow(t text primary key, reason text not null);"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    tbl="${line%%|*}"; reason="${line#*|}"
    tbl="$(printf '%s' "$tbl" | tr -d ' \t')"
    reason="$(printf '%s' "$reason" | sed -e 's/^[ \t]*//' -e 's/[ \t]*$//')"
    [[ "$tbl" =~ ^[a-z0-9_]+$ ]] || { echo "rls-coverage: bad allowlist table name: $line" >&2; exit 2; }
    { [ -n "$reason" ] && [ "$reason" != "$line" ]; } || { echo "rls-coverage: allowlist line needs 'table | reason': $line" >&2; exit 2; }
    case "$reason" in *'$r$'*) echo "rls-coverage: bad reason text: $line" >&2; exit 2 ;; esac
    printf "insert into rls_allow values ('%s', \$r\$%s\$r\$);\n" "$tbl" "$reason"
  done <"$ALLOW"
  cat <<'SQL'
\pset tuples_only on
\pset format unaligned
\pset fieldsep ' | '
with t as (
  select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as frc,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id'
            and a.attnum > 0 and not a.attisdropped) as has_tenant,
    exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
            and (coalesce(p.qual, '') like '%app.tenant_id%' or coalesce(p.with_check, '') like '%app.tenant_id%')) as has_policy
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
)
select 'FAIL ' || relname, 'tenant_id table lacks ' ||
  concat_ws(', ', case when not rls then 'ENABLE ROW LEVEL SECURITY' end,
                  case when not frc then 'FORCE ROW LEVEL SECURITY' end,
                  case when not has_policy then 'a policy referencing app.tenant_id' end)
from t where has_tenant and not (rls and frc and has_policy)
  and not exists (select 1 from rls_allow a where a.t = relname)
union all
select 'FAIL ' || relname, 'no tenant_id column and not in scripts/dev/rls_allowlist.txt'
from t where not has_tenant and not exists (select 1 from rls_allow a where a.t = relname)
union all
select 'FAIL ' || a.t, 'allowlist entry has tenant_id and is not marked "TODO T192 follow-up:"'
from rls_allow a join t on t.relname = a.t
where t.has_tenant and a.reason not like 'TODO T192 follow-up:%'
union all
select 'FAIL ' || a.t, 'allowlist entry names a table that does not exist'
from rls_allow a where not exists (select 1 from t where t.relname = a.t)
order by 1;
SQL
} >"$SQL"

OUT="$($PSQL -X -q <"$SQL")" || { echo "rls-coverage: psql failed" >&2; exit 2; }
if [ -n "$OUT" ]; then
  echo "$OUT" >&2
  echo "rls-coverage: FAIL ($(printf '%s\n' "$OUT" | wc -l | tr -d ' ') problem(s)). Fix with enableTenantRls() from migrations/data/tenant-rls.ts or edit scripts/dev/rls_allowlist.txt with a reason." >&2
  exit 1
fi
echo "rls-coverage: OK"
