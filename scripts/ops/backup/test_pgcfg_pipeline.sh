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
/usr/bin/tar "${a[@]}"; rc=$?
[ -n "${FAKE_TAR_RC:-}" ] && exit "$FAKE_TAR_RC"
exit "$rc"
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

# 3b. age-keygen failure: DRILL_RESULT=FAIL written, work dir removed
REAL_KEYGEN="$(command -v age-keygen)"
printf '#!/bin/sh\n[ -n "$FAKE_KEYGEN_FAIL" ] && exit 1\nexec "%s" "$@"\n' "$REAL_KEYGEN" >"$T/bin/age-keygen"; chmod +x "$T/bin/age-keygen"
rm -f "$T/state/drill.env"
rc=0; FAKE_KEYGEN_FAIL=1 bash "$HERE/server_backup.sh" drill >"$T/o.txt" 2>&1 || rc=$?
check "keygen failure: drill exits non-zero" "[ $rc != 0 ]"
check "keygen failure: drill.env says FAIL" "grep -q \"DRILL_RESULT='FAIL'\" '$T/state/drill.env' && grep -q 'age-keygen failed' '$T/state/drill.env'"
check "keygen failure: no drill dir leaked" "! ls -d '$T'/state/drill.?????? >/dev/null 2>&1"

# 4. R2 upload: daily copy + prune once per UTC day (not tied to a clock hour), hourly every run
cat >"$T/fake_r2.py" <<'EOS'
import os, sys
open(os.environ["R2_CALLS"], "a").write(" ".join(sys.argv[1:]) + "\n")
EOS
export BACKUP_R2_TOOLS="$T/fake_r2.py" R2_CALLS="$T/r2calls" BACKUP_R2_ENDPOINT="https://x.r2.cloudflarestorage.com"
: >"$T/r2calls"
rc=0; bash "$HERE/server_backup.sh" pgcfg >"$T/o.txt" 2>&1 || rc=$?
check "pgcfg with R2 passes" "[ $rc = 0 ]"
check "first run of the day writes hourly + daily + prune" "[ \$(grep -c 'put .*hourly/' '$T/r2calls') = 1 ] && [ \$(grep -c 'put .*daily/' '$T/r2calls') = 1 ] && grep -qx prune '$T/r2calls'"
rc=0; bash "$HERE/server_backup.sh" pgcfg >"$T/o.txt" 2>&1 || rc=$?
check "second run the same day writes only hourly" "[ \$(grep -c 'put .*hourly/' '$T/r2calls') = 2 ] && [ \$(grep -c 'put .*daily/' '$T/r2calls') = 1 ] && [ \$(grep -cx prune '$T/r2calls') = 1 ]"
echo 2000-01-01 >"$T/state/r2_daily_day"; echo 2000-01-01 >"$T/state/r2_prune_day"
rc=0; bash "$HERE/server_backup.sh" pgcfg >"$T/o.txt" 2>&1 || rc=$?
check "a missed day is caught up by the next run" "[ \$(grep -c 'put .*daily/' '$T/r2calls') = 2 ] && [ \$(grep -cx prune '$T/r2calls') = 2 ]"
check "R2 status OK" "grep -q \"R2_LAST_RESULT='OK'\" '$T/state/r2.env'"

# 5. tar exit 1 (file changed while reading) is not a failure
rc=0; FAKE_TAR_RC=1 bash "$HERE/server_backup.sh" pgcfg >"$T/o.txt" 2>&1 || rc=$?
check "tar exit 1 tolerated" "[ $rc = 0 ]"
rc=0; FAKE_TAR_RC=2 bash "$HERE/server_backup.sh" pgcfg >"$T/o.txt" 2>&1 || rc=$?
check "tar exit 2 still fails" "[ $rc != 0 ]"

# 6. missing recipient records FAIL instead of leaving no file
rm -f "$T/state/r2.env"
rc=0; BACKUP_AGE_RECIPIENT="" bash "$HERE/server_backup.sh" pgcfg >"$T/o.txt" 2>&1 || rc=$?
check "no recipient: exit non-zero" "[ $rc != 0 ]"
check "no recipient: r2.env says FAIL" "grep -q \"R2_LAST_RESULT='FAIL'\" '$T/state/r2.env'"

# 7. retention defaults stay at the hourly-era values until the installer writes the env block
check "script default retention is 6 + 3" "grep -q 'BACKUP_KEEP_LOCAL_SETS:-6' '$HERE/server_backup.sh' && grep -q 'BACKUP_KEEP_DAILY:-3' '$HERE/server_backup.sh'"

[ "$fail" = 0 ] || { echo "--- last output:"; cat "$T/drill.out" "$T/o.txt" 2>/dev/null; }
exit "$fail"
