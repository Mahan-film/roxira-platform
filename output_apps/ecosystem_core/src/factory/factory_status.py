#!/usr/bin/env python3
"""Project Factory stage 6 (status): reply to `/status` on a parent issue in
Persian with progress, open PRs, and spend so far.

Run only from `.github/workflows/factory-status.yml`, triggered by
`issue_comment: created` whose body is `/status` (parsed by the pure
`src.factory_pipeline.commands.is_status_command`), from an allowlisted
actor. Reads `projects/<slug>/plan.json` (written by factory_plan.py) from
the checked-out `main` for the task list, asks GitHub for each child issue's
state (and any linked PR), and reads OpenRouter spend via `GET
/api/v1/key` (reusing `agent_runner.openrouter_key_usage`, the same helper
W10's agent_runner.py uses).

CLI:
    python3 factory_status.py --plan projects/voice-app/plan.json --issue 1

Env:
    GITHUB_TOKEN            Required.
    GITHUB_REPO             Default: Mahan-film/roxira-platform.
    OPENROUTER_API_KEY      Optional. If set, its total usage is reported as
                            "spent so far" (best-effort; the OpenRouter key
                            usage is account-wide, not scoped to this project).
    AGENT_DAILY_BUDGET_USD  Default 2.0. Only used to render "of $X" in the reply.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
from typing import Any

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import agent_runner  # sibling module, see path insert above

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.factory_pipeline.status_report import format_status_comment  # noqa: E402

DISPATCHED_LABEL = "agent-dispatched"
DEFAULT_BUDGET_USD = 2.0


def load_plan(plan_path: pathlib.Path) -> dict[str, Any]:
    return json.loads(plan_path.read_text(encoding="utf-8"))


def get_issue_with_pr(token: str, repo: str, number: int) -> dict[str, Any]:
    """Issue state plus the most recent linked PR URL, if any (best-effort:
    looks at the issue's timeline for a cross-referenced/closing PR)."""
    issue = agent_runner._gh_request(
        "GET", f"https://api.github.com/repos/{repo}/issues/{number}", token
    )
    pr_url = None
    try:
        timeline = agent_runner._gh_request(
            "GET",
            f"https://api.github.com/repos/{repo}/issues/{number}/timeline?per_page=100",
            token,
        )
        for event in reversed(timeline):
            if event.get("event") != "cross-referenced":
                continue
            source = event.get("source", {}).get("issue")
            if source and "pull_request" in source:
                pr_url = source.get("html_url") or source.get("pull_request", {}).get("html_url")
                break
    except agent_runner.GitHubError:
        pass
    return {
        "state": issue.get("state", "open"),
        "labels": [lb.get("name") for lb in issue.get("labels", [])],
        "pr_url": pr_url,
    }


def build_status(
    *, plan: dict[str, Any], token: str, repo: str, openrouter_key: str, budget_usd: float
) -> str:
    tasks_report: list[dict[str, Any]] = []
    open_prs: list[str] = []
    for task in plan["tasks"]:
        info = get_issue_with_pr(token, repo, task["issue"])
        if info["state"] == "closed":
            status = "done"
        elif DISPATCHED_LABEL in info["labels"]:
            status = "in_progress"
        else:
            status = "open"
        if info["pr_url"] and status != "done":
            open_prs.append(info["pr_url"])
        tasks_report.append(
            {
                "title": task["title"],
                "issue": task["issue"],
                "status": status,
                "pr_url": info["pr_url"],
            }
        )

    spend_usd = agent_runner.openrouter_key_usage(openrouter_key) if openrouter_key else None
    return format_status_comment(
        idea=plan["idea"],
        tasks=tasks_report,
        spend_usd=spend_usd,
        budget_usd=budget_usd if spend_usd is not None else None,
        open_prs=open_prs,
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Project Factory stage 6: /status reply")
    ap.add_argument("--plan", type=pathlib.Path, required=True)
    ap.add_argument("--issue", type=int, required=True)
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPO", agent_runner.DEFAULT_REPO))
    args = ap.parse_args(argv)

    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        print("GITHUB_TOKEN is not set; cannot answer /status.")
        return 1

    if not args.plan.exists():
        agent_runner.comment_on_issue(
            token,
            args.repo,
            args.issue,
            "برنامه ساختی برای این پروژه یافت نشد (هنوز مرحله برنامه‌ریزی اجرا نشده است).",
        )
        return 0

    plan = load_plan(args.plan)
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    try:
        budget_usd = float(os.environ.get("AGENT_DAILY_BUDGET_USD", str(DEFAULT_BUDGET_USD)))
    except ValueError:
        budget_usd = DEFAULT_BUDGET_USD

    reply = build_status(
        plan=plan, token=token, repo=args.repo, openrouter_key=openrouter_key, budget_usd=budget_usd
    )
    agent_runner.comment_on_issue(token, args.repo, args.issue, reply)
    print(json.dumps({"status": "posted", "issue": args.issue}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
