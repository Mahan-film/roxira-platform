#!/usr/bin/env python3
"""Dry-run comparison: what the merge gate WOULD have done vs what actually happened (#1029 follow-up).

Replays the last N merged PRs through the gate's own rule methods (merge_gate.Gate, so the two cannot
drift) and prints a table plus a summary. Read-only: only GET requests go out (anything else raises).

Rules replayed per merged PR, as of the moment it was merged:
  hold        label / title marker / unresolved BLOCKER comment (labels are the current ones)
  protected   changed files vs protected_globs (B7), owner `OWNER-OK #<PR> <sha7>` comment by an allowlisted id
  review      latest review-desk comment (comments after merged_at are ignored) names the head SHA and
              says "no blocker", or an allowlisted human approved that head
  checks      required_checks on the head SHA (current check-runs; a rerun after the merge can skew this)
  behind      head behind the commit the PR was merged onto (first parent of the merge commit)
Not replayed: label `merge-queue` / auto-merge flag (not recoverable after the merge), draft state, base
branch (always main for a merged PR) and `mergeable_state`.

The interesting rows are "merged, but the gate would block": each is either a gate rule that is too
strict for the current workflow, a missing allowlist entry, or a merge that really bypassed review.

Usage: compare_history.py --config ~/.config/roxira-merge-gate/merge_gate.toml --limit 30 [--format md|json]
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).parent))

import merge_gate as mg  # noqa: E402

log = logging.getLogger("compare_history")
RULES = ("hold", "protected", "review", "checks", "behind")


class ReadOnlyAsOf:
    """Wraps a gh api callable: GET only, and drops comments/reviews/timeline events newer than `cutoff`."""

    def __init__(self, api: Callable, cutoff: str = ""):
        self.api, self.cutoff = api, cutoff

    def __call__(self, method: str, path: str, fields=None, paginate: bool = False):
        if method != "GET":
            raise mg.GhError(f"read-only report refuses {method} {path}")
        res = self.api(method, path, fields, paginate)
        if self.cutoff and "/check-runs" in path and isinstance(res, list):
            for page in res:  # runs started after the cutoff (reruns after the merge) did not exist yet
                if isinstance(page, dict) and "check_runs" in page:
                    page["check_runs"] = [r for r in page["check_runs"] if (r.get("started_at") or "") <= self.cutoff]
        if self.cutoff and isinstance(res, list):
            key = "submitted_at" if "/reviews?" in path else "created_at" if "/comments?" in path or "/timeline?" in path else ""
            if key:
                res = [x for x in res if (x.get(key) or "") <= self.cutoff]
        return res


def merged_prs(api: Callable, repo: str, limit: int) -> list[dict]:
    out: list[dict] = []
    page = 1
    while len(out) < limit and page <= 20:
        batch = api("GET", f"repos/{repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50&page={page}")
        if not batch:
            break
        out += [p for p in batch if p.get("merged_at")]
        page += 1
    out.sort(key=lambda p: p["merged_at"], reverse=True)
    return out[:limit]


def replay(cfg: dict, api: Callable, brief: dict) -> dict:
    """Return the per-rule outcome for one merged PR: {rule: (ok, why)} plus facts about what happened."""
    repo = cfg["repo"]
    n = brief["number"]
    pr = api("GET", f"repos/{repo}/pulls/{n}")
    head, merged_at = pr["head"]["sha"], pr["merged_at"]
    asof = ReadOnlyAsOf(getattr(api, "api", api), merged_at)  # unwrap: keep one cutoff
    gate = mg.Gate(cfg, asof, mg.State(os.devnull), True)  # State(os.devnull): never saved
    labels = {lb["name"] for lb in pr.get("labels", [])}
    res: dict[str, tuple[bool, str]] = {}
    why = gate.hold_reason(pr, labels)
    res["hold"] = (not why, why)
    files = api("GET", f"repos/{repo}/pulls/{n}/files?per_page=100", None, True)
    hits = mg.protected_hits(files, cfg["protected_globs"])
    ok = not hits or gate.owner_ok(n, head)
    res["protected"] = (ok, "" if ok else "owner sentence required (protected paths): " + ", ".join(hits[:3]))
    ok, why = gate.review_ok(n, head)
    res["review"] = (ok, "" if ok else why)
    status, why = gate.checks_status(head)
    res["checks"] = (status == mg.MERGE, why)
    behind, why = 0, ""
    mc = pr.get("merge_commit_sha")
    if mc:
        parents = api("GET", f"repos/{repo}/commits/{mc}").get("parents", [])
        if parents:
            behind = api("GET", f"repos/{repo}/compare/{parents[0]['sha']}...{head}").get("behind_by", 0)
    if behind:
        why = f"behind the merge base by {behind} commits"
    res["behind"] = (behind == 0 or not cfg.get("require_up_to_date", True), why if cfg.get("require_up_to_date", True) else "")
    return {
        "number": n,
        "merged_at": merged_at,
        "merged_by_id": (pr.get("merged_by") or {}).get("id"),
        "head": head[:8],
        "rules": res,
        "would_merge": all(ok for ok, _ in res.values()),
    }


def build_report(cfg: dict, api: Callable, limit: int) -> dict:
    rows = []
    for brief in merged_prs(api, cfg["repo"], limit):
        try:
            rows.append(replay(cfg, api, brief))
        except mg.GhError as e:
            log.error("#%s skipped: %s", brief["number"], e)
            rows.append({"number": brief["number"], "error": str(e)})
    done = [r for r in rows if "rules" in r]
    by_rule = Counter(rule for r in done for rule, (ok, _) in r["rules"].items() if not ok)
    return {
        "repo": cfg["repo"],
        "limit": limit,
        "rows": rows,
        "summary": {
            "replayed": len(done),
            "errors": len(rows) - len(done),
            "agree_would_merge": sum(1 for r in done if r["would_merge"]),
            "merged_but_gate_blocks": sum(1 for r in done if not r["would_merge"]),
            "blocked_by_rule": dict(by_rule),
            "gate_false_allow": "not measurable here: closed-unmerged PRs are not replayed",
        },
    }


def render_md(rep: dict) -> str:
    s = rep["summary"]
    lines = [
        f"# Merge gate dry-run comparison, last {rep['limit']} merged PRs",
        "",
        f"Replayed {s['replayed']} (errors {s['errors']}). Gate would merge {s['agree_would_merge']}; "
        f"would have blocked {s['merged_but_gate_blocks']} that were merged anyway.",
        "",
        "Blocked by rule (a PR can fail several): " + (", ".join(f"{k} {v}" for k, v in s["blocked_by_rule"].items()) or "none"),
        "",
        "| PR | merged_at | merged_by (id) | gate verdict | failing rules |",
        "|---|---|---|---|---|",
    ]
    for r in rep["rows"]:
        if "rules" not in r:
            lines.append(f"| #{r['number']} | | | error | {r['error'][:80]} |")
            continue
        bad = "; ".join(f"{k}: {w}" for k, (ok, w) in r["rules"].items() if not ok)
        lines.append(
            f"| #{r['number']} | {r['merged_at']} | {r['merged_by_id']} | "
            f"{'would merge' if r['would_merge'] else 'WOULD BLOCK'} | {bad or '-'} |"
        )
    lines += ["", "Limits: " + s["gate_false_allow"] + "; check-runs are the current ones (reruns after the merge can change them)."]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Compare gate decisions with merged history (read-only)")
    ap.add_argument("--config", default=os.environ.get("MERGE_GATE_CONFIG"))
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--format", choices=("md", "json"), default="md")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr)
    cfg = mg.load_config(args.config)
    rep = build_report(cfg, ReadOnlyAsOf(mg.GhApi(cfg["proxy"])), args.limit)
    if args.format == "json":
        print(json.dumps(rep, indent=1, default=list))
    else:
        print(render_md(rep))
    return 0


if __name__ == "__main__":
    sys.exit(main())
