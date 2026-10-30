#!/usr/bin/env bash
# Offline test for server_backup.sh pgcfg/drill/offsite payloads and restore_drill.sh payload mode.
# No docker, no network, no root: docker/flock/stat/python3-R2 are stubs. Run: bash scripts/ops/backup/test_pgcfg_pipeline.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/pgc.XXXXXX")"
trap 'rm -rf -- "$T"' EXIT
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
command -v age >/dev/null && command -v age-keygen >/dev/null || { echo "SKIP age not installed"; exit 0; }

mkdir -p "$T/bin" "$T/state" "$T/repo"; : >"$T/none.env"
echo "A=1" >"$T/repo/.env"
# docker stub: one running container, one db "app", pg_restore -l ok, scratch container commands succeed.
cat >"$T/bin/docker" <<'EOS'
#!/usr/bin/env bash
case "$*" in
  "inspect -f {{.State.Running}} roxira_postgres_prod") echo true ;;
  inspect*) exit 1 ;;
  *pg_dumpall*) echo "CREATE ROLE x;" ;;
  *"select datname"*) echo app ;;
  *"pg_dump -U"*) printf 'PGDMPfake-%s' "$(date +%s)" ;;
  *"pg_restore -l"*) cat >/dev/null ;;
  *"pg_restore -U"*) cat >/dev/null ;;
  *pg_stat_user_tables*) ;;
  run*|rm*|*pg_isready*|*createdb*) ;;
  *psql*) if grep -q pg_stat_user_tables; then echo "public|users"; else echo "public.users|5"; fi ;;
esac
exit 0
EOS
printf '#!/bin/sh\nexit 0\n' >"$T/bin/flock"
cat >"$T/bin/stat" <<'EOS'
#!/bin/sh
[ "$1" = "-c" ] && { wc -c <"$3" | tr -d ' '; exit 0; }
exec /usr/bin/stat "$@"
EOS
# bsdtar (macOS) lacks GNU --warning=...; drop that flag so the test runs on a Mac too
cat >"$T/bin/tar" <<'EOS'
#!/bin/bash
a=(); for x in "$@"; do case "$x" in --warning=*) ;; *) a+=("$x") ;; esac; done
exec /usr/bin/tar "${a[@]}"
EOS
chmod +x "$T/bin/"*
# the drill's `psql` fallthrough needs stdin; docker stub above handles it.
export PATH="$T/bin:$PATH" BACKUP_ENV_FILE="$T/none.env" BACKUP_STATE_DIR="$T/state" BACKUP_LOCAL_DIR="$T/local"
export ROXIRA_REPO_DIR="$T/repo" BACKUP_PG_CONTAINERS="roxira_postgres_prod" BACKUP_PGCFG_LOCK_FILE="$T/pgcfg.lock"
export BACKUP_LOG_FILE="$T/log"

KEY="$T/id.key"; age-keygen -o "$KEY" >/dev/null 2>&1
export BACKUP_AGE_RECIPIENT; BACKUP_AGE_RECIPIENT="$(age-keygen -y "$KEY")"

# 1. R2 not configured: no upload, status says so, exit 0
rc=0; bash "$HERE/server_backup.sh" pgcfg >/dev/null 2>&1 || rc=$?
check "pgcfg without R2 exits 0" "[ $rc = 0 ]"
check "pgcfg without R2 records NOT_CONFIGURED" "grep -q \"R2_LAST_RESULT='NOT_CONFIGURED'\" '$T/state/r2.env'"

# 2. drill: throwaway key, fresh payload, restore -> OK recorded
export OFFSITE_TOOLS="$HERE/offsite_tools.py"
rc=0; bash "$HERE/server_backup.sh" drill >"$T/drill.out" 2>&1 || rc=$?
check "drill passes" "[ $rc = 0 ]"
check "drill.env says OK" "grep -q \"DRILL_RESULT='OK'\" '$T/state/drill.env'"
check "drill left no key or payload behind" "! ls -d '$T'/state/drill.* '$T'/state/payload.* >/dev/null 2>&1"

# 3. drill fails when the container is down
sed -i.bak 's/echo true/echo false/' "$T/bin/docker"
rc=0; bash "$HERE/server_backup.sh" drill >/dev/null 2>&1 || rc=$?
check "drill fails when pg is down" "[ $rc != 0 ]"
check "drill.env says FAIL" "grep -q \"DRILL_RESULT='FAIL'\" '$T/state/drill.env'"
mv "$T/bin/docker.bak" "$T/bin/docker"

[ "$fail" = 0 ] || { echo "--- last output:"; cat "$T/drill.out" "$T/o.txt" 2>/dev/null; }
exit "$fail"
