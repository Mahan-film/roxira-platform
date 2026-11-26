#!/usr/bin/env bash
# Interactive owner approval helper for protected PRs.
#   scripts/dev/owner_ok.sh [--dry-run] <PR>
# Shows changed files, desk verdict at head, and sha7; prompts y/N; posts
# "OWNER-OK #<PR> <sha7>". Refuses if the head changes or a newer blocker exists.
set -euo pipefail

REPO="${ROXIRA_REPO:-Mahan-film/roxira-platform}"
dry_run=0
pr=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    -*) echo "Unknown flag: $arg" >&2; exit 2 ;;
    *)
      if [ -n "$pr" ]; then
        echo "Unexpected extra argument: $arg" >&2
        exit 2
      fi
      pr="$arg"
      ;;
  esac
done

if ! printf '%s' "$pr" | grep -Eq '^[0-9]+$'; then
  echo "Usage: $0 [--dry-run] <PR>" >&2
  exit 2
fi

pr_json="$(gh pr view "$pr" --repo "$REPO" --json number,title,state,headRefOid,files,commits)"
comments_json="$(gh api "repos/$REPO/issues/$pr/comments" --paginate)"

summary_and_status="$(
  PR_JSON="$pr_json" COMMENTS_JSON="$comments_json" python3 - <<'PY'
import json
import os
import re
import sys

pr = json.loads(os.environ["PR_JSON"])
comments = json.loads(os.environ["COMMENTS_JSON"])

if pr.get("state") != "OPEN":
    print(f"REFUSE: PR #{pr.get('number')} state is {pr.get('state')}, expected OPEN", file=sys.stderr)
    sys.exit(1)

head = (pr.get("headRefOid") or "").lower()
if len(head) < 7:
    print("REFUSE: missing headRefOid", file=sys.stderr)
    sys.exit(1)
sha7 = head[:7]

commit_dates = [
    c.get("committedDate") or ""
    for c in (pr.get("commits") or [])
    if c.get("committedDate")
]
head_date = max(commit_dates) if commit_dates else ""

desk_verdict = "none yet"
desk_comments = [
    c for c in comments
    if ((c.get("user") or {}).get("login") == "github-actions[bot]")
    and (c.get("body") or "").lstrip().startswith("Cross-family review")
]
if desk_comments:
    latest = (desk_comments[-1].get("body") or "").lstrip()
    lines = latest.splitlines()
    first = lines[0] if lines else ""
    m = re.search(r"(?:@|of)\s*([0-9a-fA-F]{7,40})\b", first)
    if m and head.startswith(m.group(1).lower()):
        found = None
        for ln in lines:
            vm = re.match(r"^\s*\**\s*verdict\s*\**\s*:\s*\**\s*(no blocker|blocker)\b", ln, re.I)
            if vm:
                found = vm.group(1).lower()
        desk_verdict = found or "none yet"
    else:
        desk_verdict = "stale"

blocker_reason = None
if desk_verdict == "blocker":
    blocker_reason = f"review-desk verdict at {sha7} is blocker"
else:
    for c in comments:
        created = c.get("created_at") or ""
        if head_date and created < head_date:
            continue
        body = c.get("body") or ""
        for ln in body.splitlines():
            s = ln.strip()
            if re.match(r"^BLOCKER\s*:", s, re.I):
                blocker_reason = f"newer BLOCKER comment at {created or 'unknown'}"
                break
            vm = re.match(r"^\s*\**\s*verdict\s*\**\s*:\s*\**\s*(no blocker|blocker)\b", s, re.I)
            if vm and vm.group(1).lower() == "blocker":
                # Ignore stale desk comments from older heads if head_date was missing.
                if body.lstrip().startswith("Cross-family review"):
                    first_line = body.lstrip().splitlines()[0]
                    hm = re.search(r"(?:@|of)\s*([0-9a-fA-F]{7,40})\b", first_line)
                    if hm and not head.startswith(hm.group(1).lower()):
                        continue
                blocker_reason = f"newer Verdict: blocker comment at {created or 'unknown'}"
                break
        if blocker_reason:
            break

files = [f.get("path") for f in (pr.get("files") or []) if f.get("path")]
print(f"PR #{pr['number']}: {pr.get('title', '')}")
print(f"Head: {sha7} ({head})")
print(f"Desk verdict at head: {desk_verdict}")
print(f"Files ({len(files)}):")
for path in files:
    print(f"  - {path}")

if blocker_reason:
    print(f"REFUSE: {blocker_reason}", file=sys.stderr)
    sys.exit(1)

print(f"HEAD_SHA={head}")
print(f"SHA7={sha7}")
PY
)"

printf '%s\n' "$summary_and_status" | grep -vE '^(HEAD_SHA|SHA7)='
head_sha="$(printf '%s\n' "$summary_and_status" | sed -n 's/^HEAD_SHA=//p' | tail -n 1)"
sha7="$(printf '%s\n' "$summary_and_status" | sed -n 's/^SHA7=//p' | tail -n 1)"
marker="OWNER-OK #${pr} ${sha7}"

if [ "$dry_run" = "1" ]; then
  echo "[dry-run] would post: $marker"
  exit 0
fi

printf 'Post "%s"? [y/N] ' "$marker"
read -r reply || reply=""
case "$reply" in
  y|Y|yes|YES) ;;
  *)
    echo "Cancelled."
    exit 0
    ;;
esac

current_head="$(gh pr view "$pr" --repo "$REPO" --json headRefOid --jq .headRefOid | tr '[:upper:]' '[:lower:]')"
if [ "$current_head" != "$head_sha" ]; then
  echo "REFUSE: PR #$pr head changed from $sha7 to ${current_head:0:7}; aborting." >&2
  exit 1
fi

gh pr comment "$pr" --repo "$REPO" --body "$marker"
echo "Posted: $marker"
