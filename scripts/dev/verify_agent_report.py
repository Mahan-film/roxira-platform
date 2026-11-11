#!/usr/bin/env python3
"""Check an Antigravity REPORT against live GitHub so fabricated claims are caught.

Usage:
  python3 scripts/dev/verify_agent_report.py [--repo OWNER/REPO] [--since YYYY-MM-DD] [REPORT_FILE|-]

Reads the report from stdin by default. Uses only the `gh` and `git` CLIs.
Exit codes: 0 no problems, 1 problems found, 2 usage error.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys

DEFAULT_REPO = "Mahan-film/roxira-platform"
PR_FIELDS = "number,state,headRefOid,mergeable,createdAt,updatedAt,statusCheckRollup,comments,url"

_ROW_RE = re.compile(r"^\s*(T\d+)\s*\|(.*)$")
_PR_RE = re.compile(r"PR\s*#\s*(\d+)(?:\s*@\s*([0-9a-fA-F]{6,40}))?")
_STATE_RE = re.compile(r"\b(MERGEABLE|CONFLICTING|MERGED)\b")
_CI_RE = re.compile(r"^CI\s+(\w+)", re.IGNORECASE)
_PATH_RE = re.compile(r"(?<![\w/.-])((?:[\w.-]+/)+[\w.-]+\.\w+)")
_SECTION_RE = re.compile(r"^\s*(DONE|SKIPPED|BLOCKED)\s*:\s*$", re.IGNORECASE)

RED = {"FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "ERROR", "STARTUP_FAILURE"}


def parse_report(text: str) -> dict:
    out: dict = {"done": [], "skipped": [], "blocked": []}
    section = None
    last = None
    for line in text.splitlines():
        m = _SECTION_RE.match(line)
        if m:
            section = m.group(1).lower()
            last = None
            continue
        r = _ROW_RE.match(line)
        if r and section:
            task, rest = r.group(1), r.group(2)
            fields = [f.strip() for f in rest.split("|")]
            if section == "done":
                row = _parse_done(task, fields)
            elif section == "skipped":
                pm = _PATH_RE.search(rest)
                row = {"task": task, "path": pm.group(1) if pm else None}
            else:
                row = {"task": task, "text": rest.strip()}
            out[section].append(row)
            last = row if section == "done" else None
            continue
        if last is not None and line.strip():
            s = line.strip()
            if s.lower().startswith("tests:"):
                last["tests"] = s[6:].strip() or None
    return out


def _parse_done(task: str, fields: list[str]) -> dict:
    row = {"task": task, "pr": None, "sha": None, "state": None, "ci": None,
           "review": None, "tests": None}
    for f in fields:
        pm = _PR_RE.search(f)
        if pm and row["pr"] is None:
            row["pr"] = int(pm.group(1))
            row["sha"] = pm.group(2).lower() if pm.group(2) else None
            continue
        sm = _STATE_RE.fullmatch(f)
        if sm:
            row["state"] = sm.group(1)
            continue
        cm = _CI_RE.match(f)
        if cm:
            row["ci"] = cm.group(1).lower()
            continue
        low = f.lower()
        if low.startswith("review:"):
            row["review"] = f[7:].strip().lower()
        elif low.startswith("tests:"):
            row["tests"] = f[6:].strip() or None
    return row


def derive_ci(status_check_rollup: list) -> str:
    if not status_check_rollup:
        return "none"
    pending = False
    for c in status_check_rollup:
        concl = (c.get("conclusion") or "").upper()
        state = (c.get("state") or "").upper()  # StatusContext entries
        if concl in RED or state in RED:
            return "red"
        status = (c.get("status") or "").upper()
        if (status and status != "COMPLETED") or state == "PENDING":
            pending = True
    return "pending" if pending else "green"


def latest_review(comments: list, head_sha: str) -> str:
    revs = [c for c in comments if (c.get("body") or "").lstrip().startswith("Cross-family review")]
    if not revs:
        return "none yet"
    lines = revs[-1]["body"].lstrip().splitlines()
    if head_sha[:7].lower() not in lines[0].lower():
        return "stale"
    for ln in lines:
        if ln.strip().startswith("Verdict:"):
            low = ln.lower()
            if "no blocker" in low:
                return "no blocker"
            if "blocker" in low:
                return "blocker"
    return "none yet"


def actual_summary(pr_json: dict | None) -> dict | None:
    if not pr_json:
        return None
    sha = pr_json.get("headRefOid") or ""
    return {
        "state": pr_json.get("state"),
        "mergeable": pr_json.get("mergeable"),
        "sha8": sha[:8],
        "ci": derive_ci(pr_json.get("statusCheckRollup") or []),
        "review": latest_review(pr_json.get("comments") or [], sha),
    }


def compare(row: dict, pr_json: dict | None, since: str | None) -> list[str]:
    if pr_json is None:
        return ["PR not found"]
    probs: list[str] = []
    a = actual_summary(pr_json)
    sha = pr_json.get("headRefOid") or ""
    if row.get("sha") and not sha.lower().startswith(row["sha"].lower()):
        probs.append(f"sha mismatch: claimed {row['sha']}, head is {sha[:8]}")
    st = row.get("state")
    if st == "MERGED" and a["state"] != "MERGED":
        probs.append(f"claimed MERGED but state is {a['state']}")
    # UNKNOWN means GitHub is still computing mergeability; only a real conflict counts.
    # A PR that merged after the report was written satisfies a MERGEABLE claim.
    if st == "MERGEABLE" and a["state"] != "MERGED" and (a["state"] != "OPEN" or a["mergeable"] == "CONFLICTING"):
        probs.append(f"claimed MERGEABLE but state={a['state']} mergeable={a['mergeable']}")
    if st == "CONFLICTING" and a["mergeable"] != "CONFLICTING":
        probs.append(f"claimed CONFLICTING but mergeable={a['mergeable']}")
    if (row.get("ci") or "") == "green" and a["ci"] != "green":
        probs.append(f"claimed CI green but actual is {a['ci']}")
    if (row.get("review") or "").startswith("no blocker") and a["review"] != "no blocker":
        probs.append(f"claimed review no blocker but latest is {a['review']}")
    if a["review"] == "blocker":
        probs.append("latest cross-family review is a blocker")
    if since:
        upd = (pr_json.get("updatedAt") or "")[:10]
        if upd and upd < since:
            probs.append(f"PR is older than this wave (updated {upd} < {since})")
    if not row.get("tests"):
        probs.append("no test evidence")
    return probs


def check_skipped(row: dict, exists) -> list[str]:
    if not row.get("path"):
        return ["no path given"]
    if not exists(row["path"]):
        return [f"path missing on origin/main: {row['path']}"]
    return []


def _git_exists(path: str) -> bool:
    r = subprocess.run(["git", "cat-file", "-e", f"origin/main:{path}"],
                       capture_output=True, text=True)
    return r.returncode == 0


def _fetch_pr(repo: str, n: int) -> dict | None:
    try:
        r = subprocess.run(["gh", "pr", "view", str(n), "--repo", repo, "--json", PR_FIELDS],
                           capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        print(f"gh pr view {n} failed: {r.stderr.strip()[:200]}", file=sys.stderr)
        return None
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return None


def _cell(s: str) -> str:
    return s.replace("|", "/").replace("\n", " ")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", default=DEFAULT_REPO)
    ap.add_argument("--since", default=None, help="YYYY-MM-DD")
    ap.add_argument("report", nargs="?", default="-")
    try:
        args = ap.parse_args(argv)
    except SystemExit:
        return 2
    if args.since and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.since):
        print("--since must be YYYY-MM-DD", file=sys.stderr)
        return 2
    try:
        text = sys.stdin.read() if args.report == "-" else open(args.report, encoding="utf-8").read()
    except OSError as e:
        print(f"cannot read report: {e}", file=sys.stderr)
        return 2

    rep = parse_report(text)
    if not (rep["done"] or rep["skipped"] or rep["blocked"]):
        print("no report rows found", file=sys.stderr)
        return 2

    cache: dict[int, dict | None] = {}
    total = 0
    lines = ["| T | PR | claimed | actual (state, sha8, CI, review) | problems |",
             "|---|---|---|---|---|"]
    for row in rep["done"]:
        n = row["pr"]
        if n is None:
            probs, actual = ["no PR number"], "-"
        else:
            if n not in cache:
                cache[n] = _fetch_pr(args.repo, n)
            pj = cache[n]
            probs = compare(row, pj, args.since)
            a = actual_summary(pj)
            actual = f"{a['state']}, {a['sha8']}, {a['ci']}, {a['review']}" if a else "-"
        claimed = ", ".join(x for x in (row["state"], f"CI {row['ci']}" if row["ci"] else None,
                                         f"review {row['review']}" if row["review"] else None,
                                         row["sha"]) if x) or "-"
        total += len(probs)
        lines.append(f"| {row['task']} | {'#' + str(n) if n else '-'} | {_cell(claimed)} | "
                     f"{_cell(actual)} | {_cell('; '.join(probs)) or 'ok'} |")

    if rep["skipped"]:
        subprocess.run(["git", "fetch", "-q", "origin"], capture_output=True)
    for row in rep["skipped"]:
        probs = check_skipped(row, _git_exists)
        total += len(probs)
        lines.append(f"| {row['task']} | skipped | {_cell(row['path'] or '-')} | - | "
                     f"{_cell('; '.join(probs)) or 'ok'} |")

    print("\n".join(lines))
    print(f"RESULT: {'OK' if total == 0 else f'{total} problem(s)'}")
    return 0 if total == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
