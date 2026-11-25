#!/usr/bin/env bash
# Verify that the gitleaks pre-push hook is active in the main clone and all worktrees.
set -euo pipefail

ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
FAIL=0

check_repo() {
  local repo_path="$1"
  local hook_path
  if [[ ! -d "$repo_path" ]]; then
    echo "MISSING_DIR  $repo_path"
    FAIL=1
    return
  fi
  hook_path=$(git -C "$repo_path" rev-parse --git-path hooks/pre-push 2>/dev/null || true)
  if [[ -z "$hook_path" ]]; then
    echo "NOT_A_REPO   $repo_path"
    FAIL=1
    return
  fi
  if [[ "$hook_path" != /* ]]; then
    hook_path="$repo_path/$hook_path"
  fi
  if [[ -x "$hook_path" ]] && grep -q "gitleaks" "$hook_path"; then
    echo "OK           $repo_path"
  else
    echo "NO_GITLEAKS  $repo_path (hook: $hook_path)"
    FAIL=1
  fi
}

check_repo "$ROOT"

if [[ -n "${ROXIRA_WT_ROOT:-}" ]] && [[ -d "$ROXIRA_WT_ROOT" ]]; then
  while IFS= read -r wt; do
    [[ -z "$wt" ]] && continue
    [[ "$wt" == "$ROOT" ]] && continue
    check_repo "$wt"
  done < <(git -C "$ROOT" worktree list --porcelain | awk '/^worktree /{print substr($0, 10)}')
fi

exit "$FAIL"
