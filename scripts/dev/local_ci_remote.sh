#!/usr/bin/env bash
# Run scripts/dev/local_ci.sh on another machine (the CI box, #947 T227) and return its exit code.
# local_ci.sh calls this when LOCAL_CI_REMOTE=<ssh host> is set; the default (unset) is unchanged.
#
#   LOCAL_CI_REMOTE=roxira-ci git push            # pre-push hook runs CI on the box
#   LOCAL_CI_REMOTE=roxira-ci scripts/dev/local_ci.sh --base origin/main
#
# What travels: the committed HEAD and the base ref (git push over ssh into a bare repo on the box),
# plus `git diff HEAD` for uncommitted edits to tracked files. Untracked and ignored files (.env,
# node_modules, keys) never leave this machine, which is why this is not a plain rsync of the worktree.
#
# Env:
#   LOCAL_CI_REMOTE       ssh host or alias (letters, digits, . _ - @ only)
#   LOCAL_CI_REMOTE_DIR   directory on the remote, relative to its home (default local-ci/roxira)
#   LOCAL_CI_REMOTE_CMD   command run in the remote checkout (default: the local_ci.sh run below;
#                         tests override it)
#   Passed through when set (validated): LOCAL_CI_SKIP_PYTEST, LOCAL_CI_NO_BOOTSTRAP, FRESH_DB_PORT
set -euo pipefail

BASE_REF="${1:-origin/main}"
host="${LOCAL_CI_REMOTE:?LOCAL_CI_REMOTE is not set}"
dir="${LOCAL_CI_REMOTE_DIR:-local-ci/roxira}"

die() { echo "local_ci_remote: $*" >&2; exit 2; }
printf '%s' "$host" | grep -Eq '^[A-Za-z0-9._@-]+$' || die "bad LOCAL_CI_REMOTE"
case "$host" in -*) die "bad LOCAL_CI_REMOTE" ;; esac
printf '%s' "$dir" | grep -Eq '^[A-Za-z0-9._/-]+$' || die "bad LOCAL_CI_REMOTE_DIR"
case "$dir" in /*|*..*) die "LOCAL_CI_REMOTE_DIR must be relative to the remote home, without .." ;; esac

pass=""
for v in LOCAL_CI_SKIP_PYTEST LOCAL_CI_NO_BOOTSTRAP; do
  val="${!v:-}"
  [ -z "$val" ] && continue
  case "$val" in 0|1) pass="$pass $v=$val" ;; *) die "$v must be 0 or 1" ;; esac
done
if [ -n "${FRESH_DB_PORT:-}" ]; then
  case "$FRESH_DB_PORT" in *[!0-9]*) die "FRESH_DB_PORT must be a number" ;; esac
  pass="$pass FRESH_DB_PORT=$FRESH_DB_PORT"
fi

git rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null || die "base ref $BASE_REF not found"
run="$(printf '%s' "$(git rev-parse --abbrev-ref HEAD)" | tr -c 'A-Za-z0-9._-' '-' | cut -c1-60)"
[ -n "$run" ] || run="head"
cmd="${LOCAL_CI_REMOTE_CMD:-env LOCAL_CI_REMOTE=$pass bash scripts/dev/local_ci.sh --base refs/heads/ci-base/$run}"

echo "=== remote local CI on $host ($dir, run $run) ==="
ssh -o BatchMode=yes "$host" "mkdir -p '$dir' && { [ -d '$dir/repo.git' ] || git init -q --bare '$dir/repo.git'; }"
git push -q --force "$host:$dir/repo.git" \
  "HEAD:refs/heads/ci-run/$run" "$(git rev-parse "$BASE_REF^{commit}"):refs/heads/ci-base/$run"

# The remote script: fresh detached worktree of the pushed head, apply uncommitted edits, run.
# Everything variable is validated above; the patch comes on stdin.
remote="set -eu
cd '$dir/repo.git'
rm -rf '../run-$run'
git worktree prune
git worktree add -q -f --detach '../run-$run' 'refs/heads/ci-run/$run'
cd '../run-$run'
patch=\$(mktemp)
cat > \"\$patch\"
if [ -s \"\$patch\" ]; then git apply --whitespace=nowarn \"\$patch\"; echo 'applied uncommitted changes'; fi
rm -f \"\$patch\"
$cmd"

set +e
git diff HEAD --binary | ssh -o BatchMode=yes "$host" "bash -c $(printf '%q' "$remote")"
rc=$?
set -e
echo "=== remote local CI on $host finished: exit $rc ==="
exit "$rc"
