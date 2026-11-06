#!/usr/bin/env bash
# merge-loop.sh <pr>...: run merge-batch every 3 min until all merged, or 90 min pass, or a real conflict appears.
R=Mahan-film/roxira-platform; F=/home/mahan/Developer/roxira-wt/_fleet
for i in $(seq 1 30); do
  OPEN=(); for n in "$@"; do [ "$(gh pr view $n -R $R --json state --jq .state)" = OPEN ] && OPEN+=($n); done
  [ ${#OPEN[@]} = 0 ] && { echo "all merged: $*"; exit 0; }
  Q=$(gh api graphql -f query='query{repository(owner:"Mahan-film",name:"roxira-platform"){mergeQueue{entries(first:20){nodes{pullRequest{number}}}}}}' --jq '[.data.repository.mergeQueue.entries.nodes[].pullRequest.number]|join(" ")')
  TODO=(); for n in "${OPEN[@]}"; do [[ " $Q " == *" $n "* ]] || TODO+=($n); done
  if [ ${#TODO[@]} -gt 0 ]; then OUT=$($F/merge-batch.sh "${TODO[@]}" 2>&1); echo "[$i] $OUT" | grep -vE '^\[' ; echo "$OUT" | grep -qE 'needs a person|PUSH FAILED|failing:' && { echo "$OUT" | grep -E 'needs a person|PUSH FAILED|failing:'; echo STOP; exit 3; }; fi
  read -t 180 </dev/zero || true
done
echo "timeout; open: ${OPEN[*]}"; exit 4
