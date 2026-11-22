#!/usr/bin/env bash
# Hub autopilot: the deterministic part of the hub loop, no LLM tokens.
#   bash scripts/dev/hub_autopilot.sh [--dry-run]
# 1. dispatches the review desk workflow (GitHub's own cron is unreliable)
# 2. queues every open PR whose CI is green and whose latest desk review says "Verdict: no blocker"
#    for the CURRENT head sha (same rule as the hub). Skips titles with [needs owner], WIP, draft PRs.
# 3. prints new REPORT comments on issue 592 since the last run (for the hub to verify) and PRs
#    waiting on a blocker fix, so a scheduled hub session only spends tokens on judgment.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${ROXIRA_REPO:-Mahan-film/roxira-platform}"
STATE="${HUB_AUTOPILOT_STATE:-$HOME/.cache/roxira/hub_autopilot.last}"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
mkdir -p "$(dirname "$STATE")"
since=$(cat "$STATE" 2>/dev/null || date -u -d '-1 day' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-1d +%Y-%m-%dT%H:%M:%SZ)
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "== hub autopilot $now (since $since)"
if [ $DRY -eq 0 ]; then
  gh workflow run review-desk.yml --repo "$REPO" >/dev/null 2>&1 && echo "desk run dispatched" || echo "WARN desk dispatch failed"
fi

echo "== merge candidates"
gh pr list --repo "$REPO" --state open --limit 60 --json number,title,isDraft,headRefName \
  --jq '.[] | select(.isDraft|not) | select(.title|test("needs owner|^WIP";"i")|not) | "\(.number) \(.headRefName)"' |
while read -r n head; do
  # Relay PRs (branch relay/*) that only append law_watch logs under data/legal/staged/*.jsonl: queue on green CI + MERGEABLE even
  # when the desk review flags a duplicate change_id (append logs by design; consumers keep the newest modified_at).
  case "$head" in
    relay/*)
      files_ok=$(gh pr view "$n" --repo "$REPO" --json files --jq '[.files[].path] | (length > 0) and all(.[]; test("^data/legal/staged/[^/]+\\.jsonl$"))' 2>/dev/null || echo false)
      if [ "$files_ok" = true ]; then
        rinfo=$(gh pr view "$n" --repo "$REPO" --json statusCheckRollup,mergeable,autoMergeRequest --jq '
          ([.statusCheckRollup[]|(.conclusion//.state//.status)]|map(select(.!="SUCCESS" and .!="SKIPPED" and .!="NEUTRAL"))|length) as $bad
          | "\($bad) \(.mergeable) \(.autoMergeRequest!=null)"')
        read -r rbad rmerge rqueued <<<"$rinfo"
        if [ "$rbad" = 0 ] && [ "$rmerge" = MERGEABLE ] && [ "$rqueued" = false ]; then
          if [ $DRY -eq 1 ]; then echo "would queue relay #$n"; else gh pr merge "$n" --repo "$REPO" --auto --squash >/dev/null 2>&1 && echo "queued relay #$n" || echo "WARN could not queue relay #$n"; fi
          continue
        fi
      fi
      ;;
  esac
  info=$(gh pr view "$n" --repo "$REPO" --json headRefOid,comments,statusCheckRollup,mergeable,autoMergeRequest \
    --jq "$(cat "$HERE/hub_autopilot_verdict.jq")")
  read -r bad verdict mergeable queued <<<"$info"
  if [ "$bad" = 0 ] && [ "$verdict" = ok ] && [ "$mergeable" = MERGEABLE ] && [ "$queued" = false ]; then
    if [ $DRY -eq 1 ]; then echo "would queue #$n"; else gh pr merge "$n" --repo "$REPO" --auto --squash >/dev/null 2>&1 && echo "queued #$n" || echo "WARN could not queue #$n"; fi
  elif [ "$verdict" = blocker ]; then
    echo "blocker  #$n (lane fixes it)"
  elif [ "$verdict" = inconclusive ]; then
    echo "inconclusive  #$n (critical file not fully reviewed: split the PR, never queued)"
  fi
done

echo "== new reports on 592"
gh api "repos/$REPO/issues/592/comments" --paginate \
  --jq ".[] | select(.created_at > \"$since\") | select(.body|startswith(\"REPORT\")) | \"\(.created_at[0:16]) \(.html_url) \(.body|split(\"\n\")[0])\""
[ $DRY -eq 1 ] || echo "$now" > "$STATE"
