#!/usr/bin/env bash
# Who is working on what right now? Read-only. Run before starting any task.
#   bash scripts/dev/whoswhat.sh
# Shows: claimed issues (label in-progress), open PRs with their author and changed files,
# and files touched by more than one open PR (likely conflict / duplicate work).
# Source of truth is GitHub (issues + PRs), not a file in the repo. See docs/COLLABORATION.md.
set -euo pipefail

REPO="${ROXIRA_REPO:-Mahan-film/roxira-platform}"
command -v gh >/dev/null || { echo "gh (GitHub CLI) is required" >&2; exit 1; }

# REST only (gh api): GraphQL is blocked in Claude Code cloud sessions.
echo "== Claimed tasks (issues labelled in-progress)"
gh api "repos/$REPO/issues?state=open&labels=in-progress&per_page=100" \
  -q '.[] | select(.pull_request | not) | "#\(.number)  [\([.assignees[].login] | join(",") | if . == "" then "UNASSIGNED" else . end)]  \(.title)"' \
  || true

echo
echo "== Open pull requests (author, draft?, files)"
prs_json="$(gh api "repos/$REPO/pulls?state=open&per_page=100" \
  -q '[.[] | {number, title, author: {login: .user.login}, isDraft: .draft}]')"
files_json="{"
sep=""
for n in $(printf '%s' "$prs_json" | python3 -c 'import json,sys; print(" ".join(str(p["number"]) for p in json.load(sys.stdin)))'); do
  f="$(gh api --paginate "repos/$REPO/pulls/$n/files?per_page=100" -q '.[].filename' | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().split()))')"
  files_json="$files_json$sep\"$n\": $f"
  sep=", "
done
files_json="$files_json}"
PRS_JSON="$prs_json" FILES_JSON="$files_json" python3 - <<'PY'
import collections
import json
import os

prs = json.loads(os.environ["PRS_JSON"])
files_by_pr = json.loads(os.environ["FILES_JSON"])
touch = collections.defaultdict(list)
for p in prs:
    files = files_by_pr.get(str(p["number"]), [])
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
