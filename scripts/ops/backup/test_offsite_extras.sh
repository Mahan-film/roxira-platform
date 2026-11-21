#!/usr/bin/env bash
# Offline test for telegram_offsite.sh --send-file (T197): refuses non-age files, skips above the size cap
# (exit 10), splits into parts. curl/stat/flock are stubs; no network, no docker, no root.
# Run: bash scripts/ops/backup/test_offsite_extras.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/offx.XXXXXX")"
trap 'rm -rf -- "$T"' EXIT
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }

mkdir -p "$T/bin" "$T/state" "$T/repo"
printf '#!/bin/sh\nexit 0\n' >"$T/bin/flock"
cat >"$T/bin/stat" <<'EOS'
#!/bin/sh
[ "$1" = "-c" ] && { wc -c <"$3" | tr -d ' '; exit 0; }
exec /usr/bin/stat "$@"
EOS
# curl stub: counts calls, answers ok
cat >"$T/bin/curl" <<EOS
#!/bin/sh
echo x >>"$T/curl.calls"
out=""; while [ \$# -gt 0 ]; do [ "\$1" = "-o" ] && out="\$2"; shift; done
printf '{"ok":true}' >"\$out"
EOS
# macOS mktemp -d ignores TMPDIR (sandboxes deny /var/folders): keep the work dirs under $T
cat >"$T/bin/mktemp" <<EOS
#!/bin/sh
exec /usr/bin/mktemp -d "$T/work.XXXXXX"
EOS
chmod +x "$T/bin/mktemp" "$T/bin/flock" "$T/bin/stat" "$T/bin/curl"

# run FILE [NAME=value ...]: telegram_offsite.sh --send-file FILE with a clean environment
run() {
  local f="$1"
  shift
  env PATH="$T/bin:$PATH" ROXIRA_REPO_DIR="$T/repo" ROXIRA_SERVER_ENV_FILE="$T/none.env" BACKUP_ENV_FILE="$T/none.env" \
    TMPDIR="$T" OFFSITE_STATE_DIR="$T/state" TELEGRAM_BACKUP_LOG="$T/tg.log" NOTIFY_BOT_TOKEN=dummy NOTIFY_CHAT_ID=1 \
    "$@" bash "$HERE/telegram_offsite.sh" --send-file "$f" --label qdrant >"$T/out" 2>&1
}

printf 'not age' >"$T/plain"
rc=0
run "$T/plain" || rc=$?
check "plain file refused" "[ $rc = 1 ] && [ ! -e '$T/curl.calls' ]"

{ printf 'age-encryption.org/v1\n'; head -c 3000000 /dev/zero; } >"$T/big.age"
rc=0
run "$T/big.age" TELEGRAM_MAX_TOTAL_MB=1 || rc=$?
check "above the cap: exit 10, nothing sent, logged" "[ $rc = 10 ] && [ ! -e '$T/curl.calls' ] && grep -q skipped '$T/tg.log'"

rc=0
run "$T/big.age" TELEGRAM_MAX_TOTAL_MB=10 TELEGRAM_PART_MB=1 || rc=$?
check "3 MB at 1 MB parts: 3 sends, exit 0" "[ $rc = 0 ] && [ \$(wc -l <'$T/curl.calls' | tr -d ' ') = 3 ]"

if [ "$fail" = 0 ]; then echo "all passed"; else echo "FAILED"; exit 1; fi
