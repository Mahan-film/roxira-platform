#!/usr/bin/env python3
"""Server-side merge-gate decision for rx ``issue-<n>`` pull requests.

This module is a **pure** decision library: no network, no GitHub API calls,
no secrets, no clock. A later workflow gathers the PR, its check-runs and its
changed files, then calls :func:`decide` and acts on the returned action.

Why server-side (see ``docs/ops/RX_AUTOMERGE.md``): GitHub auto-merge can only
be enabled on a PR that *cannot* merge immediately, so a client that enables it
right after creating a PR races CI and depends on a flaky network. A merge done
with the built-in ``GITHUB_TOKEN`` also does not trigger workflows. The fix is
to wait for CI to finish, then let trusted code on ``main`` decide explicitly
and merge with a PAT/App token so main's CI and auto-deploy still run.

The required list here is deliberately stricter than the repo ruleset: a red
``Undefined names`` or ``System inventory up to date`` would not stop the
platform merge but *would* stop the auto-deploy, so it must stop us too.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

# Checks the ruleset enforces (strict up-to-date = false, 0 approvals).
REQUIRED: tuple[str, ...] = (
    "Detect changes",
    "Secret scan (new commits only)",
    "Pytest (unit)",
    "Frontend gate",
)
# Stricter than the ruleset on purpose: these gate the auto-deploy, not just
# the merge, so a red run must block the decision even though GitHub allows it.
EXTRA_REQUIRED: tuple[str, ...] = ("Undefined names", "System inventory up to date")

# Path prefixes that need the human `hub-approved` label before merge. A
# prefix matches only at the START of a repo-relative path, so `ops/` flags
# `ops/systemd/b.service` but not `src/ops/thing.py` or `docs/ops/RX_AUTOMERGE.md`.
SENSITIVE_PREFIXES: tuple[str, ...] = (
    ".github/",
    "scripts/ops/",
    "ops/",
    "migrations/",
    "docker/",
    ".semgrep/",
    "output_apps/nginx_config/",
    "output_apps/ecosystem_core/src/billing/",
    "output_apps/ecosystem_core/src/auth/",
)

# Entire repo-relative files that need `hub-approved` (matched whole-path).
SENSITIVE_FILES: tuple[str, ...] = (
    "config/models.yaml",
    "src/factory_pipeline/budget.py",
    "scripts/ci/merge_gate.py",
    "scripts/dev/rx",
    "output_apps/generated_modules/smartjudge/smartjudge_module.py",
    "output_apps/generated_modules/smartjudge/payment_service.py",
    "Dockerfile.prod",
)

# Globs matched against the BASENAME of a TOP-LEVEL file only.
SENSITIVE_TOP_LEVEL: tuple[str, ...] = ("docker-compose*", "nginx*")

# Documented union. `*.sql` matches any path ending in `.sql`.
SENSITIVE: tuple[str, ...] = (
    *SENSITIVE_PREFIXES,
    *SENSITIVE_FILES,
    *SENSITIVE_TOP_LEVEL,
    "*.sql",
)

MAX_CHANGED_LINES = 1500
HEAD_REF_RE = re.compile(r"^issue-[0-9]+$")
AGENT_REVIEW = "Agent review"
AGENT_REVIEW_BLOCKING: tuple[str, ...] = ("failure", "cancelled", "timed_out")


def _is_sensitive(path: str) -> bool:
    """Return True when a repo-relative path needs the ``hub-approved`` label.

    Prefixes match only at the START of the path; exact files match the whole
    path; ``docker-compose*`` / ``nginx*`` match the basename of a top-level
    file (or anything under ``output_apps/nginx_config/``); ``*.sql`` matches
    any path ending in ``.sql``.
    """
    normalized = str(path).strip().replace("\\", "/").lstrip("/")
    if not normalized:
        return False
    if normalized in SENSITIVE_FILES:
        return True
    if any(normalized.startswith(prefix) for prefix in SENSITIVE_PREFIXES):
        return True
    if normalized.endswith(".sql"):
        return True
    if "/" not in normalized and any(
        fnmatch.fnmatch(normalized, glob) for glob in SENSITIVE_TOP_LEVEL
    ):
        return True
    return False


def decide(
    pr: dict[str, Any],
    checks: Sequence[dict[str, Any]],
    files: Sequence[str],
    *,
    expected_sha: str,
    allowed_actors: Iterable[str],
    now: Any = None,
) -> dict[str, Any]:
    """Decide whether a PR should merge, wait, or block.

    ``pr`` is the PR shape ``{number, state, is_draft, author_login, head_ref,
    head_sha, mergeable, labels, additions, deletions}``. ``checks`` is a list
    of ``{name, status, conclusion}`` in GitHub check-runs shape for
    ``head_sha``. ``files`` is the list of changed repo-relative paths.

    A block always beats a wait, and a wait always beats a merge. Only the
    winning category's reasons are returned.
    """
    del now  # reserved for time-based policy; the pure gate needs no clock

    block: list[str] = []
    wait: list[str] = []

    # 1. Open, not a draft, no hold.
    state = pr.get("state")
    if state != "OPEN":
        block.append(f"not open (state={state!r})")
    if pr.get("is_draft"):
        block.append("is a draft")
    labels = {str(name) for name in pr.get("labels") or []}
    if "hold" in labels:
        block.append("hold label present")

    # 2. Branch shape and a trusted author.
    head_ref = str(pr.get("head_ref") or "")
    if not HEAD_REF_RE.match(head_ref):
        block.append(f"head ref {head_ref!r} does not match ^issue-[0-9]+$")
    author = str(pr.get("author_login") or "")
    if author not in set(allowed_actors):
        block.append(f"author {author!r} is not in allowed_actors")

    # 3. The run must be for the current head commit.
    if pr.get("head_sha") != expected_sha:
        wait.append("head moved; a newer run will decide")

    # 4. GitHub's own mergeability view.
    mergeable = pr.get("mergeable")
    if mergeable == "CONFLICTING":
        block.append("merge conflict")
    elif mergeable == "UNKNOWN":
        wait.append("mergeability unknown")

    # 5. Checks. Only the required list (plus Agent review) can block; every
    #    other check-run is report-only and may be red.
    by_name: dict[str, list[dict[str, Any]]] = {}
    for check in checks:
        by_name.setdefault(str(check.get("name")), []).append(check)

    for name in REQUIRED + EXTRA_REQUIRED:
        runs = by_name.get(name, [])
        if not runs:
            wait.append(f"required check {name!r} missing")
            continue
        if any(run.get("status") != "completed" for run in runs):
            wait.append(f"required check {name!r} not complete")
        for run in runs:
            conclusion = run.get("conclusion")
            normalized = str(conclusion).lower() if conclusion is not None else None
            if run.get("status") == "completed" and normalized != "success":
                # Only "success" passes a REQUIRED check (issue #423): failure,
                # skipped, neutral, cancelled, timed_out and null all block.
                block.append(f"required check {name!r} did not pass ({conclusion!r})")

    for run in by_name.get(AGENT_REVIEW, []):
        if run.get("status") != "completed":
            wait.append("agent review still running")
            continue
        if run.get("conclusion") in AGENT_REVIEW_BLOCKING:
            block.append("agent review rejected")

    # 6. Size guard.
    total_lines = int(pr.get("additions") or 0) + int(pr.get("deletions") or 0)
    if total_lines > MAX_CHANGED_LINES:
        block.append(f"too large ({total_lines} changed lines > {MAX_CHANGED_LINES})")

    # 7. Sensitive paths, unless a human applied `hub-approved`.
    if "hub-approved" not in labels:
        for raw in files:
            path = str(raw).strip().replace("\\", "/").lstrip("/")
            if path and _is_sensitive(path):
                block.append(f"sensitive path: {path} (needs label hub-approved)")

    if block:
        return {"action": "block", "reasons": block}
    if wait:
        return {"action": "wait", "reasons": wait}
    return {"action": "merge", "reasons": []}


def _split_actors(raw: str) -> list[str]:
    return [actor.strip() for actor in raw.split(",") if actor.strip()]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Merge-gate decision for an rx PR")
    parser.add_argument("--pr", type=Path, required=True, help="PR JSON object")
    parser.add_argument("--checks", type=Path, required=True, help="check-runs JSON list")
    parser.add_argument("--files", type=Path, required=True, help="changed paths, one per line")
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--actors", required=True, help="comma-separated allowed author logins")
    args = parser.parse_args(argv)

    pr = json.loads(args.pr.read_text(encoding="utf-8"))
    checks = json.loads(args.checks.read_text(encoding="utf-8"))
    files = [
        line
        for line in args.files.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    decision = decide(
        pr,
        checks,
        files,
        expected_sha=args.expected_sha,
        allowed_actors=_split_actors(args.actors),
    )
    print(json.dumps(decision))

    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        with open(output_path, "a", encoding="utf-8") as handle:
            handle.write(f"action={decision['action']}\n")
            handle.write(f"reasons={'; '.join(decision['reasons'])}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
