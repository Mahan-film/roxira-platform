#!/usr/bin/env bash
# Throwaway-database check for AddOrgAccessControl1789350000000.
# Needs DATABASE_* env pointing at an EMPTY disposable Postgres (never production).
# Applies every migration, reverts the new one, seeds legacy tenants (OWNER + MEMBER +
# dangling), re-applies it and checks the backfill, the audit-log trigger, the table
# constraints and the guarded down().
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_NAME:?set DATABASE_* for a disposable database}"
case "$DATABASE_NAME" in *prod*|enterprise_db) echo "refusing: looks like a real database" >&2; exit 2;; esac
run() { npm run -s typeorm -- "$@" 2>&1 | grep -E "has been (executed|reverted) successfully|Error|Cannot revert|audit_log holds" || true; return "${PIPESTATUS[0]}"; }
q() { node -e "
const {Client}=require('pg');(async()=>{const c=new Client({host:process.env.DATABASE_HOST,port:+process.env.DATABASE_PORT,user:process.env.DATABASE_USER,password:process.env.DATABASE_PASSWORD,database:process.env.DATABASE_NAME});await c.connect();
const r=await c.query(process.argv[1]);console.log(JSON.stringify(r.rows));await c.end()})().catch(e=>{console.error(e.message);process.exit(1)})" "$1"; }
fails() { if q "$1" >/dev/null 2>&1; then echo "FAIL: expected an error: $1"; exit 1; else echo "ok (rejected)"; fi; }
expect() { local got; got=$(q "$1"); if [ "$got" != "$2" ]; then echo "FAIL: $1 -> $got (wanted $2)"; exit 1; else echo "ok $2"; fi; }

echo "== reset disposable schema"; q "drop schema public cascade; create schema public" >/dev/null
echo "== up (all migrations)"; run migration:run
echo "== revert only the new migration"; run migration:revert
expect "select to_regclass('tenant_memberships') as t" '[{"t":null}]'

echo "== seed legacy data: tenant A (owner+member), tenant B (owner), a loner and a dangling user"
q "insert into tenants (id,name,slug) values ('aaaaaaaa-0000-4000-8000-000000000001','A','a-1'),('bbbbbbbb-0000-4000-8000-000000000002','B','b-2')" >/dev/null
q "insert into users (id,phone,tenant_id,tenant_role) values
  ('11111111-0000-4000-8000-000000000001','09120000001','aaaaaaaa-0000-4000-8000-000000000001','OWNER'),
  ('11111111-0000-4000-8000-000000000002','09120000002','aaaaaaaa-0000-4000-8000-000000000001','MEMBER'),
  ('11111111-0000-4000-8000-000000000003','09120000003','bbbbbbbb-0000-4000-8000-000000000002','OWNER'),
  ('11111111-0000-4000-8000-000000000004','09120000004',null,null),
  ('11111111-0000-4000-8000-000000000005','09120000005','cccccccc-0000-4000-8000-000000000009','OWNER')" >/dev/null

echo "== up again: backfill"; run migration:run
expect "select count(*)::int as n from tenant_memberships" '[{"n":3}]'
expect "select role_key from tenant_memberships where user_id='11111111-0000-4000-8000-000000000001'" '[{"role_key":"owner"}]'
expect "select role_key from tenant_memberships where user_id='11111111-0000-4000-8000-000000000002'" '[{"role_key":"legacy_member"}]'
expect "select count(*)::int as n from tenant_memberships where user_id in ('11111111-0000-4000-8000-000000000004','11111111-0000-4000-8000-000000000005')" '[{"n":0}]'
# 3 tenants (the default one from an earlier migration, A and B) x 11 sellable modules
expect "select count(*)::int as n from tenant_module_entitlements where enabled" '[{"n":33}]'
expect "select count(distinct tenant_id)::int as n from tenant_module_entitlements" '[{"n":3}]'
echo "== users table untouched by the migration"
expect "select tenant_role from users where id='11111111-0000-4000-8000-000000000002'" '[{"tenant_role":"MEMBER"}]'

echo "== constraints"
fails "insert into tenant_memberships (tenant_id,user_id,role_key) values ('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001','admin')"
fails "insert into tenant_memberships (tenant_id,user_id,role_key) values ('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000003','custom')"
fails "insert into tenant_invitations (tenant_id,role_key,token_hash,expires_at,invited_by) values ('aaaaaaaa-0000-4000-8000-000000000001','owner',repeat('a',64),now(),'11111111-0000-4000-8000-000000000001')"
fails "insert into tenant_memberships (tenant_id,user_id,role_key,status) values ('bbbbbbbb-0000-4000-8000-000000000002','11111111-0000-4000-8000-000000000004','sales','BOGUS')"

echo "== audit log is append-only"
q "insert into audit_log (tenant_id,action) values ('aaaaaaaa-0000-4000-8000-000000000001','test')" >/dev/null
fails "update audit_log set action='edited'"
fails "delete from audit_log"
fails "truncate audit_log"
expect "select count(*)::int as n from audit_log" '[{"n":1}]'

echo "== down refuses to drop a non-empty audit log"
out=$(run migration:revert 2>&1 || true)
if grep -q "audit_log holds" <<<"$out"; then echo ok; else echo "FAIL: guard missing: $out"; exit 1; fi
expect "select to_regclass('tenant_memberships') is not null as t" '[{"t":true}]'

echo "== explicit override reverts cleanly and keeps legacy data"
ROXIRA_ALLOW_AUDIT_LOG_DROP=1 run migration:revert
expect "select to_regclass('audit_log') as t" '[{"t":null}]'
expect "select count(*)::int as n from users where tenant_id is not null" '[{"n":4}]'
expect "select count(*)::int as n from information_schema.columns where table_name='tenants' and column_name='require_2fa'" '[{"n":0}]'
echo "== up one more time"; run migration:run
expect "select count(*)::int as n from tenant_memberships" '[{"n":3}]'
echo "MIGRATION CHECK PASSED"
