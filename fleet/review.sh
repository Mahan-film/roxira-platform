#!/usr/bin/env bash
# review.sh <pr> [--post]: cross-family review of a PR through the srv1 gateway (scripts/dev/llm_route.py).
# Prints verdict line. An empty or verdict-less review is NOT a pass. Coordinator still reads every diff itself.
set -uo pipefail
PR="$1"; POST="${2:-}"; R=Mahan-film/roxira-platform; D=/home/mahan/Developer/roxira-wt/_fleet/reviews; mkdir -p "$D"
G=/home/mahan/Developer/roxira-platform
set -a; . "$HOME/Secrets/roxira/llm-gateway.env"; set +a
SHA=$(gh pr view "$PR" -R $R --json headRefOid --jq .headRefOid)
gh pr diff "$PR" -R $R > "$D/$PR.diff" || exit 2
python3 - "$D/$PR.diff" <<'PY'
import re,sys
p=sys.argv[1]; s=open(p,errors='replace').read()
parts=re.split(r'(?m)^(?=diff --git )',s)
keep=[x for x in parts if x and not re.match(r'diff --git \S+\.(png|jpg|xlsx)\b',x)]
open(p,'w').write(''.join(keep))
PY
PROMPT='You are a strict reviewer for an accounting ERP in NestJS and Next.js, for Iran. Other-family review of a public-repo diff. Check: money must be integer rials through money.ts with no float maths; tenant isolation, FORCE RLS on new tables; migration timestamps and order; hardcoded rates or account codes; DTO validation; secrets; and tests that truly assert. Quote file and line for each finding, and verify it against the diff. Group as **Blocker**, **Major**, **Minor**. Under 500 words. A test fixture or helper is not production code: float maths or fixture account codes there are Minor at most. Begin your reply with exactly one line: "Verdict: blocker" or "Verdict: no blocker".'
cd "$G"; for try in 1 2 3 4; do python3 scripts/dev/llm_route.py --diff "$D/$PR.diff" --prompt "$PROMPT" --max-tokens 2500 > "$D/$PR.out" 2> "$D/$PR.err"; rc=$?; grep -qiE '^\W*verdict:' "$D/$PR.out" && break; done
V=$(grep -iE '^\W*verdict:' "$D/$PR.out" | head -1 | tr -d '*#' )
L=$(wc -c < "$D/$PR.out")
echo "pr=$PR sha=${SHA:0:8} rc=$rc bytes=$L ${V:-NO VERDICT} route=$(tail -1 "$D/$PR.err" | cut -c1-80)"
if [ "$POST" = "--post" ] && [ -n "$V" ] && [ "$L" -gt 80 ]; then { echo "Cross-family review (srv1 gateway, llm_route) @ $SHA"; echo; cat "$D/$PR.out"; } > "$D/$PR.comment"; gh pr comment "$PR" -R $R --body-file "$D/$PR.comment" | tail -1; fi
[ -n "$V" ] && [ "$L" -gt 80 ]
