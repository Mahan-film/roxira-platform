#!/usr/bin/env bash
# review-merge.sh <pr>: cross-family review, then merge only when the verdict is no blocker.
# A blocker stops here for the coordinator to verify; merge by hand with merge-loop.sh if it is false.
R=Mahan-film/roxira-platform; F=/home/mahan/Developer/roxira-wt/_fleet; n="$1"
out=$($F/review.sh "$n" --post 2>&1 | grep -E '^pr=' | head -1); echo "$out" | cut -c1-90
case "$out" in
  *"Verdict: no blocker"*) ;;
  *) echo "STOP $n: review did not clear it"; gh pr view "$n" -R $R --json comments --jq '.comments[-1].body' | sed -n '/Blocker/,/Major/p' | cut -c1-400 | head -14; exit 6;;
esac
$F/merge-loop.sh "$n" 2>&1 | cut -c1-110 | tail -2; gh pr view "$n" -R $R --json state --jq .state
