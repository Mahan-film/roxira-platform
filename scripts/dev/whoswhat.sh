#!/usr/bin/env bash
# Who is working on what right now? Read-only. Run before starting any task.
#   bash scripts/dev/whoswhat.sh
# Shows: claimed issues (label in-progress), open PRs with their author and changed files,
# and files touched by more than one open PR (likely conflict / duplicate work).
# Source of truth is GitHub (issues + PRs), not a file in the repo. See docs/COLLABORATION.md.
set -euo pipefail

REPO="${ROXIRA_REPO:-Mahan-film/roxira-platform}"
command -v gh >/dev/null || { echo "gh (GitHub CLI) is required" >&2; exit 1; }

echo "== Claimed tasks (issues labelled in-progress)"
gh issue list --repo "$REPO" --state open --label in-progress --limit 100 \
  --json number,title,assignees \
  -q '.[] | "#\(.number)  [\([.assignees[].login] | join(",") | if . == "" then "UNASSIGNED" else . end)]  \(.title)"' \
  || true

echo
echo "== Open pull requests (author, draft?, files)"
prs_json="$(gh pr list --repo "$REPO" --state open --limit 100 --json number,title,author,isDraft,files)"
PRS_JSON="$prs_json" python3 - <<'PY'
import collections
import json
import os

prs = json.loads(os.environ["PRS_JSON"])
touch = collections.defaultdict(list)
for p in prs:
    files = [f["path"] for f in p.get("files", [])]
    flag = "draft" if p.get("isDraft") else "ready"
    print("#%s  [%s, %s]  %s  (%d files)" % (p["number"], p["author"]["login"], flag, p["title"], len(files)))
    for f in files:
        touch[f].append(p["number"])
print()
print("== Files touched by more than one open PR (coordinate before editing these)")
clash = {f: n for f, n in touch.items() if len(n) > 1}
if not clash:
    print("none")
for f, n in sorted(clash.items()):
    print("%s  <- PRs %s" % (f, ", ".join("#%s" % x for x in n)))
PY
