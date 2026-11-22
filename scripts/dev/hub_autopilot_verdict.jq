# Per-PR line for hub_autopilot.sh: "<failing checks> <desk verdict> <mergeable> <auto-merge queued>".
# Input: `gh pr view --json headRefOid,comments,statusCheckRollup,mergeable,autoMergeRequest`.
# Same rule as scripts/ops/ci_box/merge_gate/merge_gate.py review_ok: only the Actions bot's last comment that
# starts with "Cross-family review", whose FIRST line names the current head sha, counts; its verdict is the
# LAST line that is exactly `Verdict: no blocker|blocker|inconclusive`. A path or finding quoted inside the
# comment can never be a line of its own (the desk strips newlines), and another user's comment is ignored.
# Output verdict: ok | blocker | inconclusive | stale | none. Only "ok" may be queued.
.headRefOid as $h
| ([.statusCheckRollup[]|(.conclusion//.state//.status)]|map(select(.!="SUCCESS" and .!="SKIPPED" and .!="NEUTRAL"))|length) as $bad
| ([.comments[]
    | select((.author.login // "") as $a | $a == "github-actions" or $a == "github-actions[bot]")
    | select(.body | startswith("Cross-family review"))] | last) as $c
| (if $c == null then "none"
   else ($c.body | split("\n")) as $l
   | if ($l[0] | contains($h) | not) then "stale"
     else ([$l[] | select(test("^Verdict: (no blocker|blocker|inconclusive)\\s*$")) | sub("^Verdict: "; "") | sub("\\s*$"; "")] | last) as $v
     | if $v == "no blocker" then "ok"
       elif $v == "blocker" then "blocker"
       elif $v == "inconclusive" then "inconclusive"
       else "none" end
     end
   end) as $verdict
| "\($bad) \($verdict) \(.mergeable) \(.autoMergeRequest != null)"
