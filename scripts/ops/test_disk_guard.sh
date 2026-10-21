#!/usr/bin/env bash
# Offline test for disk_guard.sh. No docker, no network, no root: df/docker/du/git/notify are stubs,
# taskq.db is a tiny fake. Run: bash scripts/ops/test_disk_guard.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/dg.XXXXXX")"
trap 'rm -rf -- "$T"' EXIT
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }

BIN="$T/bin"
WTR="$T/worktrees"
REPO="$T/repo.git"
DB="$T/taskq.db"
mkdir -p "$BIN" "$WTR/old" "$WTR/new" "$WTR/dirty" "$REPO"
touch -d '10 days ago' "$WTR/old" "$WTR/dirty"

python3 - "$DB" "$WTR/old" "$WTR/new" "$WTR/dirty" <<'PY'
import sqlite3
import sys
import time

db, old, new, dirty = sys.argv[1:]
con = sqlite3.connect(db)
con.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, worktree TEXT, status TEXT, updated REAL)")
now = time.time()
for path, status in ((old, "done"), (new, "done"), (dirty, "done")):
    con.execute("INSERT INTO tasks (worktree, status, updated) VALUES (?, ?, ?)", (path, status, now))
con.commit()
con.close()
PY

cat >"$BIN/df" <<'EOS'
#!/usr/bin/env bash
echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
echo "/dev/vda1 100000 90000 10000 90% /"
EOS

cat >"$BIN/docker" <<EOS
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$T/docker.calls"
exit 0
EOS

cat >"$BIN/du" <<'EOS'
#!/usr/bin/env bash
echo "8.0G /"
echo "5.0G /var"
echo "2.0G /usr"
echo "1.0G /home"
echo "0.5G /tmp"
EOS

cat >"$BIN/git" <<'EOS'
#!/usr/bin/env bash
last="${@: -1}"
wt=""
prev=""
for a in "$@"; do
  if [ "$prev" = "-C" ]; then wt="$a"; fi
  prev="$a"
done
case " $* " in
  *" worktree remove "*) rm -rf -- "$last"; exit 0 ;;
esac
case "$wt" in
  *dirty*) echo " M x" ;;
esac
exit 0
EOS

cat >"$BIN/sudo" <<'EOS'
#!/usr/bin/env bash
echo "unexpected sudo: $*" >&2
exit 1
EOS

cat >"$T/notify_stub.py" <<'EOS'
#!/usr/bin/env python3
import os
import sys

with open(os.environ["NOTIFY_TEST_OUT"], "w", encoding="utf-8") as fh:
    fh.write(" ".join(sys.argv[1:]))
EOS

chmod +x "$BIN/df" "$BIN/docker" "$BIN/du" "$BIN/git" "$BIN/sudo" "$T/notify_stub.py"

guard() {
  env DF_BIN="$BIN/df" DOCKER_BIN="$BIN/docker" DU_BIN="$BIN/du" GIT_BIN="$BIN/git" \
      SUDO_BIN="$BIN/sudo" AGENT_USER="$(id -un)" \
      TASKQ_DB="$DB" WORKTREE_ROOT="$WTR" REPO_GIT="$REPO" \
      DEPLOY_STATE="$T/deploy-state" LOG_FILE="$T/guard.log" \
      NOTIFY_BIN="$T/notify_stub.py" NOTIFY_TEST_OUT="$T/notify.msg" \
      bash "$HERE/disk_guard.sh" "$@"
}

# 1) --dry-run prints the plan, changes nothing
out="$(guard --dry-run 2>&1)" || { echo "$out"; fail=1; }
check "dry-run keeps the stale worktree" '[ -d "$WTR/old" ]'
check "dry-run writes no log" '[ ! -e "$T/guard.log" ]'
check "dry-run mentions the prune" 'grep -qF "builder prune -f --keep-storage 3GB" <<<"$out"'
check "dry-run runs no docker" '[ ! -e "$T/docker.calls" ]'

# 2) real run: prune + remove, skip recent and dirty, then alert (90%)
out="$(guard 2>&1)" || { echo "$out"; fail=1; }
check "prunes the build cache" 'grep -qF "builder prune -f --keep-storage 3GB" "$T/docker.calls"'
check "removes the stale done worktree" '[ ! -e "$WTR/old" ]'
check "keeps the recent worktree" '[ -d "$WTR/new" ]'
check "keeps the dirty worktree" '[ -d "$WTR/dirty" ]'
check "logs the removed path" 'grep -qxF "$WTR/old" "$T/guard.log"'
check "does not log the dirty path" '! grep -qxF "$WTR/dirty" "$T/guard.log"'
check "sends one alert at 90%" '[ -f "$T/notify.msg" ] && grep -qF "90" "$T/notify.msg"'

if [ "$fail" = 0 ]; then
  echo "ALL PASS"
else
  echo "FAILURES"
  exit 1
fi
