#!/usr/bin/env python3
"""CI check-run verifier for server-side autodeploy (T336 / #1285).

Refuses deployment of commits whose GitHub Actions CI checks are not green at job level.
Fails closed on API errors, with a documented owner override (AUTODEPLOY_SKIP_CI_GATE=1).

Exit codes:
  0: Green (all required jobs completed with success/skipped/neutral) or skipped by override.
  1: Red (one or more required or blocking jobs failed, timed out, or cancelled).
  2: Pending (checks are queued, in progress, or not yet registered; retry next tick).
  3: API Error (network error, HTTP failure, malformed response; fail closed).
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

DEFAULT_REPO = "Mahan-film/roxira-platform"

DEFAULT_REQUIRED_JOBS = [
    "Detect changes",
    "Secret scan (new commits only)",
    "Pytest (unit)",
    "Frontend gate",
    "Undefined names",
    "System inventory up to date",
]

ALLOWED_CONCLUSIONS = {"success", "skipped", "neutral"}
FAILURE_CONCLUSIONS = {"failure", "timed_out", "cancelled", "action_required", "stale"}


def is_non_blocking(name: str) -> bool:
    lower = name.lower()
    return "non-blocking" in lower or "report-only" in lower


def evaluate_check_runs(runs: list[dict[str, Any]], required_jobs: list[str]) -> tuple[int, str]:
    if not runs:
        return 2, "no check-runs found for commit (checks not registered or pending)"

    by_name = {run.get("name", ""): run for run in runs}

    # 1. Check for any explicit failures among blocking runs
    for run in runs:
        name = run.get("name", "")
        conclusion = run.get("conclusion")
        if is_non_blocking(name):
            continue
        if conclusion in FAILURE_CONCLUSIONS:
            return 1, f"job '{name}' failed with conclusion '{conclusion}'"

    # 2. Check status of required jobs
    for req in required_jobs:
        if req not in by_name:
            # Required job hasn't appeared yet
            return 2, f"required job '{req}' not found in check-runs (pending)"

        run = by_name[req]
        status = run.get("status", "")
        conclusion = run.get("conclusion")

        if status != "completed":
            return 2, f"required job '{req}' is pending (status='{status}')"

        if conclusion not in ALLOWED_CONCLUSIONS:
            return 1, f"required job '{req}' concluded with '{conclusion}' (not in allowed: {ALLOWED_CONCLUSIONS})"

    return 0, "all required check-runs are green"


def fetch_check_runs(sha: str, repo: str) -> list[dict[str, Any]]:
    # Allow fixture injection for testing
    fixture_path = os.environ.get("AUTODEPLOY_CI_CHECK_FILE")
    if fixture_path:
        with open(fixture_path, encoding="utf-8") as f:
            data = json.load(f)
            return data.get("check_runs", [])

    url = f"https://api.github.com/repos/{repo}/commits/{sha}/check-runs?per_page=100"
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "RoxiraAutodeploy/1.0",
    }
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("AUTODEPLOY_GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as resp:
        if resp.status != 200:
            raise RuntimeError(f"GitHub API returned HTTP {resp.status}")
        data = json.loads(resp.read().decode("utf-8"))
        return data.get("check_runs", [])


def main() -> int:
    # Check owner override
    if os.environ.get("AUTODEPLOY_SKIP_CI_GATE") == "1":
        print("CI gate skipped: AUTODEPLOY_SKIP_CI_GATE=1", file=sys.stderr)
        return 0

    if len(sys.argv) < 2:
        print("Usage: check_ci.py <commit_sha>", file=sys.stderr)
        return 3

    sha = sys.argv[1].strip()
    if not sha:
        print("Error: empty commit SHA", file=sys.stderr)
        return 3

    repo = os.environ.get("AUTODEPLOY_REPO_SLUG", DEFAULT_REPO)
    raw_reqs = os.environ.get("AUTODEPLOY_REQUIRED_JOBS")
    if raw_reqs:
        required_jobs = [j.strip() for j in raw_reqs.split(",") if j.strip()]
    else:
        required_jobs = DEFAULT_REQUIRED_JOBS

    try:
        runs = fetch_check_runs(sha, repo)
    except Exception as exc:
        print(f"CI gate API error for {sha[:8]}: {exc}", file=sys.stderr)
        return 3

    code, msg = evaluate_check_runs(runs, required_jobs)
    print(f"CI gate result for {sha[:8]}: {msg} (code={code})", file=sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
