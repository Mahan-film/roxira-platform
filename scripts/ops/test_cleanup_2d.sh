#!/usr/bin/env bash
# Offline test for cleanup_2d.sh + cleanup_tools.py. docker/journalctl/df/disk_guard are stubs that log every call.
# Run: bash scripts/ops/test_cleanup_2d.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/cl.XXXXXX")"
trap 'rm -rf -- "$T"' EXIT
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }

mkdir -p "$T/bin"
NOW="$(date -u '+%Y-%m-%d %H:%M:%S +0000 UTC')"
OLD="2020-01-01 00:00:00 +0000 UTC"
cat >"$T/bin/docker" <<EOS
#!/usr/bin/env bash
echo "docker \$*" >>"$T/calls"
case "\$1 \$2" in
  "image ls") printf 'aaaaaaaaaaaa\trxtest-deps:latest\t$OLD\nbbbbbbbbbbbb\trxtest-deps:prev\t$OLD\ncccccccccccc\trxtest-new:latest\t$NOW\ndddddddddddd\troxira-backend:latest\t$OLD\neeeeeeeeeeee\trxtest-run:latest\t$OLD\n' ;;
  "ps -a") if [ "\$3" = "-q" ]; then echo c1; else echo "rxtest-run:latest"; fi ;;
  "inspect -f") echo "sha256:eeeeeeeeeeee0000" ;;
esac
exit 0
EOS
printf '#!/bin/sh\necho "journalctl $*" >>"%s/calls"\n' "$T" >"$T/bin/journalctl"
printf '#!/bin/sh\necho "disk_guard env=$WORKTREES_ONLY/$THRESHOLD_CLEANUP/$THRESHOLD_ALERT $*" >>"%s/calls"\n' "$T" >"$T/bin/dg"
printf '#!/bin/sh\necho "Filesystem 1K Used Avail Use Mount"; echo "/dev/x 100 50 50 50%% /"\n' >"$T/bin/df"
chmod +x "$T/bin/"*
export DOCKER_BIN="$T/bin/docker" JOURNALCTL_BIN="$T/bin/journalctl" DF_BIN="$T/bin/df" DISK_GUARD="$T/bin/dg" CLEANUP_LOG="$T/log"

# dry run: nothing but listing calls
: >"$T/calls"
bash "$HERE/cleanup_2d.sh" >"$T/dry.out" 2>&1
check "dry-run runs no destructive docker call" "! grep -E 'docker (builder prune|image prune|rmi)|vacuum' '$T/calls'"
check "dry-run says what it would do" "grep -q 'dry-run: .* builder prune' '$T/dry.out' && grep -q 'dry-run: .*rmi aaaaaaaaaaaa' '$T/dry.out'"
check "dry-run passes --dry-run to the worktree step" "grep -q 'disk_guard env=1/0/101 --dry-run' '$T/calls'"
check "dry-run writes no log" "[ ! -e '$T/log' ]"

# apply
: >"$T/calls"
bash "$HERE/cleanup_2d.sh" --apply >"$T/apply.out" 2>&1
check "apply prunes build cache older than 48h" "grep -q 'docker builder prune -f --filter until=48h' '$T/calls'"
check "apply prunes dangling images only" "grep -q 'docker image prune -f\$' '$T/calls'"
check "apply removes the old untagged-prev rxtest image" "grep -q 'docker rmi aaaaaaaaaaaa' '$T/calls'"
check "apply keeps :prev" "! grep -q 'rmi bbbbbbbbbbbb' '$T/calls'"
check "apply keeps recent rxtest" "! grep -q 'rmi cccccccccccc' '$T/calls'"
check "apply keeps non-rxtest images" "! grep -q 'rmi dddddddddddd' '$T/calls'"
check "apply keeps an image used by a container" "! grep -q 'rmi eeeeeeeeeeee' '$T/calls'"
check "apply vacuums the journal to 200M" "grep -q 'journalctl --vacuum-size=200M' '$T/calls'"
check "apply runs the worktree step for real" "grep -q 'disk_guard env=1/0/101 *\$' '$T/calls'"
check "apply logs" "grep -q 'cleanup ok' '$T/log'"

# safety: the script text never mentions volumes, system prune, -a, rmi -f, rm -rf, data/, Backups
check "script never touches volumes/system prune/rm -rf/force" \
  "! grep -nE 'volume|system prune|rm -rf|rmi -f|prune -a|image prune -a|/data|Backups|--all' '$HERE/cleanup_2d.sh' | grep -v '^[0-9]*:#'"
exit "$fail"
