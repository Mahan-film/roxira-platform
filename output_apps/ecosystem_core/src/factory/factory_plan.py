#!/usr/bin/env python3
"""Project Factory stage 4 (plan): turn one approved brief + technology option
into <= 15 small, independently testable, dependency-ordered tasks.

Run only from `.github/workflows/factory-plan.yml`, after
`factory_approval_gate.py` has already decided the triggering comment/label
means "go" (see that module and `src/factory_pipeline/commands.py`). Steps:

  1. Read the parent issue (the brief) and its most recent proposal comment
     (marked with `src.factory_pipeline.proposal.PROPOSAL_MARKER`, posted by
     factory_post_proposal.py in stage 2).
  2. Ask a `strong`-tier model, through the existing router
     (`src.automation.llm_router_bridge.call_llm`, same one tech_radar.py and
     project_brief.py use -- never a bespoke client), for a JSON task list.
  3. Validate/parse it (`src.factory_pipeline.plan_parsing`, unit tested with
     canned LLM responses -- this script does not re-test that logic, only
     wires it to real GitHub/LLM calls).
  4. Write `projects/<slug>/PLAN.md` + `plan.json` via a PR (branch
     `factory-plan/<issue>-<slug>`, distinct from W10's `agent/*` branches:
     this PR is produced by the trusted planner, not a cheap sandboxed coding
     agent, so it is not subject to agent_runner's denylist/checks -- but it
     is still a PR, never a direct push to `main`).
  5. Open one child issue per task, labelled `agent`, in dependency order, so
     each later task's body can link the real issue numbers of the tasks it
     depends on.
  6. Post a Persian progress checklist on the parent issue.
  7. Dispatch the first ready task(s) (up to `AGENT_MAX_CONCURRENT`) by
     calling `.github/workflows/agent-task.yml` via `workflow_dispatch` --
     required because GITHUB_TOKEN-authored label/issue events do not
     trigger other workflows (see docs/AGENTS_WORKFORCE.md #6 and
     docs/PROJECT_FACTORY.md). Dispatched issues get the `agent-dispatched`
     label so factory_dispatch_next.py (stage 5) knows not to re-dispatch them.

GitHub REST helpers, git plumbing (`run_cmd`, `create_branch_in_place`,
`create_pull_request`, `comment_on_issue`, `add_labels`, `_gh_request`) and
`AGENTS.md` loading are reused from agent_runner.py (sibling module in this
same directory) rather than duplicated.

CLI:
    python3 factory_plan.py --issue 42                  # accept the recommended option
    python3 factory_plan.py --issue 42 --option "Option B"
    python3 factory_plan.py --issue 42 --dry-run         # plan only, no GitHub/LLM call needed
                                                          # beyond reading the issue+proposal

Env:
    GITHUB_TOKEN            Required (unless --dry-run). issues:write, contents:write,
                             pull-requests:write, actions:write (to dispatch agent-task.yml).
    GITHUB_REPO              Default: Mahan-film/roxira-platform.
    OPENROUTER_API_KEY       A dedicated key for planning/research (OPENROUTER_RESEARCH_KEY
                             in the workflow) -- read by llm_router itself, not by this script.
    AGENT_MAX_CONCURRENT     Default 2. How many of the first ready tasks to dispatch.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
from itertools import combinations
from typing import Any

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import agent_runner  # sibling module, see path insert above

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.automation.llm_router_bridge import call_llm  # noqa: E402
from src.automation.tech_radar import _extract_json  # noqa: E402
from src.factory_pipeline.plan_parsing import (  # noqa: E402
    PlanValidationError,
    PlanTask,
    parse_plan_response,
    ready_tasks,
    render_plan_markdown,
    task_issue_body,
    task_issue_title,
    topological_order,
)
from src.factory_pipeline.proposal import PROPOSAL_MARKER  # noqa: E402
from src.factory_pipeline.slugs import slugify_project, unique_slug  # noqa: E402
from src.factory_pipeline.status_report import format_progress_checklist  # noqa: E402
from src.factory_pipeline.task_contract import (  # noqa: E402
    TaskContract,
    parallel_safe,
    parse_contract,
    paths_overlap,
)

PLANNER_TIER = "strong"
AGENT_LABEL = "agent"
PLAN_READY_LABEL = "plan-ready"
DISPATCHED_LABEL = "agent-dispatched"
AGENT_TASK_WORKFLOW = "agent-task.yml"
DEFAULT_MAX_CONCURRENT = 2

PLANNER_SYSTEM_PROMPT = (
    "You are a precise software project planner. Respond with one JSON object only, "
    "no markdown fences, no commentary."
)


def _issue_url(repo: str, number: int) -> str:
    return f"https://api.github.com/repos/{repo}/issues/{number}"


def get_issue(token: str, repo: str, number: int) -> dict[str, Any]:
    return agent_runner._gh_request("GET", _issue_url(repo, number), token)


def list_issue_comments(token: str, repo: str, number: int) -> list[dict[str, Any]]:
    url = f"{_issue_url(repo, number)}/comments?per_page=100"
    return agent_runner._gh_request("GET", url, token)


def find_latest_proposal_comment(comments: list[dict[str, Any]]) -> dict[str, Any] | None:
    for comment in reversed(comments):
        if (comment.get("body") or "").startswith(PROPOSAL_MARKER):
            return comment
    return None


def build_planner_prompt(
    idea: str,
    brief_body: str,
    proposal_comment_body: str,
    chosen_option: str | None,
    agents_md: str,
) -> str:
    option_line = (
        f"The project owner approved this specific option: {chosen_option}"
        if chosen_option
        else "The project owner approved the recommended option for every layer, unchanged."
    )
    return (
        "You are the ROXIRA Project Factory planner. Split one approved new-project brief "
        "and its accepted technology stack into at most 15 small, independently testable "
        "engineering tasks, each roughly <= 200 lines of change, ordered by dependency "
        "(earlier tasks unblock later ones). Every task must be small enough for a cheap, "
        "sandboxed coding agent to implement alone, in its own branch, without asking "
        "questions.\n\n"
        f"Project idea: {idea}\n\n"
        f"Original brief (may be in Persian):\n{brief_body}\n\n"
        f"Approved technology proposal (Persian):\n{proposal_comment_body}\n\n"
        f"{option_line}\n\n"
        "Repository engineering rules every task must respect:\n"
        f"{agents_md}\n\n"
        "Respond with exactly this JSON shape:\n"
        '{"tasks": [{"title": "short English title", '
        '"body_en": "a precise English description of the change", '
        '"summary_fa": "one-sentence Persian summary for the project owner", '
        '"depends_on": [0-based indices of earlier tasks in this same list that must '
        'land first], "est_lines": approximate integer lines of change, '
        '"contract": {"area": "frontend|backend|database|tests|infra|docs", '
        '"allowed_paths": ["repository-relative/path"], "needs_migration": false, '
        '"test_command": "a focused verification command"}}]}'
    )


def _depends_on(task: PlanTask, dependency_index: int, by_index: dict[int, PlanTask]) -> bool:
    return dependency_index in task.depends_on or any(
        _depends_on(by_index[dependency], dependency_index, by_index)
        for dependency in task.depends_on
    )


def validate_task_contracts(raw_content: str, tasks: list[PlanTask]) -> None:
    """Validate every task contract and reject unsafe concurrent task pairs."""
    raw_plan = _extract_json(raw_content)
    raw_tasks = raw_plan.get("tasks", []) if isinstance(raw_plan, dict) else []
    contracts: dict[int, TaskContract] = {}
    errors: list[str] = []
    for task, raw_task in zip(tasks, raw_tasks):
        try:
            contracts[task.index] = parse_contract(raw_task)
        except PlanValidationError as exc:
            errors.append(f"task {task.index} ({task.title}): {exc}")

    by_index = {task.index: task for task in tasks}
    for left, right in combinations(tasks, 2):
        if _depends_on(left, right.index, by_index) or _depends_on(right, left.index, by_index):
            continue
        left_contract, right_contract = contracts.get(left.index), contracts.get(right.index)
        if left_contract is None or right_contract is None or parallel_safe([left_contract, right_contract]):
            continue
        if paths_overlap(left_contract, right_contract):
            errors.append(
                f"parallel tasks {left.index} ({left.title}) and {right.index} ({right.title}) "
                "have overlapping allowed_paths"
            )
        else:
            errors.append(
                f"parallel tasks {left.index} ({left.title}) and {right.index} ({right.title}) "
                "both require a migration"
            )
    if errors:
        raise PlanValidationError("task contract validation failed: " + "; ".join(errors))


def create_issue(
    token: str, repo: str, title: str, body: str, labels: list[str]
) -> dict[str, Any]:
    url = f"https://api.github.com/repos/{repo}/issues"
    payload = {"title": title, "body": body, "labels": labels}
    return agent_runner._gh_request("POST", url, token, payload)


def dispatch_workflow(
    token: str, repo: str, workflow_file: str, ref: str, inputs: dict[str, str]
) -> None:
    url = f"https://api.github.com/repos/{repo}/actions/workflows/{workflow_file}/dispatches"
    agent_runner._gh_request("POST", url, token, {"ref": ref, "inputs": inputs})


def push_plan_branch(worktree_path: pathlib.Path, branch: str, token: str, repo: str) -> None:
    """Push over HTTPS using the token, never printing it.

    Deliberately not agent_runner.push_branch(): that function asserts the
    branch starts with `agent/` -- a control specific to W10's cheap,
    sandboxed coding agent. This branch (`factory-plan/...`) is produced by
    the trusted planner script, not that agent, so it does not carry that
    prefix or that assertion; it still always ends in a PR, never a push to
    `main`.
    """
    push_url = f"https://x-access-token:{token}@github.com/{repo}.git"
    res = agent_runner.run_cmd(
        ["git", "push", push_url, f"HEAD:refs/heads/{branch}"], cwd=worktree_path, timeout=120
    )
    if res.returncode != 0:
        raise RuntimeError(f"git push failed: {agent_runner._scrub_token(res.stderr, token)}")


def existing_project_slugs(repo_dir: pathlib.Path) -> set[str]:
    projects_dir = repo_dir / "projects"
    if not projects_dir.exists():
        return set()
    return {p.name for p in projects_dir.iterdir() if p.is_dir()}


def run_plan(
    *,
    issue_number: int,
    chosen_option: str | None,
    repo_dir: pathlib.Path,
    repo: str,
    token: str,
    max_concurrent: int,
    dry_run: bool = False,
) -> dict[str, Any]:
    issue = get_issue(token, repo, issue_number)
    idea = issue.get("title", "").strip()
    brief_body = issue.get("body") or ""

    comments = list_issue_comments(token, repo, issue_number)
    proposal = find_latest_proposal_comment(comments)
    if proposal is None:
        agent_runner.comment_on_issue(
            token,
            repo,
            issue_number,
            "پیشنهاد فناوری برای این ایشو یافت نشد. ابتدا باید تحقیق فناوری "
            "(لیبل `brief` یا اجرای دستی `factory-research.yml`) کامل شود.",
        )
        return {"status": "no-proposal"}

    agents_md = agent_runner.read_agents_md(repo_dir)
    proposal_body = proposal.get("body", "")
    prompt = build_planner_prompt(idea, brief_body, proposal_body, chosen_option, agents_md)

    response = call_llm(
        PLANNER_TIER,
        prompt,
        PLANNER_SYSTEM_PROMPT,
        temperature=0.2,
        max_tokens=4000,
        json_mode=True,
        feature="factory_plan",
    )
    if response.get("status") != "SUCCESS":
        agent_runner.comment_on_issue(
            token,
            repo,
            issue_number,
            f"فراخوانی مدل برنامه‌ریز شکست خورد؛ هیچ وظیفه‌ای ساخته نشد: {response.get('error')}",
        )
        return {"status": "planner-failed", "error": response.get("error")}

    try:
        tasks = parse_plan_response(response.get("content", ""))
        validate_task_contracts(response.get("content", ""), tasks)
    except PlanValidationError as exc:
        agent_runner.comment_on_issue(
            token,
            repo,
            issue_number,
            f"خروجی برنامه‌ریز نامعتبر بود؛ هیچ وظیفه‌ای ساخته نشد: {exc}",
        )
        return {"status": "invalid-plan", "error": str(exc)}

    option_label = chosen_option or "گزینه توصیه‌شده در هر لایه (پیش‌فرض)"
    idea_slug = unique_slug(slugify_project(idea), existing_project_slugs(repo_dir))
    branch = f"factory-plan/{issue_number}-{idea_slug}"

    if dry_run:
        return {
            "status": "dry-run",
            "idea_slug": idea_slug,
            "branch": branch,
            "task_count": len(tasks),
        }

    worktree_path = agent_runner.create_branch_in_place(repo_dir, branch)

    plan_dir = worktree_path / "projects" / idea_slug
    plan_dir.mkdir(parents=True, exist_ok=True)
    plan_md = render_plan_markdown(idea, option_label, tasks)
    (plan_dir / "PLAN.md").write_text(plan_md, encoding="utf-8")

    order = topological_order(tasks)
    by_index = {t.index: t for t in tasks}
    dep_issue_numbers: dict[int, int] = {}
    created_tasks: list[dict[str, Any]] = []
    for i in order:
        task = by_index[i]
        title = task_issue_title(idea_slug, task)
        body = task_issue_body(task, issue_number, dep_issue_numbers)
        child = create_issue(token, repo, title, body, [AGENT_LABEL])
        dep_issue_numbers[task.index] = child["number"]
        created_tasks.append(
            {
                "index": task.index,
                "issue": child["number"],
                "title": task.title,
                "depends_on": list(task.depends_on),
            }
        )

    plan_json = {
        "idea": idea,
        "slug": idea_slug,
        "parent_issue": issue_number,
        "option": option_label,
        "tasks": created_tasks,
    }
    (plan_dir / "plan.json").write_text(
        json.dumps(plan_json, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    agent_runner.run_cmd(["git", "add", "-A"], cwd=worktree_path, timeout=30)
    agent_runner.run_cmd(
        ["git", "commit", "-m", f"factory: plan for {idea} (#{issue_number})"],
        cwd=worktree_path,
        timeout=30,
    )
    push_plan_branch(worktree_path, branch, token, repo)
    pr = agent_runner.create_pull_request(
        token,
        repo,
        title=f"Project plan: {idea} (#{issue_number})",
        head=branch,
        base="main",
        body=(
            f"Plan for #{issue_number}. Approved option: {option_label}.\n\n"
            f"{len(created_tasks)} task(s) opened as child issues (label `{AGENT_LABEL}`).\n\n"
            "---\nOpened automatically by factory_plan.py. Review before merging."
        ),
    )

    checklist_tasks = [
        {"title": t["title"], "issue": t["issue"], "status": "open", "pr_url": None}
        for t in created_tasks
    ]
    summary = (
        f"برنامه ساخت آماده شد: {len(created_tasks)} وظیفه ایجاد شد.\n"
        f"PR برنامه: {pr.get('html_url', '')}\n\n"
        + format_progress_checklist(idea, checklist_tasks)
    )
    agent_runner.comment_on_issue(token, repo, issue_number, summary)
    agent_runner.add_labels(token, repo, issue_number, [PLAN_READY_LABEL])

    dispatched: list[int] = []
    first_wave = ready_tasks(tasks, done_indices=set(), in_progress_indices=set())[:max_concurrent]
    for task in first_wave:
        child_issue = dep_issue_numbers[task.index]
        dispatch_workflow(
            token, repo, AGENT_TASK_WORKFLOW, "main", {"issue_number": str(child_issue)}
        )
        agent_runner.add_labels(token, repo, child_issue, [DISPATCHED_LABEL])
        dispatched.append(child_issue)

    return {
        "status": "plan-ready",
        "pr_url": pr.get("html_url", ""),
        "task_count": len(created_tasks),
        "dispatched": dispatched,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Project Factory stage 4: plan and open task issues")
    ap.add_argument("--issue", type=int, required=True)
    ap.add_argument("--option", default="", help="Chosen option name; empty = accept recommended")
    ap.add_argument(
        "--repo-dir", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[4]
    )
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    repo = os.environ.get("GITHUB_REPO", agent_runner.DEFAULT_REPO).strip()
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    try:
        max_concurrent = int(os.environ.get("AGENT_MAX_CONCURRENT", str(DEFAULT_MAX_CONCURRENT)))
    except ValueError:
        max_concurrent = DEFAULT_MAX_CONCURRENT

    if not token:
        print("GITHUB_TOKEN is not set; cannot read the issue or plan for real.")
        return 1

    result = run_plan(
        issue_number=args.issue,
        chosen_option=args.option or None,
        repo_dir=args.repo_dir,
        repo=repo,
        token=token,
        max_concurrent=max_concurrent,
        dry_run=args.dry_run,
    )
    print(json.dumps(result, indent=2, default=str))
    # "no-proposal"/"planner-failed"/"invalid-plan" are all reported to the owner via a
    # GitHub comment already, but the job itself should still surface red in the Actions
    # tab -- same convention as agent-task.yml's final step for agent_runner.py.
    ok_statuses = {"plan-ready", "dry-run"}
    return 0 if result.get("status") in ok_statuses else 1


if __name__ == "__main__":
    raise SystemExit(main())
