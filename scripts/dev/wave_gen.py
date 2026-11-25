#!/usr/bin/env python3
"""Generate the next `## WAVE` comment body from open GitHub issues and PRs.

Default mode is --dry-run (prints the WAVE markdown to stdout).
Use --post to post to issue #592; requires the active `gh` login to be listed in
the WAVE_POSTERS environment variable (comma or whitespace separated).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

DEFAULT_REPO = "Mahan-film/roxira-platform"
DEFAULT_ISSUE = 592
WIP_LIMIT = 8
MAX_ROWS_PER_LANE = 6
LANE_ORDER = [f"L{i}" for i in range(1, 13)] + ["M1", "M2", "M3", "P1"]

_LANE_LABEL_RE = re.compile(r"^lane:([a-z0-9-]+)$", re.I)
_PRIO_LABEL_RE = re.compile(r"^prio:(\d+)$", re.I)
_AFTER_DEP_RE = re.compile(r"\bafter\s+(?:T|#)(\d+)\b", re.I)
_AGENT_LANE_RE = re.compile(r"(?:^|/)antigravity-(l\d+|m\d+|p1)(?:-|/|$)", re.I)
_WAVE_NUM_RE = re.compile(r"^##\s+WAVE\s+(\d+)\b", re.M)


def _label_names(item: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for lbl in item.get("labels") or []:
        if isinstance(lbl, dict):
            name = str(lbl.get("name") or "").strip()
        else:
            name = str(lbl).strip()
        if name:
            out.append(name)
    return out


def extract_lane(issue: dict[str, Any]) -> str | None:
    """Return normalized lane id (e.g. 'L1') from `lane:*` labels, else None."""
    for name in _label_names(issue):
        m = _LANE_LABEL_RE.match(name)
        if m:
            return m.group(1).upper()
    return None


def extract_prio(issue: dict[str, Any]) -> int:
    """Return integer priority from `prio:N` labels (smaller = higher priority)."""
    prios: list[int] = []
    for name in _label_names(issue):
        m = _PRIO_LABEL_RE.match(name)
        if m:
            prios.append(int(m.group(1)))
    return min(prios) if prios else 99


def is_needs_human(issue: dict[str, Any]) -> bool:
    """True when the issue carries a `needs-human` label."""
    return any(lbl.lower() == "needs-human" for lbl in _label_names(issue))


def unmerged_dependencies(issue: dict[str, Any], merged_refs: set[int]) -> list[int]:
    """Return referenced `after T<n>` / `after #<n>` ids that are not in merged_refs."""
    blob = f"{issue.get('title') or ''}\n{issue.get('body') or ''}"
    missing: list[int] = []
    for m in _AFTER_DEP_RE.finditer(blob):
        dep = int(m.group(1))
        if dep not in merged_refs and dep not in missing:
            missing.append(dep)
    return missing


def infer_pr_lane(pr: dict[str, Any]) -> str | None:
    """Infer lane id from branch name or explicit `lane` field."""
    explicit = pr.get("lane")
    if explicit:
        return str(explicit).upper()
    branch = str(pr.get("headRefName") or "")
    m = _AGENT_LANE_RE.search(branch)
    if m:
        return m.group(1).upper()
    return None


def is_waiting_owner_pr(pr: dict[str, Any]) -> bool:
    """PRs waiting only for owner approval do not count toward the WIP limit of 8."""
    labels = {lbl.lower() for lbl in _label_names(pr)}
    if "needs-human" in labels or "do-not-merge" in labels:
        return True
    title = str(pr.get("title") or "").lower()
    return "[needs owner]" in title or "waiting-owner" in title


def count_lane_wip(prs: list[dict[str, Any]]) -> dict[str, list[int]]:
    """Map lane -> sorted list of active open PR numbers (excluding WAITING-OWNER)."""
    wip: dict[str, list[int]] = {}
    for pr in prs:
        if (pr.get("state") or "OPEN").upper() != "OPEN":
            continue
        if is_waiting_owner_pr(pr):
            continue
        lane = infer_pr_lane(pr)
        if not lane:
            continue
        wip.setdefault(lane, []).append(int(pr["number"]))
    for nums in wip.values():
        nums.sort()
    return wip


def extract_done_when(issue: dict[str, Any]) -> str:
    """Extract a single-line Done when condition from issue body, or synthesize one."""
    body = str(issue.get("body") or "")
    for line in body.splitlines():
        m = re.match(r"^\s*\*?Done when:?\*?\s*(.+)$", line, re.I)
        if m:
            return m.group(1).strip()
    return f"PR passes tests and closes #{issue['number']}."


def build_wave(
    issues: list[dict[str, Any]],
    open_prs: list[dict[str, Any]],
    *,
    merged_refs: set[int] | None = None,
    wave_number: int = 1,
    wave_date: str | None = None,
    wip_limit: int = WIP_LIMIT,
    max_rows_per_lane: int = MAX_ROWS_PER_LANE,
) -> str:
    """Build deterministic `## WAVE` markdown from open issues and open PRs."""
    merged = set(merged_refs or ())
    for pr in open_prs:
        if (pr.get("state") or "").upper() == "MERGED":
            merged.add(int(pr["number"]))

    wip_by_lane = count_lane_wip(open_prs)
    per_lane: dict[str, list[dict[str, Any]]] = {}
    skipped_needs_human: list[int] = []
    skipped_deps: list[tuple[int, list[int]]] = []

    for issue in issues:
        if (issue.get("state") or "OPEN").upper() != "OPEN":
            continue
        lane = extract_lane(issue)
        if not lane:
            continue
        num = int(issue["number"])
        if is_needs_human(issue):
            skipped_needs_human.append(num)
            continue
        missing = unmerged_dependencies(issue, merged)
        if missing:
            skipped_deps.append((num, missing))
            continue
        per_lane.setdefault(lane, []).append(issue)

    date_str = wave_date or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    lines = [
        f"## WAVE {wave_number} (wave_gen, {date_str})",
        "",
        f"Generated from open issues (`wip_limit={wip_limit}`, `max_rows_per_lane={max_rows_per_lane}`).",
        "",
        "### Lane queues (ordered)",
        "",
    ]

    ordered_lanes = [l for l in LANE_ORDER if l in per_lane or l in wip_by_lane]
    extra_lanes = sorted(l for l in set(per_lane) | set(wip_by_lane) if l not in LANE_ORDER)
    for lane in ordered_lanes + extra_lanes:
        active_prs = wip_by_lane.get(lane, [])
        wip_count = len(active_prs)
        free_slots = max(0, wip_limit - wip_count)
        prs_text = " ".join(f"#{n}" for n in active_prs) if active_prs else "none"
        lines.append(f"- **{lane}** (open active PRs: {prs_text} — {wip_count}/{wip_limit}, **{free_slots} slots free**):")
        if wip_count >= wip_limit:
            lines.append(f"  *(WIP limit {wip_limit} reached; fix/label existing open PRs before taking new rows.)*")
            lines.append("")
            continue
        lane_issues = sorted(
            per_lane.get(lane, []),
            key=lambda it: (extract_prio(it), int(it["number"])),
        )[:max_rows_per_lane]
        if not lane_issues:
            lines.append("  *(No qualifying open issues.)*")
            lines.append("")
            continue
        for idx, it in enumerate(lane_issues, 1):
            num = int(it["number"])
            title = str(it.get("title") or "").strip()
            done_when = extract_done_when(it)
            lines.append(f"  {idx}. **#{num}** {title}")
            lines.append(f"     *Done when:* {done_when}")
        lines.append("")

    if skipped_needs_human or skipped_deps:
        lines.append("### Skipped")
        lines.append("")
        if skipped_needs_human:
            nums = ", ".join(f"#{n}" for n in sorted(skipped_needs_human))
            lines.append(f"- `needs-human`: {nums}")
        for num, deps in sorted(skipped_deps):
            dep_str = ", ".join(f"#{d}" for d in deps)
            lines.append(f"- `after` unmerged dependency: #{num} waiting on {dep_str}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def allowed_posters(env_value: str | None = None) -> set[str]:
    """Return allowed GitHub logins from WAVE_POSTERS (fail closed when unset)."""
    raw = env_value if env_value is not None else os.environ.get("WAVE_POSTERS", "")
    return {tok.strip().lower() for tok in re.split(r"[\s,]+", raw) if tok.strip()}


def can_post(login: str, env_value: str | None = None) -> bool:
    """True only when WAVE_POSTERS includes login (case-insensitive)."""
    norm = login.strip().lower()
    return bool(norm and norm in allowed_posters(env_value))


def _gh_json(args: list[str]) -> Any:
    res = subprocess.run(["gh", *args], capture_output=True, text=True, check=False)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or f"gh {' '.join(args)} failed")
    return json.loads(res.stdout)


def detect_next_wave_number(repo: str, issue: int) -> int:
    comments = _gh_json(["api", f"repos/{repo}/issues/{issue}/comments", "--paginate"])
    highest = 0
    for c in comments:
        for m in _WAVE_NUM_RE.finditer(c.get("body") or ""):
            highest = max(highest, int(m.group(1)))
    return highest + 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", default=DEFAULT_REPO)
    ap.add_argument("--issue", type=int, default=DEFAULT_ISSUE)
    ap.add_argument("--wave", type=int, default=None)
    ap.add_argument("--date", default=None)
    ap.add_argument("--issues-file", type=Path, default=None, help="Offline issues JSON file")
    ap.add_argument("--prs-file", type=Path, default=None, help="Offline PRs JSON file")
    ap.add_argument("--merged-refs", default="", help="Comma-separated merged PR/issue numbers")
    ap.add_argument("--dry-run", action="store_true", help="Print WAVE body only (default)")
    ap.add_argument("--post", action="store_true", help="Post to issue (requires WAVE_POSTERS)")
    args = ap.parse_args(argv)

    if args.issues_file:
        issues = json.loads(args.issues_file.read_text(encoding="utf-8"))
    else:
        issues = _gh_json(
            ["issue", "list", "--repo", args.repo, "--state", "open", "--limit", "300",
             "--json", "number,title,body,state,labels"]
        )

    if args.prs_file:
        prs = json.loads(args.prs_file.read_text(encoding="utf-8"))
    else:
        prs = _gh_json(
            ["pr", "list", "--repo", args.repo, "--state", "all", "--limit", "300",
             "--json", "number,title,state,headRefName,labels"]
        )

    merged_refs = {
        int(tok.strip())
        for tok in args.merged_refs.split(",")
        if tok.strip().isdigit()
    }
    for it in issues:
        if (it.get("state") or "").upper() == "CLOSED":
            merged_refs.add(int(it["number"]))

    wave_num = args.wave
    if wave_num is None:
        wave_num = 1 if (args.issues_file or args.prs_file) else detect_next_wave_number(args.repo, args.issue)

    body = build_wave(
        issues,
        prs,
        merged_refs=merged_refs,
        wave_number=wave_num,
        wave_date=args.date,
    )

    if not args.post or args.dry_run:
        sys.stdout.write(body)
        return 0

    login_proc = subprocess.run(["gh", "api", "user", "--jq", ".login"], capture_output=True, text=True, check=False)
    if login_proc.returncode != 0:
        print("REFUSE: unable to verify gh login for --post", file=sys.stderr)
        return 1
    login = login_proc.stdout.strip()
    if not can_post(login):
        print(f"REFUSE: login '{login}' is not authorized in WAVE_POSTERS", file=sys.stderr)
        return 1

    post_proc = subprocess.run(
        ["gh", "issue", "comment", str(args.issue), "--repo", args.repo, "--body", body],
        capture_output=True,
        text=True,
        check=False,
    )
    if post_proc.returncode != 0:
        print(f"ERROR: failed to post wave: {post_proc.stderr.strip()}", file=sys.stderr)
        return 1
    sys.stdout.write(post_proc.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
