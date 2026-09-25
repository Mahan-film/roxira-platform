#!/usr/bin/env python3
"""W13/W10 follow-up: the auto-merge decision for an `agent/*` pull request.

Called by `.github/workflows/agent-automerge.yml`. All decision logic lives
here (unit tested in `src/factory/test_automerge_gate.py`); the workflow only
gathers GitHub context (branch, actor, CI conclusion, the `agent-review`
verdict, changed files, diff size) and acts on the printed decision (`gh pr
merge --squash --auto` or label `needs-human`).

**Without GitHub Pro, nothing enforces any of this at the platform level.**
This repo is private on GitHub Free, so branch protection / rulesets are
unavailable (the API returns "Upgrade to GitHub Pro"). A direct push to
`main`, or a merge from the GitHub UI by anyone with write access, bypasses
this workflow entirely -- it is not a security boundary, only a safety net
for the one path (`gh pr merge --squash --auto`) this workflow itself uses.
See docs/ops/AUTO_MERGE.md. `AUTO_MERGE_ENABLED` therefore defaults to off
and should stay off until GitHub Pro + a ruleset on `main` are in place.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Same allowlist variable agent-task.yml already uses, same default.
DEFAULT_ALLOWED_ACTORS = "mahan-films"

# Deny list for auto-merge: broader and stricter than agent_runner.py's own
# agent-task denylist (which only blocks an agent from *writing* certain
# paths) -- this blocks *auto-merging* a PR that touches any of these, even
# if a human wrote part of it, because these are exactly the paths where a
# bad merge is expensive or dangerous. Patterns are fnmatch'd against the
# repo-relative, forward-slash, lowercased path of every changed file.
DENY_PATTERNS: tuple[str, ...] = (
    "docker-compose*.yml",
    "docker-compose*.yaml",
    ".github/*",
    ".github/**",
    "*nginx*.conf",
    "**/nginx*.conf",
    "*.service",
    "**/*.service",
    ".env",
    ".env.*",
    "**/.env",
    "**/.env.*",
    "config/models.yaml",
    "scripts/ops/*",
    "scripts/ops/**",
    "**/migrations/*",
    "**/migrations/**",
)
# Substring checks on the lowercased path -- auth/payment code can live
# anywhere in the tree and a glob would miss it.
DENY_KEYWORDS: tuple[str, ...] = ("zibal", "/payment", "/auth", "_auth", "auth_", "secret")


@dataclass
class GateInput:
    branch: str
    actor: str
    ci_conclusion: str  # "success" | "failure" | anything else = not green
    review_verdict: str | None  # "approve" | "request_changes" | None = missing
    review_risk: str | None  # "low" | "medium" | "high" | None
    changed_files: list[str] = field(default_factory=list)
    diff_bytes: int = 0
    automerge_enabled: bool = False
    allowed_actors: list[str] = field(default_factory=lambda: [DEFAULT_ALLOWED_ACTORS])
    max_diff_bytes: int = 60_000


@dataclass
class GateDecision:
    allow: bool
    reasons: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {"allow": self.allow, "reasons": self.reasons}


def denylisted_paths(changed_files: list[str]) -> list[str]:
    hits: list[str] = []
    for raw in changed_files:
        path = raw.strip().replace("\\", "/").lstrip("/")
        if not path:
            continue
        lower = path.lower()
        if any(kw in lower for kw in DENY_KEYWORDS):
            hits.append(raw)
            continue
        if any(fnmatch.fnmatch(path, pat) or fnmatch.fnmatch(lower, pat) for pat in DENY_PATTERNS):
            hits.append(raw)
    return hits


def decide(gi: GateInput) -> GateDecision:
    """Pure decision function -- no I/O, no GitHub/gh calls. Every rule is
    additive (a single failing condition is enough to refuse); all reasons
    are collected rather than short-circuiting, so a `needs-human` label or
    log line explains everything wrong at once, not just the first thing."""
    reasons: list[str] = []

    if not gi.automerge_enabled:
        reasons.append("AUTO_MERGE_ENABLED is not 'true'")

    if not gi.branch.startswith("agent/"):
        reasons.append(f"branch {gi.branch!r} does not start with 'agent/'")

    if gi.actor not in gi.allowed_actors:
        reasons.append(f"actor {gi.actor!r} not in the allowlist {gi.allowed_actors}")

    if gi.ci_conclusion != "success":
        reasons.append(f"CI is not green (conclusion={gi.ci_conclusion!r})")

    if gi.review_verdict != "approve":
        reasons.append(f"agent-review verdict is {gi.review_verdict!r}, not 'approve'")

    if gi.review_risk != "low":
        reasons.append(f"agent-review risk is {gi.review_risk!r}, not 'low'")

    if gi.diff_bytes > gi.max_diff_bytes:
        reasons.append(f"diff is {gi.diff_bytes} bytes, over the {gi.max_diff_bytes}-byte limit")

    hits = denylisted_paths(gi.changed_files)
    if hits:
        reasons.append("changed path(s) on the auto-merge deny list: " + ", ".join(hits))

    return GateDecision(allow=not reasons, reasons=reasons)


# ---------------------------------------------------------------------------
# CLI (called by .github/workflows/agent-automerge.yml)
# ---------------------------------------------------------------------------


def _parse_actors(raw: str) -> list[str]:
    return [a.strip() for a in raw.split(",") if a.strip()] or [DEFAULT_ALLOWED_ACTORS]


def _bool_env(raw: str) -> bool:
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Auto-merge gate decision for an agent/* PR")
    ap.add_argument("--branch", required=True)
    ap.add_argument("--actor", required=True)
    ap.add_argument("--ci-conclusion", required=True)
    ap.add_argument("--review-json", type=Path, help="path to agent-review's --out result JSON")
    ap.add_argument("--changed-files-file", type=Path, help="newline-separated changed file paths")
    ap.add_argument("--diff-bytes", type=int, default=0)
    args = ap.parse_args(argv)

    automerge_enabled = _bool_env(os.environ.get("AUTO_MERGE_ENABLED", ""))
    allowed_actors = _parse_actors(os.environ.get("AGENT_ALLOWED_ACTORS", DEFAULT_ALLOWED_ACTORS))
    max_diff_bytes = int(os.environ.get("AGENT_AUTOMERGE_MAX_DIFF_BYTES", "60000"))

    review_verdict: str | None = None
    review_risk: str | None = None
    if args.review_json and args.review_json.exists():
        try:
            review_result = json.loads(args.review_json.read_text(encoding="utf-8"))
            verdict = review_result.get("verdict") or {}
            review_verdict = verdict.get("verdict")
            review_risk = verdict.get("risk")
        except (ValueError, OSError):
            pass

    changed_files: list[str] = []
    if args.changed_files_file and args.changed_files_file.exists():
        changed_files = [
            line.strip()
            for line in args.changed_files_file.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    gi = GateInput(
        branch=args.branch,
        actor=args.actor,
        ci_conclusion=args.ci_conclusion,
        review_verdict=review_verdict,
        review_risk=review_risk,
        changed_files=changed_files,
        diff_bytes=args.diff_bytes,
        automerge_enabled=automerge_enabled,
        allowed_actors=allowed_actors,
        max_diff_bytes=max_diff_bytes,
    )
    decision = decide(gi)
    print(json.dumps(decision.to_dict(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
