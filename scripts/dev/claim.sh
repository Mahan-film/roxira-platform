#!/usr/bin/env bash
# Claim a task before working on it, so nobody else does the same thing.
#   bash scripts/dev/claim.sh <issue-number> [short-slug]
#   bash scripts/dev/claim.sh new "Title of the task" [short-slug]   # creates the issue first
# What it does (all visible to everyone on GitHub):
#   1. assigns the issue to you and adds the label in-progress
#   2. creates branch <your-login>/<issue>-<slug> from origin/main in a new worktree
#   3. pushes an empty commit and opens a DRAFT pull request "Closes #<issue>"
# Release a claim: gh issue edit <n> --remove-label in-progress --remove-assignee @me
# See docs/COLLABORATION.md.
set -euo pipefail

REPO="${ROXIRA_REPO:-Mahan-film/roxira-platform}"
[ $# -ge 1 ] || { sed -n '2,11p' "$0"; exit 2; }

if [ "$1" = "new" ]; then
  [ $# -ge 2 ] || { echo "usage: $0 new \"Title\" [slug]" >&2; exit 2; }
  url="$(gh issue create --repo "$REPO" --title "$2" --body "Claimed with scripts/dev/claim.sh. Describe the goal and the acceptance test here.")"
  issue="${url##*/}"
  slug="${3:-}"
  title="$2"
else
  issue="$1"
  slug="${2:-}"
  title="$(gh issue view "$issue" --repo "$REPO" --json title -q .title)"
fi

# Refuse if someone else already claimed it.
claimed_by="$(gh issue view "$issue" --repo "$REPO" --json assignees,labels \
  -q 'if ([.labels[].name] | index("in-progress")) then ([.assignees[].login] | join(",")) else "" end')"
me="$(gh api user -q .login)"
if [ -n "$claimed_by" ] && [ "$claimed_by" != "$me" ]; then
  echo "issue #$issue is already in progress by: $claimed_by. Talk to them first." >&2
  exit 1
fi

[ -n "$slug" ] || slug="$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//; s/-$//' | cut -c1-40)"
[ -n "$slug" ] || slug="task"
branch="$me/$issue-$slug"

gh label create in-progress --repo "$REPO" --color FBCA04 --description "Someone is working on this (claim.sh)" 2>/dev/null || true
gh issue edit "$issue" --repo "$REPO" --add-assignee @me --add-label in-progress >/dev/null

root="$(git rev-parse --show-toplevel)"
git -C "$root" fetch -q origin main
wt="$root/../roxira-wt/$issue-$slug"
git -C "$root" worktree add -q -b "$branch" "$wt" origin/main
git -C "$wt" commit -q --allow-empty -m "chore: start #$issue $title"
git -C "$wt" push -q -u origin "$branch"
pr="$(gh pr create --repo "$REPO" --draft --base main --head "$branch" \
  --title "WIP #$issue: $title" --body "Closes #$issue

Draft opened by scripts/dev/claim.sh so others can see this work is in progress.")"

echo "claimed #$issue"
echo "worktree: $wt"
echo "branch:   $branch"
echo "draft PR: $pr"
