#!/usr/bin/env bash
# merge-batch.sh <pr>...: owner-approved laptop merges (2026-11-05). Enqueues a PR only with green CI and no failing
# required check. A REQUIREMENTS_STATUS.md-only conflict is rebased (both rows kept) and pushed; CI then has to rerun,
# so that PR is left for the next invocation. Anything else is reported, never forced. Never uses --admin.
set -uo pipefail
R=Mahan-film/roxira-platform; G=/home/mahan/Developer/roxira-platform; S=/tmp/claude-1000/-home-mahan/f2518bd6-88c0-49c6-9221-7d6f30b97be2/scratchpad
for n in "$@"; do
  for i in $(seq 1 18); do
    J=$(gh pr view "$n" -R $R --json state,isDraft,mergeable,headRefOid,headRefName,statusCheckRollup)
    M=$(jq -r .mergeable <<<"$J"); [ "$M" != UNKNOWN ] && break; read -t 10 </dev/zero || true
  done
  ST=$(jq -r .state <<<"$J"); D=$(jq -r .isDraft <<<"$J"); H=$(jq -r .headRefOid <<<"$J"); B=$(jq -r .headRefName <<<"$J")
  BAD=$(jq -r '[.statusCheckRollup[]|select(.conclusion=="FAILURE" or .conclusion=="CANCELLED" or .conclusion=="TIMED_OUT")|.name]|join(",")' <<<"$J")
  PEND=$(jq -r '[.statusCheckRollup[]|select(.status!="COMPLETED")|.name]|length' <<<"$J"); N=$(jq -r '.statusCheckRollup|length' <<<"$J")
  if [ "$ST" != OPEN ]; then echo "$n $ST"; continue; fi
  if [ "$D" = true ]; then echo "$n draft, skipped"; continue; fi
  if [ "$M" = CONFLICTING ]; then
    W=$(git -C $G worktree list --porcelain | awk -v b="refs/heads/$B" '/^worktree/{w=$2} $0=="branch " b{print w}')
    [ -n "$W" ] || { echo "$n conflict: no worktree"; continue; }
    ( cd "$W"; git fetch -q origin; OLD=$(git rev-parse "origin/$B"); git rebase origin/main >/dev/null 2>&1
      while [ -d "$(git rev-parse --git-dir)/rebase-merge" ] || [ -d "$(git rev-parse --git-dir)/rebase-apply" ]; do
        U=$(git diff --name-only --diff-filter=U)
        OK=1; for f in $U; do case "$f" in docs/strategy/REQUIREMENTS_STATUS.md|docs/accounting/POSTING_MAP.md|docs/testing/M1_GATE.md) ;; *) OK=0;; esac; done
        if [ "$OK" = 1 ] && python3 /home/mahan/Developer/roxira-wt/_fleet/res-rows.py $U; then git add $U; GIT_EDITOR=true git rebase --continue >/dev/null 2>&1
        else git rebase --abort; echo "$n conflict needs a person: $U"; exit 1; fi
      done
      for t in 1 2 3; do git push --force-with-lease="$B:$OLD" origin "HEAD:$B" >"$S/mb-$n.log" 2>&1 && break; done
      L=$(git rev-parse HEAD); [ "$L" = "$(git ls-remote origin "refs/heads/$B" | cut -f1)" ] && echo "$n rebased ${L:0:8}, CI rerunning" || { echo "$n PUSH FAILED"; grep -E '^FAIL|FAILED ' "$S/mb-$n.log" | cut -c1-120; } )
    continue
  fi
  [ -n "$BAD" ] && { echo "$n failing: $BAD"; continue; }
  [ "$PEND" != 0 ] || [ "$N" = 0 ] && { echo "$n CI not finished ($PEND pending of $N)"; continue; }
  gh pr merge "$n" -R $R --squash --match-head-commit "$H" >/dev/null 2>&1; echo "$n enqueued rc=$? ${H:0:8}"
done
gh api graphql -f query='query{repository(owner:"Mahan-film",name:"roxira-platform"){mergeQueue{entries(first:10){nodes{state pullRequest{number}}}}}}' --jq '.data.repository.mergeQueue.entries.nodes|map("\(.pullRequest.number):\(.state)")'
