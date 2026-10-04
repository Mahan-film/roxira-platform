#!/usr/bin/env bash
# Local integrator, run by the OWNER with their own gh login (no tokens here).
# Usage: scripts/dev/integrate.sh <pr-number> [--merge]
# Dry run by default: rebase the PR on origin/main in a temp worktree, run local_ci.sh,
# run merge_check.py. With --merge AND verdict AUTO_MERGE_OK AND local_ci green, runs
#   gh pr merge N --squash --match-head-commit <tested sha>
# Never uses --admin. For OWNER_REVIEW PRs the owner merges by hand (gh pr merge --admin).
set -euo pipefail

PR="${1:?usage: integrate.sh <pr-number> [--merge]}"
MERGE=0
[ "${2:-}" = "--merge" ] && MERGE=1
case "$PR" in ''|*[!0-9]*) echo "PR must be a number" >&2; exit 2 ;; esac

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
WT="$(mktemp -d "${TMPDIR:-/tmp}/integrate-$PR.XXXXXX")"
cleanup() {
  git -C "$REPO_ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
}
trap cleanup EXIT

git fetch -q origin main "+pull/$PR/head:refs/integrate/pr-$PR"
SHA="$(git rev-parse "refs/integrate/pr-$PR")"
git worktree add -q --detach "$WT" "$SHA"
cd "$WT"
if ! git rebase origin/main >/dev/null 2>&1; then
  echo "BLOCK(rebase on origin/main conflicts)"
  git rebase --abort >/dev/null 2>&1 || true
  exit 20
fi

CI_OK=0
if scripts/dev/local_ci.sh --base origin/main; then CI_OK=1; else echo "local_ci: FAILED"; fi

set +e
python3 "$REPO_ROOT/scripts/dev/merge_check.py" "$PR"
VERDICT_CODE=$?
set -e
echo "tested_head=$SHA local_ci_ok=$CI_OK verdict_exit=$VERDICT_CODE"

if [ "$MERGE" != 1 ]; then
  echo "Dry run. Re-run with --merge to merge on AUTO_MERGE_OK. OWNER_REVIEW PRs: the owner uses 'gh pr merge --admin' by hand."
  exit "$VERDICT_CODE"
fi
if [ "$VERDICT_CODE" != 0 ] || [ "$CI_OK" != 1 ]; then
  echo "Not merging: verdict is not AUTO_MERGE_OK or local_ci failed. (Owner may use 'gh pr merge --admin' by hand for OWNER_REVIEW PRs.)"
  exit 1
fi
CUR="$(gh pr view "$PR" --json headRefOid --jq .headRefOid)"
if [ "$CUR" != "$SHA" ]; then
  echo "Refusing: PR head moved ($SHA -> $CUR). Re-run." >&2
  exit 1
fi
gh pr merge "$PR" --squash --match-head-commit "$SHA"
