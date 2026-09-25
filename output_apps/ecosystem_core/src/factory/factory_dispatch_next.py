#!/usr/bin/env python3
"""Project Factory stage 5 (build): when an agent PR for one task merges,
dispatch the next ready task(s).

Run only from `.github/workflows/factory-build.yml`, triggered by
`pull_request: types: [closed]` on branches matching `agent/**`, gated on
`github.event.pull_request.merged == true`. Reads `projects/<slug>/plan.json`
(written by factory_plan.py, stage 4) from the checked-out `main`, checks
every child issue's current state via the GitHub REST API, computes which
tasks are now unblocked (`src.factory_pipeline.plan_parsing.ready_tasks`),
and dispatches `.github/workflows/agent-task.yml` via `workflow_dispatch` for
as many as the concurrency budget allows -- explicit dispatch, not a label
add, because GITHUB_TOKEN-authored events (including this script's own label
adds) never trigger other workflows (docs/AGENTS_WORKFORCE.md #6).

"Done" = the child issue is closed. "In progress" = the child issue carries
the `agent-dispatched` label (added here, and by factory_plan.py for the
first wave) and is still open. Also updates the Persian progress checklist
comment on the parent issue (edits the existing one -- found by a hidden
marker -- instead of posting a new comment every time, same
create-or-update pattern `.github/workflows/ci.yml` uses for its ruff count).

CLI:
    python3 factory_dispatch_next.py --plan projects/voice-app/plan.json --merged-issue 101

Env:
    GITHUB_TOKEN            Required. issues:write, actions:write.
    GITHUB_REPO             Default: Mahan-film/roxira-platform.
    AGENT_MAX_CONCURRENT    Default 2.
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

from src.factory_pipeline.plan_parsing import PlanTask, ready_tasks  # noqa: E402
from src.factory_pipeline.status_report import format_progress_checklist  # noqa: E402

AGENT_TASK_WORKFLOW = "agent-task.yml"
DISPATCHED_LABEL = "agent-dispatched"
CHECKLIST_MARKER = "<!-- roxira-factory-checklist -->"
DEFAULT_MAX_CONCURRENT = 2


def load_plan(plan_path: pathlib.Path) -> dict[str, Any]:
    return json.loads(plan_path.read_text(encoding="utf-8"))


def plan_tasks(plan: dict[str, Any]) -> list[PlanTask]:
    return [
        PlanTask(
            index=t["index"],
            title=t["title"],
            body_en="",
            summary_fa="",
            depends_on=tuple(t.get("depends_on", [])),
        )
        for t in plan["tasks"]
    ]


def get_issue_state(token: str, repo: str, number: int) -> dict[str, Any]:
    url = f"https://api.github.com/repos/{repo}/issues/{number}"
    return agent_runner._gh_request("GET", url, token)


def dispatch_workflow(
    token: str, repo: str, workflow_file: str, ref: str, inputs: dict[str, str]
) -> None:
    url = f"https://api.github.com/repos/{repo}/actions/workflows/{workflow_file}/dispatches"
    agent_runner._gh_request("POST", url, token, {"ref": ref, "inputs": inputs})


def find_checklist_comment(comments: list[dict[str, Any]]) -> dict[str, Any] | None:
    for comment in reversed(comments):
        if (comment.get("body") or "").startswith(CHECKLIST_MARKER):
            return comment
    return None


def update_issue_comment(token: str, repo: str, comment_id: int, body: str) -> None:
    url = f"https://api.github.com/repos/{repo}/issues/comments/{comment_id}"
    agent_runner._gh_request("PATCH", url, token, {"body": body})


def compute_dispatch(
    tasks: list[PlanTask], issue_states: dict[int, dict[str, Any]], max_concurrent: int
) -> tuple[list[PlanTask], set[int], set[int]]:
    """Pure decision: given each task's GitHub issue state, return (to_dispatch,
    done_indices, in_progress_indices). `issue_states[task.index]` is expected
    to look like ``{"state": "open"|"closed", "labels": ["agent", ...]}``."""
    done_indices = {
        t.index for t in tasks if issue_states.get(t.index, {}).get("state") == "closed"
    }
    in_progress_indices = {
        t.index
        for t in tasks
        if t.index not in done_indices
        and DISPATCHED_LABEL in issue_states.get(t.index, {}).get("labels", [])
    }
    ready = ready_tasks(tasks, done_indices, in_progress_indices)
    slots = max(0, max_concurrent - len(in_progress_indices))
    return ready[:slots], done_indices, in_progress_indices


def run_dispatch_next(
    *, plan_path: pathlib.Path, repo: str, token: str, max_concurrent: int
) -> dict[str, Any]:
    plan = load_plan(plan_path)
    tasks = plan_tasks(plan)
    issue_by_index = {t["index"]: t["issue"] for t in plan["tasks"]}

    issue_states: dict[int, dict[str, Any]] = {}
    for task in tasks:
        issue_number = issue_by_index[task.index]
        issue = get_issue_state(token, repo, issue_number)
        issue_states[task.index] = {
            "state": issue.get("state", "open"),
            "labels": [lb.get("name") for lb in issue.get("labels", [])],
        }

    to_dispatch, done_indices, in_progress_indices = compute_dispatch(
        tasks, issue_states, max_concurrent
    )

    dispatched: list[int] = []
    for task in to_dispatch:
        child_issue = issue_by_index[task.index]
        dispatch_workflow(
            token, repo, AGENT_TASK_WORKFLOW, "main", {"issue_number": str(child_issue)}
        )
        agent_runner.add_labels(token, repo, child_issue, [DISPATCHED_LABEL])
        dispatched.append(child_issue)

    checklist_tasks = []
    for task in tasks:
        if task.index in done_indices:
            status = "done"
        elif task.index in in_progress_indices or task.index in {t.index for t in to_dispatch}:
            status = "in_progress"
        elif all(d in done_indices for d in task.depends_on):
            status = "open"  # ready but waiting for a concurrency slot
        else:
            status = "blocked"
        checklist_tasks.append(
            {"title": task.title, "issue": issue_by_index[task.index], "status": status}
        )

    checklist = CHECKLIST_MARKER + "\n" + format_progress_checklist(plan["idea"], checklist_tasks)
    parent = plan["parent_issue"]
    comments = agent_runner._gh_request(
        "GET", f"https://api.github.com/repos/{repo}/issues/{parent}/comments?per_page=100", token
    )
    existing = find_checklist_comment(comments)
    if existing:
        update_issue_comment(token, repo, existing["id"], checklist)
    else:
        agent_runner.comment_on_issue(token, repo, parent, checklist)

    all_done = len(done_indices) == len(tasks)
    if all_done:
        agent_runner.comment_on_issue(
            token, repo, parent, f"همه {len(tasks)} وظیفه تکمیل شدند. ساخت پروژه به پایان رسید. 🎉"
        )

    return {
        "status": "dispatched" if dispatched else ("complete" if all_done else "waiting"),
        "dispatched": dispatched,
        "done": sorted(done_indices),
        "in_progress": sorted(in_progress_indices),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Project Factory stage 5: dispatch next ready task(s)")
    ap.add_argument(
        "--plan", type=pathlib.Path, required=True, help="Path to projects/<slug>/plan.json"
    )
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPO", agent_runner.DEFAULT_REPO))
    args = ap.parse_args(argv)

    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        print("GITHUB_TOKEN is not set; cannot dispatch the next task.")
        return 1
    try:
        max_concurrent = int(os.environ.get("AGENT_MAX_CONCURRENT", str(DEFAULT_MAX_CONCURRENT)))
    except ValueError:
        max_concurrent = DEFAULT_MAX_CONCURRENT

    if not args.plan.exists():
        print(f"plan file not found: {args.plan} (not a Project Factory task, or predates this PR)")
        return 0

    result = run_dispatch_next(
        plan_path=args.plan, repo=args.repo, token=token, max_concurrent=max_concurrent
    )
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
