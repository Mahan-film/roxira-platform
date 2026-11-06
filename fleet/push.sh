#!/usr/bin/env bash
# push.sh <worktree> <subject>: commit reviewed work, rebase on main, push with a lease. Guard hooks stay on.
# Exit 5 = push refused. PUSH_MODEL names the model for the trailer (slot agents: PUSH_MODEL="Sonnet 5.5").
set -uo pipefail
cd "$1" || exit 2; B=$(git rev-parse --abbrev-ref HEAD)
git add -u; git diff --cached --quiet || git commit -qm "$2

Co-Authored-By: Claude ${PUSH_MODEL:-Opus 5.5} <noreply@anthropic.com>" || exit 3
git fetch -q origin; git rebase origin/main >/dev/null 2>&1 || { git rebase --abort; echo "REBASE CONFLICT $B"; exit 4; }
L=$(mktemp); if git rev-parse -q --verify "origin/$B" >/dev/null; then LEASE="--force-with-lease=$B:$(git rev-parse "origin/$B")"; else LEASE=""; fi
git push $LEASE origin HEAD:$B >"$L" 2>&1; rc=$?
H=$(git rev-parse HEAD); R=$(git ls-remote origin "refs/heads/$B" | cut -f1)
# The remote decides, not the printed output: a piped tail once hid a refused push.
if [ $rc -ne 0 ] || [ "$H" != "$R" ]; then tail -15 "$L" | cut -c1-200; rm -f "$L"; echo "PUSH FAILED $B rc=$rc local=${H:0:8} remote=${R:0:8}"; exit 5; fi
rm -f "$L"; echo "pushed $B ${H:0:8}"
