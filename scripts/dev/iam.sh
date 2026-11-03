#!/usr/bin/env bash
# Say who is at the keyboard, so commits, pushes, claims and PRs carry the right GitHub account.
#   bash scripts/dev/iam.sh              # show the active GitHub account and the git author
#   bash scripts/dev/iam.sh <login>      # switch both to <login> (must already be in `gh auth login`)
# Both people share one Mac: `gh auth switch` picks the account for gh, git push and claim.sh, and the
# git author is set to that account's noreply address in this repo's config (all worktrees share it).
# See docs/COLLABORATION.md.
set -euo pipefail

show() {
  echo "GitHub (gh, push, claim.sh): $(gh api user -q .login 2>/dev/null || echo 'not logged in')"
  echo "git author:                  $(git config user.name || echo unset) <$(git config user.email || echo unset)>"
}

if [ $# -eq 0 ]; then
  show
  echo "Logged-in accounts:"
  gh auth status -h github.com 2>&1 | sed -n 's/.*account \([^ ]*\).*/  \1/p'
  exit 0
fi

login="$1"
gh auth switch -h github.com -u "$login" >/dev/null
id="$(gh api user -q .id)"
git config user.name "$login"
git config user.email "$id+$login@users.noreply.github.com"
show
