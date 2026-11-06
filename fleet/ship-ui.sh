#!/usr/bin/env bash
# ship-ui.sh <pr> "<title>": for UI-only PRs without money logic: cross-family review, then ready and merge on a clean verdict.
# A verdict of blocker or an empty review stops and prints it; the coordinator reads those.
R=Mahan-film/roxira-platform; F=/home/mahan/Developer/roxira-wt/_fleet; n="$1"; t="$2"; cd "$F"
for try in 1 2 3; do ./review.sh "$n" --post >/tmp/rv$n.log 2>&1; rc=$?; [ $rc = 0 ] && break; done
V=$(grep -iE '^\W*verdict:' reviews/$n.out | head -1); echo "$n rc=$rc $V"
case "$rc:$V" in 0:*"no blocker"*) ;; *) sed -n 1,14p reviews/$n.out | cut -c1-260; exit 1;; esac
BAD=$(gh pr diff "$n" -R $R --name-only | grep -E 'modules/|migrations/|\.github/|package(-lock)?\.json' | head -5); [ -n "$BAD" ] && { echo "$n not UI-only: $BAD"; exit 2; }
gh pr edit "$n" -R $R --title "$t" >/dev/null; gh pr ready "$n" -R $R >/dev/null 2>&1; ./merge-loop.sh "$n" 2>&1 | tail -2 | cut -c1-110; gh pr view "$n" -R $R --json state --jq '"\(.number) \(.state)"'
