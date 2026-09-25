#!/usr/bin/env python3
"""W13/W10 follow-up: the auto-merge decision for an `agent/*` pull request.

Called by `.github/workflows/agent-automerge.yml`. All decision logic lives
here (unit tested in `src/factory/test_automerge_gate.py`); the workflow only
gathers GitHub context (branch, PR author, CI conclusion, the `agent-review`
verdict and its status creator, changed files, diff size) and acts on the
printed decision (`gh pr merge --squash --auto` or label `needs-human`).

**Without GitHub Pro, nothing enforces any of this at the platform level.**
This repo is private on GitHub Free, so branch protection / rulesets are
unavailable (the API returns "Upgrade to GitHub Pro"). A direct push to
`main`, or a merge from the GitHub UI by anyone with write access, bypasses
this workflow entirely -- it is not a security boundary, only a safety net
for the one path (`gh pr merge --squash --auto`) this workflow itself uses.
See docs/ops/AUTO_MERGE.md. `AUTO_MERGE_ENABLED` therefore defaults to off
and should stay off until GitHub Pro + a ruleset on `main` are in place.

Author check (fixed after hub review of the first version of this file): a
PR opened by `agent-task.yml` is authored by the built-in `GITHUB_TOKEN`,
which GitHub attributes to the `github-actions[bot]` app account, NOT to
`mahan-films` or any other human login -- the original allowlist
(`AGENT_ALLOWED_ACTORS`, meant for "who is allowed to *trigger* an agent
task" in agent-task.yml) blocked every legitimate agent PR here. This gate
instead requires the PR's author login to be exactly `github-actions[bot]`
(``DEFAULT_BOT_LOGIN``), plus (best-effort, cheap provenance) that the head
commit's own author is the same bot account when that's available.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# The GitHub App account attributed to the built-in GITHUB_TOKEN. agent-task.yml
# opens every agent PR with this token, never a PAT, so this -- not any human
# login -- is the identity an auto-merged PR must have authored it.
DEFAULT_BOT_LOGIN = "github-actions[bot]"

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
    pr_author_login: str
    ci_conclusion: str  # "success" | "failure" | anything else = not green
    review_verdict: str | None  # "approve" | "request_changes" | None = missing
    review_risk: str | None  # "low" | "medium" | "high" | None
    # Who (per the GitHub API) created the "agent-review" commit status being
    # read. A status posted by anyone/anything other than the bot is not
    # trusted, regardless of what verdict/risk it claims -- see the module
    # docstring, hub review point 6.
    review_status_creator: str | None = None
    # Best-effort, cheap provenance check: the head commit's own author login
    # (GET /repos/.../commits/:sha), when the caller could fetch it. None
    # means "not checked" and never blocks by itself -- this is a bonus
    # check on top of pr_author_login, not the primary gate.
    head_commit_author_login: str | None = None
    changed_files: list[str] = field(default_factory=list)
    diff_bytes: int = 0
    automerge_enabled: bool = False
    required_bot_login: str = DEFAULT_BOT_LOGIN
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

    if gi.pr_author_login != gi.required_bot_login:
        reasons.append(
            f"PR author is {gi.pr_author_login!r}, expected {gi.required_bot_login!r} "
            "(agent PRs are opened with the built-in GITHUB_TOKEN)"
        )

    if (
        gi.head_commit_author_login is not None
        and gi.head_commit_author_login != gi.required_bot_login
    ):
        reasons.append(
            f"head commit author is {gi.head_commit_author_login!r}, expected "
            f"{gi.required_bot_login!r} (provenance check)"
        )

    if gi.ci_conclusion != "success":
        reasons.append(f"CI is not green (conclusion={gi.ci_conclusion!r})")

    if gi.review_status_creator != gi.required_bot_login:
        reasons.append(
            f"agent-review status creator is {gi.review_status_creator!r}, expected "
            f"{gi.required_bot_login!r} -- ignoring any verdict it claims"
        )
    else:
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


def _bool_env(raw: str) -> bool:
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Auto-merge gate decision for an agent/* PR")
    ap.add_argument("--branch", required=True)
    ap.add_argument("--pr-author-login", required=True)
    ap.add_argument("--head-commit-author-login", default=None)
    ap.add_argument("--ci-conclusion", required=True)
    ap.add_argument("--review-json", type=Path, help="path to agent-review's --out result JSON")
    ap.add_argument(
        "--review-status-creator",
        default=None,
        help="creator login of the fetched agent-review commit status (from the GitHub API)",
    )
    ap.add_argument("--changed-files-file", type=Path, help="newline-separated changed file paths")
    ap.add_argument("--diff-bytes", type=int, default=0)
    ap.add_argument("--required-bot-login", default=DEFAULT_BOT_LOGIN)
    args = ap.parse_args(argv)

    automerge_enabled = _bool_env(os.environ.get("AUTO_MERGE_ENABLED", ""))
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
        pr_author_login=args.pr_author_login,
        ci_conclusion=args.ci_conclusion,
        review_verdict=review_verdict,
        review_risk=review_risk,
        review_status_creator=args.review_status_creator,
        head_commit_author_login=args.head_commit_author_login,
        changed_files=changed_files,
        diff_bytes=args.diff_bytes,
        automerge_enabled=automerge_enabled,
        required_bot_login=args.required_bot_login,
        max_diff_bytes=max_diff_bytes,
    )
    decision = decide(gi)
    print(json.dumps(decision.to_dict(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
