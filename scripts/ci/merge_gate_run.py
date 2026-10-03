#!/usr/bin/env python3
"""Orchestrates the merge-gate decision for rx ``issue-<n>`` pull requests.

Run by ``.github/workflows/rx-automerge.yml`` from the default branch. It
gathers the PR, its changed files and its check-runs through the ``gh`` CLI
(arguments are passed as a list, never interpolated into a shell string), calls
``merge_gate.decide`` and acts on the result:

- ``block``: create or update the single marked PR comment with the reasons.
- ``wait``: no writes; a later workflow run will decide.
- ``merge``: ``gh pr merge --squash --match-head-commit <sha>`` using
  ``MERGE_BOT_TOKEN`` (never any other token).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from collections.abc import Sequence
from typing import Any, Callable

import merge_gate

MARKER = "<!-- rx-merge-gate -->"
PR_FIELDS = (
    "number,state,isDraft,author,headRefName,headRefOid,mergeable,labels,additions,deletions"
)

REDACT_PATTERNS = (
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
)
REDACT_ENV_VARS = ("MERGE_BOT_TOKEN", "GH_TOKEN", "GITHUB_TOKEN")


def sanitize(text: str) -> str:
    """Replace token-looking substrings and known token env values with ``[REDACTED]``."""
    for var in REDACT_ENV_VARS:
        value = os.environ.get(var)
        if value:
            text = text.replace(value, "[REDACTED]")
    for pattern in REDACT_PATTERNS:
        text = pattern.sub("[REDACTED]", text)
    return text


def command_summary(cmd: object) -> str:
    """``gh`` plus at most its first two arguments, never any later ones."""
    if isinstance(cmd, (list, tuple)):
        parts = [str(part) for part in cmd[:3]]
    else:
        parts = str(cmd).split()[:3]
    return " ".join(parts)


def gh(args: list[str], *, token_env: str = "GH_TOKEN") -> str:
    """Execute a GitHub CLI command and return stdout.

    Read-only calls use whatever authentication the environment already gives
    ``gh`` (``GH_TOKEN`` or a stored login). The merge call passes
    ``token_env="MERGE_BOT_TOKEN"``: that variable is then required and is
    handed to ``gh`` as ``GH_TOKEN`` for that one process only, so a merge can
    never fall back to another token. The token value is never printed.
    """
    env = os.environ.copy()
    if token_env != "GH_TOKEN":
        token = os.environ.get(token_env)
        if not token:
            raise ValueError(f"{token_env} environment variable not set")
        env["GH_TOKEN"] = token
        env.pop("GITHUB_TOKEN", None)

    result = subprocess.run(
        ["gh", *args],
        capture_output=True,
        text=True,
        check=True,
        env=env,
    )
    return result.stdout


def flatten_pages(pages: list[Any]) -> list[Any]:
    """Flatten a ``--paginate --slurp`` result (a list of list pages)."""
    flat: list[Any] = []
    for page in pages:
        if isinstance(page, list):
            flat.extend(page)
        else:
            flat.append(page)
    return flat


def flatten_check_runs(pages: list[dict]) -> list[dict]:
    """Collect ``check_runs`` from every page of a slurped check-runs call."""
    runs: list[dict] = []
    for page in pages:
        runs.extend(page.get("check_runs") or [])
    return runs


def normalize_pr(raw: dict) -> dict:
    """Map ``gh pr view --json`` output to the shape ``merge_gate.decide`` expects."""
    return {
        "number": raw["number"],
        "state": raw["state"],
        "is_draft": raw["isDraft"],
        "author_login": raw["author"]["login"],
        "head_ref": raw["headRefName"],
        "head_sha": raw["headRefOid"],
        "mergeable": raw["mergeable"],
        "labels": [
            label["name"] if isinstance(label, dict) else str(label)
            for label in raw.get("labels") or []
        ],
        "additions": raw["additions"],
        "deletions": raw["deletions"],
    }


def normalize_checks(raw_pages: list[dict]) -> list[dict]:
    """Map slurped check-run pages to ``{name, status, conclusion}`` (conclusion may be null)."""
    return [
        {
            "name": check["name"],
            "status": check["status"],
            "conclusion": check.get("conclusion"),
        }
        for check in flatten_check_runs(raw_pages)
    ]


def block_body(reasons: list[str]) -> str:
    """Human-readable body of the single marked gate comment."""
    lines = [MARKER, "Merge gate: BLOCK", ""]
    lines.extend(f"- {reason}" for reason in reasons)
    return "\n".join(lines)


def upsert_comment(gh: Callable[..., str], repo: str, pr_number: int, body: str) -> None:
    """Create the one marked comment on the PR, or PATCH it if it exists."""
    pages = json.loads(
        gh(["api", f"repos/{repo}/issues/{pr_number}/comments", "--paginate", "--slurp"])
    )
    existing = next(
        (c for c in flatten_pages(pages) if MARKER in (c.get("body") or "")),
        None,
    )
    if existing:
        gh(
            [
                "api",
                f"repos/{repo}/issues/comments/{existing['id']}",
                "--method",
                "PATCH",
                "--field",
                f"body={body}",
            ]
        )
    else:
        gh(["api", f"repos/{repo}/issues/{pr_number}/comments", "--field", f"body={body}"])


def run(
    pr_number: int,
    *,
    expected_sha: str,
    actors: str,
    gh: Callable[..., str],
    has_merge_token: bool,
) -> dict[str, Any]:
    """Gather PR data, decide, and act. ``wait`` performs no writes."""
    repo = os.environ["GH_REPO"]

    pr = normalize_pr(json.loads(gh(["pr", "view", str(pr_number), "--json", PR_FIELDS])))
    files_pages = json.loads(
        gh(["api", f"repos/{repo}/pulls/{pr_number}/files", "--paginate", "--slurp"])
    )
    files = [f["filename"] for f in flatten_pages(files_pages)]
    checks = normalize_checks(
        json.loads(
            gh(
                [
                    "api",
                    f"repos/{repo}/commits/{pr['head_sha']}/check-runs",
                    "--paginate",
                    "--slurp",
                ]
            )
        )
    )

    # Manual dispatch has no run SHA; judge the current head.
    if not expected_sha:
        expected_sha = pr["head_sha"]

    decision = merge_gate.decide(
        pr,
        checks,
        files,
        expected_sha=expected_sha,
        allowed_actors=[a.strip() for a in actors.split(",") if a.strip()],
    )

    if decision["action"] == "block":
        upsert_comment(gh, repo, pr_number, block_body(decision["reasons"]))
    elif decision["action"] == "merge":
        if has_merge_token:
            gh(
                ["pr", "merge", str(pr_number), "--squash", "--match-head-commit", pr["head_sha"]],
                token_env="MERGE_BOT_TOKEN",
            )
            decision["merged"] = True
        else:
            body = f"{MARKER}\nMerge gate: MERGE, but MERGE_BOT_TOKEN is not set; not merged."
            upsert_comment(gh, repo, pr_number, body)
    return decision


def main(argv: Sequence[str] | None = None) -> int:
    """Entry point. Exit 1 on any failure so a broken gate is visible."""
    del argv
    pr_number = os.environ.get("PR_NUMBER") or os.environ.get("INPUT_PR_NUMBER")
    if not pr_number:
        print("no PR number (workflow_run without a pull request); nothing to do")
        return 0

    try:
        decision = run(
            int(pr_number),
            expected_sha=os.environ.get("EXPECTED_SHA", ""),
            actors=os.environ.get("ALLOWED") or "mahan-films",
            gh=gh,
            has_merge_token=bool(os.environ.get("MERGE_BOT_TOKEN")),
        )
    except subprocess.CalledProcessError as exc:
        # Show enough to diagnose the failure, but never a token.
        stderr = (exc.stderr or "").strip()
        first_line = stderr.splitlines()[0] if stderr else ""
        lines = [
            f"error: gh failed (exit {exc.returncode}) while running: "
            f"{sanitize(command_summary(exc.cmd))}",
            f"gh said: {sanitize(first_line)[:300]}",
        ]
        for line in lines:
            print(line)
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as handle:
                handle.write("\n".join(lines) + "\n")
        return 1
    except (ValueError, KeyError, OSError) as exc:
        print(f"error: {type(exc).__name__}")
        return 1

    print(json.dumps(decision))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(f"Merge gate: {decision['action']}\n")
            handle.writelines(f"- {reason}\n" for reason in decision["reasons"])

    if decision["action"] == "merge" and not decision.get("merged"):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
