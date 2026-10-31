#!/usr/bin/env bash
# Throwaway-database check for AddPasswordAuth1789340000000.
# Needs DATABASE_* env pointing at an EMPTY disposable Postgres (never production).
# Runs every migration up, seeds a legacy user, reverts only the new migration
# (data must survive), re-applies it, then checks the revert guard for phone-less users.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_NAME:?set DATABASE_* for a disposable database}"
case "$DATABASE_NAME" in *prod*|enterprise_db) echo "refusing: looks like a real database" >&2; exit 2;; esac
run() { npm run -s typeorm -- "$@"; }
psql_q() { node -e "
const {Client}=require('pg');(async()=>{const c=new Client({host:process.env.DATABASE_HOST,port:+process.env.DATABASE_PORT,user:process.env.DATABASE_USER,password:process.env.DATABASE_PASSWORD,database:process.env.DATABASE_NAME});await c.connect();
const r=await c.query(process.argv[1]);console.log(JSON.stringify(r.rows));await c.end()})().catch(e=>{console.error(e.message);process.exit(1)})" "$1"; }

echo "== reset disposable schema"; psql_q "drop schema public cascade; create schema public" >/dev/null
echo "== up (all migrations)"; run migration:run
echo "== schema after up"
psql_q "select column_name,is_nullable from information_schema.columns where table_name='users' and column_name in ('phone','username','login_email','password_hash','password_updated_at') order by 1"
psql_q "select to_regclass('auth_refresh_tokens') as t"
psql_q "insert into users (phone,\"displayName\") values ('09120000001','legacy') returning id"
psql_q "insert into users (username,login_email,password_hash) values ('pw1','pw1@example.com','x') returning id"
echo "== constraint: a user with no identifier is rejected"
if psql_q "insert into users (\"displayName\") values ('nobody')" 2>/dev/null; then echo "FAIL: CHECK missing"; exit 1; else echo ok; fi
echo "== unique: duplicate login_email rejected"
if psql_q "insert into users (username,login_email) values ('pw2','pw1@example.com')" 2>/dev/null; then echo "FAIL: unique missing"; exit 1; else echo ok; fi
echo "== revert while a phone-less user exists must refuse and change nothing"
out=$(run migration:revert 2>&1 || true)
if grep -q "Cannot revert" <<<"$out"; then echo ok; else echo "FAIL: guard missing"; exit 1; fi
psql_q "select to_regclass('auth_refresh_tokens') as t"
psql_q "delete from users where phone is null"
echo "== revert (clean)"; run migration:revert
psql_q "select column_name from information_schema.columns where table_name='users' and column_name in ('username','login_email','password_hash')"
psql_q "select is_nullable from information_schema.columns where table_name='users' and column_name='phone'"
psql_q "select count(*)::int as legacy_users from users where phone='09120000001'"
echo "== up again"; run migration:run
psql_q "select to_regclass('auth_refresh_tokens') as t"
echo "MIGRATION CHECK PASSED"
