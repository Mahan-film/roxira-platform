#!/usr/bin/env bash
# Model-free handoff: print a compact state block to stdout.
#   - current branch and the count of `git status --short` lines
#   - the 10 newest open PRs by the current gh user (number, title, mergeStateStatus),
#     only if gh works; time-limited, failures ignored
#   - the first 40 lines of docs/STATE.md
# Used as a Claude Code SessionStart hook (matcher "compact"), so the state comes
# back after every compaction without a model call. Any agent can run it by hand.
# It never fails: it always exits 0.

set -u

root="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$root" ]; then
  root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi
cd "$root" 2>/dev/null || exit 0

GH_TIMEOUT="${AUTO_HANDOFF_GH_TIMEOUT:-8}"

# macOS has no `timeout`; perl's alarm kills the child after N seconds.
run_limited() {
  perl -e 'alarm shift; exec @ARGV' "$GH_TIMEOUT" "$@"
}

echo "=== auto handoff (no model call) ==="
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
changes="$(git status --short 2>/dev/null | wc -l | tr -d ' ')"
echo "branch: $branch"
echo "uncommitted changes (git status --short): ${changes:-unknown}"

echo "--- my open PRs (newest 10) ---"
if command -v gh >/dev/null 2>&1 && command -v perl >/dev/null 2>&1; then
  prs="$(run_limited gh pr list --author @me --state open --limit 10 \
    --json number,title,mergeStateStatus \
    --template '{{range .}}#{{.number}} [{{.mergeStateStatus}}] {{.title}}{{"\n"}}{{end}}' 2>/dev/null)" || prs=""
  if [ -n "$prs" ]; then
    printf '%s\n' "$prs"
  else
    echo "(none, or gh unavailable)"
  fi
else
  echo "(gh not installed)"
fi

echo "--- docs/STATE.md (first 40 lines) ---"
if [ -f docs/STATE.md ]; then
  head -n 40 docs/STATE.md
else
  echo "(docs/STATE.md not found)"
fi
echo "=== end auto handoff ==="
exit 0
