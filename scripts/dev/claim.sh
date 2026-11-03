#!/usr/bin/env bash
# Claim a task before working on it, so nobody else does the same thing.
#   bash scripts/dev/claim.sh <issue-number> [short-slug]
#   bash scripts/dev/claim.sh new "Title of the task" [short-slug]   # creates the issue first
#   add --agent <id> anywhere (e.g. --agent opencode) for an AI agent: branch agent/<id>/<issue>-<slug>
#   and "Agent: <id>" in the draft PR body. Agent ids: claude, opencode, antigravity, deepseek, zed, server-<lane>;
#   your login is appended (opencode -> opencode-<login>) so the team sees whose agent it is
# What it does (all visible to everyone on GitHub):
#   1. assigns the issue to you and adds the label in-progress
#   2. creates branch <your-login>/<issue>-<slug> (or agent/<id>/<issue>-<slug>) from origin/main in a new worktree
#   3. pushes an empty commit and opens a DRAFT pull request "Closes #<issue>"
# Release a claim: gh api -X DELETE repos/Mahan-film/roxira-platform/issues/<n>/labels/in-progress
# See docs/COLLABORATION.md. Uses REST only (gh api): GraphQL is blocked in Claude Code cloud sessions.
set -euo pipefail

REPO="${ROXIRA_REPO:-Mahan-film/roxira-platform}"

# Optional --agent <id>, accepted anywhere in the args.
agent=""
rest=()
while [ $# -gt 0 ]; do
  case "$1" in
    --agent)
      [ $# -ge 2 ] || { echo "usage: --agent <id>" >&2; exit 2; }
      agent="$2"; shift 2 ;;
    *) rest+=("$1"); shift ;;
  esac
done
set -- ${rest[@]+"${rest[@]}"}
if [ -n "$agent" ] && ! printf '%s' "$agent" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; then
  echo "bad agent id '$agent' (use lowercase letters, digits, dashes)" >&2; exit 2
fi

[ $# -ge 1 ] || { sed -n '2,13p' "$0"; exit 2; }

if [ "$1" = "new" ]; then
  [ $# -ge 2 ] || { echo "usage: $0 new \"Title\" [slug]" >&2; exit 2; }
  issue="$(gh api -X POST "repos/$REPO/issues" -f title="$2" \
    -f body="Claimed with scripts/dev/claim.sh. Describe the goal and the acceptance test here." -q .number)"
  slug="${3:-}"
  title="$2"
else
  issue="$1"
  slug="${2:-}"
  title="$(gh api "repos/$REPO/issues/$issue" -q .title)"
fi

# Refuse if someone else already claimed it.
claimed_by="$(gh api "repos/$REPO/issues/$issue" \
  -q 'if ([.labels[].name] | index("in-progress")) then ([.assignees[].login] | join(",")) else "" end')"
me="$(gh api user -q .login)"
if [ -n "$claimed_by" ] && [ "$claimed_by" != "$me" ]; then
  echo "issue #$issue is already in progress by: $claimed_by. Talk to them first." >&2
  exit 1
fi

[ -n "$slug" ] || slug="$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//; s/-$//' | cut -c1-40)"
[ -n "$slug" ] || slug="task"
# Two people each run several agents: an agent id always names whose agent it is (opencode -> opencode-<login>).
case "$agent" in ""|*-"$me") ;; *) agent="$agent-$me" ;; esac
branch="$me/$issue-$slug"
[ -z "$agent" ] || branch="agent/$agent/$issue-$slug"

gh api -X POST "repos/$REPO/labels" -f name=in-progress -f color=FBCA04 \
  -f description="Someone is working on this (claim.sh)" >/dev/null 2>&1 || true
gh api -X POST "repos/$REPO/issues/$issue/assignees" -f "assignees[]=$me" >/dev/null
gh api -X POST "repos/$REPO/issues/$issue/labels" -f "labels[]=in-progress" >/dev/null

root="$(git rev-parse --show-toplevel)"
git -C "$root" fetch -q origin main
wt="$root/../roxira-wt/$issue-$slug"
git -C "$root" worktree add -q -b "$branch" "$wt" origin/main
git -C "$wt" commit -q --allow-empty -m "chore: start #$issue $title"
git -C "$wt" push -q -u origin "$branch"
pr="$(gh api -X POST "repos/$REPO/pulls" -F draft=true -f base=main -f head="$branch" \
  -f title="WIP #$issue: $title" -f body="Closes #$issue

${agent:+Agent: $agent

}Draft opened by scripts/dev/claim.sh so others can see this work is in progress." -q .html_url)"

echo "claimed #$issue"
echo "worktree: $wt"
echo "branch:   $branch"
echo "draft PR: $pr"
