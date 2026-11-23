#!/usr/bin/env python3
"""Read-only PR board: classify every open PR by what it waits for. No model calls, no writes.

    python3 scripts/dev/pr_board.py

Classes: ready (clean review at the exact head, green jobs, no protected path), owner (same, but a protected or money
path, a truncated review or a held PR), noverdict, blocked (a blocker newer than the head commit), red, dirty, draft.
This is a planning aid, not a merge gate: use scripts/dev/hub_merge.py (row #1282) to merge.
"""
import json,subprocess,re,sys
R="repos/Mahan-film/roxira-platform"
def api(p):
    r=subprocess.run(["gh","api",p],capture_output=True,text=True)
    if r.returncode: raise SystemExit("api fail "+p+" "+r.stderr[:200])
    return json.loads(r.stdout)
PROT=re.compile(r"(^|/)migrations/|auth|session|payment|billing|password|jwt|token|checkout|Dockerfile|docker-compose|nginx|^scripts/ops/|^scripts/ci/|^scripts/dev/(guard|review_desk|hub_|merge|claim)|^\.github/|^deploy/|^bin/|htpasswd|access/(catalogue|guards?|services)|permission-matrix|^config/|systemd",re.I)
MONEY=re.compile(r"accounting|invoic|ledger|tax|tariff|moadian|treasury|cheque|payroll",re.I)
HOLD = set()  # held PRs come from the "Held" list of docs/STATE.md; add ids here only for a local run
prs=[p for pg in (1,2) for p in api(f"{R}/pulls?state=open&per_page=100&page={pg}")]
out={"ready":[],"owner":[],"noverdict":[],"blocked":[],"red":[],"dirty":[],"draft":[]}
for p in prs:
    n=p["number"]; h=p["head"]["sha"]; t=p["title"][:62]
    if p["draft"]: out["draft"].append((n,t)); continue
    cd=api(f"{R}/commits/{h}")["commit"]["committer"]["date"]
    cr=[]; pg=1
    while True:
        x=api(f"{R}/commits/{h}/check-runs?per_page=100&page={pg}")["check_runs"]; cr+=x
        if len(x)<100: break
        pg+=1
    bad=[c["name"] for c in cr if c["status"]!="completed" or c["conclusion"] not in("success","skipped","neutral")]
    cm=api(f"{R}/issues/{n}/comments?per_page=100")
    if len(cm)==100: cm+=api(f"{R}/issues/{n}/comments?per_page=100&page=2")
    desk=[c for c in cm if "Cross-family review" in c["body"] and h in c["body"] and c["user"]["login"].startswith("github-actions")]
    dv=re.findall(r"^Verdict:\s*(.+)$",desk[-1]["body"],re.M)[-1:] if desk else []
    newer=[c for c in cm if c["created_at"]>=cd and re.search(r"verdict\W{0,12}(\w+\W+){0,2}?block",c["body"],re.I) and not re.search(r"verdict\W{0,6}no\W+block",c["body"],re.I)]
    trunc=bool(desk and re.search(r"truncated|NOT reviewed",desk[-1]["body"]))
    files=[f["filename"] for pg in (1,2,3) for f in api(f"{R}/pulls/{n}/files?per_page=100&page={pg}")] 
    prot=sorted({m.group(0) for f in files for m in [PROT.search(f)] if m}); money=any(MONEY.search(f) for f in files)
    full=api(f"{R}/pulls/{n}"); ms=full["mergeable_state"]
    row=(n,t,("trunc " if trunc else "")+("money " if money else "")+",".join(prot)[:80])
    if ms in("dirty",): out["dirty"].append(row)
    elif bad or not cr: out["red"].append((n,t,";".join(bad)[:70]))
    elif newer or (dv and "no blocker" not in dv[0]): out["blocked"].append(row)
    elif not dv: out["noverdict"].append(row)
    elif prot or money or trunc or n in HOLD or "needs owner" in t: out["owner"].append(row)
    else: out["ready"].append(row)
for k,v in out.items():
    print(f"## {k} {len(v)}")
    for r in sorted(v): print("  #",*r)
