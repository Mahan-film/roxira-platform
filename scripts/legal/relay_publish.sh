#!/usr/bin/env bash
# Publish staged legal JSONL files (law_watch_*.jsonl / iran_relay_*.jsonl) as a GitHub PR.
#
# Usage: scripts/legal/relay_publish.sh [checkout]   (default: ~/Developer/roxira-lawwatch)
#
# Rules (hard):
#   * add ONLY untracked/modified files matching data/legal/staged/{law_watch,iran_relay}_*.jsonl
#   * branch from origin/main, never touch other files, never force-push, never push to main
#   * exit 0 when there is nothing to publish
set -euo pipefail

CHECKOUT="${1:-$HOME/Developer/roxira-lawwatch}"

if ! git -C "$CHECKOUT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then  # worktrees have a .git FILE
  echo "relay: '$CHECKOUT' is not a git checkout" >&2
  exit 1
fi

cd "$CHECKOUT"

FILES=()
while IFS= read -r -d '' entry; do
  [ -n "$entry" ] && FILES+=("${entry:3}")
done < <(git status --porcelain=v1 -z -- \
  'data/legal/staged/law_watch_*.jsonl' \
  'data/legal/staged/iran_relay_*.jsonl' 2>/dev/null || true)

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "relay: nothing to publish"
  exit 0
fi

STAMP="$(date +%Y%m%d-%H%M)"
DATE="$(date +%Y-%m-%d)"
BRANCH="relay/${STAMP}"
if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  BRANCH="${BRANCH}-2"
fi

echo "relay: publishing ${#FILES[@]} file(s) on ${BRANCH} from origin/main"
git fetch --quiet origin main
git checkout --quiet -b "$BRANCH" origin/main

git add -- "${FILES[@]}"

N=0
BODY="Relay batch ${DATE}"$'\n\n'"Files and row counts:"$'\n'
for f in "${FILES[@]}"; do
  rows="$(wc -l < "$f" | tr -d ' ')"
  BODY+="- \`${f}\` (${rows} rows)"$'\n'
  N=$((N + 1))
done
BODY+=$'\n'"All rows are staging_status=proposed / needs_review=true; nothing reaches production until the hub merges this PR and a later collection build/eval approves it."

COMMIT_MSG="data(legal): relay batch ${DATE} (${N} files)"
git commit --quiet -m "$COMMIT_MSG"
# Data-only PR reviewed by the hub: skip the local CI pre-push hook (it runs the code test suite).
SKIP_LOCAL_CI=1 git push --quiet -u origin "$BRANCH"
# Leave the checkout on a clean detached origin/main so the next run starts from fresh code.
git checkout --quiet --detach origin/main
gh pr create --base main --head "$BRANCH" --title "$COMMIT_MSG" --body "$BODY"
echo "relay: done (${N} files, branch ${BRANCH})"
