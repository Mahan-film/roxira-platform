"""Unit tests for output_apps/ecosystem_core/src/factory/factory_plan.py
(Project Factory stage 4: approved brief+option -> <=15 task issues + PLAN.md PR).

Pure helpers (find_latest_proposal_comment, build_planner_prompt,
existing_project_slugs) are tested directly. run_plan()'s orchestration is
tested with every GitHub/LLM/git call mocked, the same style
src/factory/test_agent_runner.py uses for agent_runner.process_one_issue --
no real subprocess, no real network call.

Loaded by file path (not `import factory_plan`) because this module lives
under output_apps/, outside pytest's `testpaths = ["src"]`, and
src/test_ci_quarantine_guard.py forbids import-time side effects in any
src/test_*.py.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

factory_plan = None


@pytest.fixture(scope="session", autouse=True)
def _load_module():
    global factory_plan
    if factory_plan is None:
        module_path = (
            Path(__file__).resolve().parents[2]
            / "output_apps"
            / "ecosystem_core"
            / "src"
            / "factory"
            / "factory_plan.py"
        )
        spec = importlib.util.spec_from_file_location("factory_plan", module_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["factory_plan"] = module
        spec.loader.exec_module(module)
        factory_plan = module
    return factory_plan


def _valid_plan_json(n=2):
    tasks = [
        {
            "title": f"Task {i}",
            "body_en": f"Do thing {i}.",
            "summary_fa": f"خلاصه {i}",
            "depends_on": [i - 1] if i > 0 else [],
            "est_lines": 50,
        }
        for i in range(n)
    ]
    return json.dumps({"tasks": tasks})


# ---------------------------------------------------------------------------
# find_latest_proposal_comment
# ---------------------------------------------------------------------------


def test_find_latest_proposal_comment_returns_most_recent():
    marker = factory_plan.PROPOSAL_MARKER
    comments = [
        {"body": f"{marker}\nold proposal"},
        {"body": "unrelated chatter"},
        {"body": f"{marker}\nnew proposal"},
    ]
    found = factory_plan.find_latest_proposal_comment(comments)
    assert found["body"] == f"{marker}\nnew proposal"


def test_find_latest_proposal_comment_none_when_missing():
    assert factory_plan.find_latest_proposal_comment([{"body": "hi"}]) is None


def test_find_latest_proposal_comment_empty_list():
    assert factory_plan.find_latest_proposal_comment([]) is None


# ---------------------------------------------------------------------------
# build_planner_prompt
# ---------------------------------------------------------------------------


def test_build_planner_prompt_includes_chosen_option():
    prompt = factory_plan.build_planner_prompt(
        "Voice App", "brief body", "proposal body", "Option B", ""
    )
    assert "Option B" in prompt
    assert "Voice App" in prompt
    assert "brief body" in prompt
    assert "proposal body" in prompt


def test_build_planner_prompt_default_option_language_when_none():
    prompt = factory_plan.build_planner_prompt("Voice App", "b", "p", None, "")
    assert "recommended option" in prompt.lower()


def test_build_planner_prompt_includes_agents_md():
    prompt = factory_plan.build_planner_prompt("Voice App", "b", "p", None, "## Rules\nDo X.")
    assert "## Rules" in prompt


# ---------------------------------------------------------------------------
# existing_project_slugs
# ---------------------------------------------------------------------------


def test_existing_project_slugs_empty_when_no_projects_dir(tmp_path):
    assert factory_plan.existing_project_slugs(tmp_path) == set()


def test_existing_project_slugs_lists_directories(tmp_path):
    (tmp_path / "projects" / "voice-app").mkdir(parents=True)
    (tmp_path / "projects" / "seo-app").mkdir(parents=True)
    (tmp_path / "projects" / "not-a-dir.txt").write_text("x")
    assert factory_plan.existing_project_slugs(tmp_path) == {"voice-app", "seo-app"}


# ---------------------------------------------------------------------------
# run_plan orchestration (all I/O mocked)
# ---------------------------------------------------------------------------


def test_run_plan_no_proposal_comment(tmp_path, monkeypatch):
    monkeypatch.setattr(
        factory_plan, "get_issue", lambda *a, **k: {"title": "Idea", "body": "brief"}
    )
    monkeypatch.setattr(factory_plan, "list_issue_comments", lambda *a, **k: [])
    comments = []
    monkeypatch.setattr(
        factory_plan.agent_runner,
        "comment_on_issue",
        lambda token, repo, number, body: comments.append(body),
    )

    result = factory_plan.run_plan(
        issue_number=1,
        chosen_option=None,
        repo_dir=tmp_path,
        repo="o/r",
        token="tok",
        max_concurrent=2,
    )
    assert result["status"] == "no-proposal"
    assert comments


def test_run_plan_planner_call_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(
        factory_plan, "get_issue", lambda *a, **k: {"title": "Idea", "body": "brief"}
    )
    monkeypatch.setattr(
        factory_plan,
        "list_issue_comments",
        lambda *a, **k: [{"body": f"{factory_plan.PROPOSAL_MARKER}\nproposal"}],
    )
    monkeypatch.setattr(factory_plan.agent_runner, "read_agents_md", lambda *a, **k: "")
    monkeypatch.setattr(
        factory_plan, "call_llm", lambda *a, **k: {"status": "ERROR", "error": "boom"}
    )
    comments = []
    monkeypatch.setattr(
        factory_plan.agent_runner,
        "comment_on_issue",
        lambda token, repo, number, body: comments.append(body),
    )

    result = factory_plan.run_plan(
        issue_number=1,
        chosen_option=None,
        repo_dir=tmp_path,
        repo="o/r",
        token="tok",
        max_concurrent=2,
    )
    assert result["status"] == "planner-failed"
    assert "boom" in comments[0]


def test_run_plan_invalid_plan_json(tmp_path, monkeypatch):
    monkeypatch.setattr(
        factory_plan, "get_issue", lambda *a, **k: {"title": "Idea", "body": "brief"}
    )
    monkeypatch.setattr(
        factory_plan,
        "list_issue_comments",
        lambda *a, **k: [{"body": f"{factory_plan.PROPOSAL_MARKER}\nproposal"}],
    )
    monkeypatch.setattr(factory_plan.agent_runner, "read_agents_md", lambda *a, **k: "")
    monkeypatch.setattr(
        factory_plan, "call_llm", lambda *a, **k: {"status": "SUCCESS", "content": "not json"}
    )
    comments = []
    monkeypatch.setattr(
        factory_plan.agent_runner,
        "comment_on_issue",
        lambda token, repo, number, body: comments.append(body),
    )

    result = factory_plan.run_plan(
        issue_number=1,
        chosen_option=None,
        repo_dir=tmp_path,
        repo="o/r",
        token="tok",
        max_concurrent=2,
    )
    assert result["status"] == "invalid-plan"
    assert comments


def test_run_plan_dry_run_does_no_writes_or_git(tmp_path, monkeypatch):
    monkeypatch.setattr(
        factory_plan, "get_issue", lambda *a, **k: {"title": "Voice App", "body": "brief"}
    )
    monkeypatch.setattr(
        factory_plan,
        "list_issue_comments",
        lambda *a, **k: [{"body": f"{factory_plan.PROPOSAL_MARKER}\nproposal"}],
    )
    monkeypatch.setattr(factory_plan.agent_runner, "read_agents_md", lambda *a, **k: "")
    monkeypatch.setattr(
        factory_plan,
        "call_llm",
        lambda *a, **k: {"status": "SUCCESS", "content": _valid_plan_json(2)},
    )
    called = {"create_branch": False}
    monkeypatch.setattr(
        factory_plan.agent_runner,
        "create_branch_in_place",
        lambda *a, **k: called.__setitem__("create_branch", True),
    )

    result = factory_plan.run_plan(
        issue_number=1,
        chosen_option=None,
        repo_dir=tmp_path,
        repo="o/r",
        token="tok",
        max_concurrent=2,
        dry_run=True,
    )
    assert result["status"] == "dry-run"
    assert result["idea_slug"] == "voice-app"
    assert result["task_count"] == 2
    assert called["create_branch"] is False


def test_run_plan_success_creates_issues_writes_plan_and_dispatches(tmp_path, monkeypatch):
    monkeypatch.setattr(
        factory_plan, "get_issue", lambda *a, **k: {"title": "Voice App", "body": "brief"}
    )
    monkeypatch.setattr(
        factory_plan,
        "list_issue_comments",
        lambda *a, **k: [{"body": f"{factory_plan.PROPOSAL_MARKER}\nproposal"}],
    )
    monkeypatch.setattr(factory_plan.agent_runner, "read_agents_md", lambda *a, **k: "")
    monkeypatch.setattr(
        factory_plan,
        "call_llm",
        lambda *a, **k: {"status": "SUCCESS", "content": _valid_plan_json(3)},
    )

    worktree = tmp_path / "wt"
    worktree.mkdir()
    monkeypatch.setattr(
        factory_plan.agent_runner, "create_branch_in_place", lambda *a, **k: worktree
    )
    monkeypatch.setattr(factory_plan.agent_runner, "run_cmd", lambda *a, **k: None)

    created_issue_numbers = iter([101, 102, 103])
    created_calls = []

    def fake_create_issue(token, repo, title, body, labels):
        n = next(created_issue_numbers)
        created_calls.append({"number": n, "title": title, "body": body, "labels": labels})
        return {"number": n}

    monkeypatch.setattr(factory_plan, "create_issue", fake_create_issue)

    pushed = []
    monkeypatch.setattr(
        factory_plan, "push_plan_branch", lambda wt, branch, token, repo: pushed.append(branch)
    )
    monkeypatch.setattr(
        factory_plan.agent_runner,
        "create_pull_request",
        lambda *a, **k: {"html_url": "https://github.com/o/r/pull/9"},
    )
    comments = []
    monkeypatch.setattr(
        factory_plan.agent_runner,
        "comment_on_issue",
        lambda token, repo, number, body: comments.append((number, body)),
    )
    labels_added = []
    monkeypatch.setattr(
        factory_plan.agent_runner,
        "add_labels",
        lambda token, repo, number, labs: labels_added.append((number, labs)),
    )
    dispatched = []
    monkeypatch.setattr(
        factory_plan,
        "dispatch_workflow",
        lambda token, repo, workflow, ref, inputs: dispatched.append(inputs),
    )

    result = factory_plan.run_plan(
        issue_number=1,
        chosen_option="NestJS + Postgres",
        repo_dir=tmp_path,
        repo="o/r",
        token="tok",
        max_concurrent=2,
    )

    assert result["status"] == "plan-ready"
    assert result["pr_url"] == "https://github.com/o/r/pull/9"
    assert result["task_count"] == 3
    # 3 tasks, chained 0<-1<-2: only task 0 is ready at first, so exactly one dispatch.
    assert result["dispatched"] == [101]
    assert len(created_calls) == 3
    # dependency-ordered creation: task 0's issue exists before task 1's body is built.
    assert "Blocked by: #101." in created_calls[1]["body"]
    assert "Blocked by: #102." in created_calls[2]["body"]
    plan_dir = tmp_path / "wt" / "projects" / "voice-app"
    assert plan_dir.exists()
    assert (plan_dir / "PLAN.md").exists()
    plan_json = json.loads((plan_dir / "plan.json").read_text(encoding="utf-8"))
    assert plan_json["option"] == "NestJS + Postgres"
    assert len(plan_json["tasks"]) == 3
    assert pushed == ["factory-plan/1-voice-app"]
    assert dispatched == [{"issue_number": "101"}]
    assert (1, ["plan-ready"]) in labels_added
    assert (101, ["agent-dispatched"]) in labels_added
    assert any(n == 1 for n, _ in comments)


def test_run_plan_all_tasks_independent_dispatches_up_to_max_concurrent(tmp_path, monkeypatch):
    monkeypatch.setattr(
        factory_plan, "get_issue", lambda *a, **k: {"title": "Voice App", "body": "brief"}
    )
    monkeypatch.setattr(
        factory_plan,
        "list_issue_comments",
        lambda *a, **k: [{"body": f"{factory_plan.PROPOSAL_MARKER}\nproposal"}],
    )
    monkeypatch.setattr(factory_plan.agent_runner, "read_agents_md", lambda *a, **k: "")
    independent_plan = json.dumps(
        {
            "tasks": [
                {
                    "title": f"T{i}",
                    "body_en": "b",
                    "summary_fa": "f",
                    "depends_on": [],
                    "est_lines": 10,
                }
                for i in range(3)
            ]
        }
    )
    monkeypatch.setattr(
        factory_plan, "call_llm", lambda *a, **k: {"status": "SUCCESS", "content": independent_plan}
    )
    worktree = tmp_path / "wt"
    worktree.mkdir()
    monkeypatch.setattr(
        factory_plan.agent_runner, "create_branch_in_place", lambda *a, **k: worktree
    )
    monkeypatch.setattr(factory_plan.agent_runner, "run_cmd", lambda *a, **k: None)

    numbers = iter([201, 202, 203])
    monkeypatch.setattr(
        factory_plan, "create_issue", lambda *a, **k: {"number": next(numbers)}
    )
    monkeypatch.setattr(factory_plan, "push_plan_branch", lambda *a, **k: None)
    monkeypatch.setattr(
        factory_plan.agent_runner, "create_pull_request", lambda *a, **k: {"html_url": "https://x/pr/1"}
    )
    monkeypatch.setattr(factory_plan.agent_runner, "comment_on_issue", lambda *a, **k: None)
    monkeypatch.setattr(factory_plan.agent_runner, "add_labels", lambda *a, **k: None)
    dispatched = []
    monkeypatch.setattr(
        factory_plan,
        "dispatch_workflow",
        lambda token, repo, wf, ref, inputs: dispatched.append(inputs),
    )

    result = factory_plan.run_plan(
        issue_number=1,
        chosen_option=None,
        repo_dir=tmp_path,
        repo="o/r",
        token="tok",
        max_concurrent=2,
    )
    assert result["status"] == "plan-ready"
    # 3 independent tasks, max_concurrent=2 -> only the first 2 dispatched.
    assert len(dispatched) == 2
    assert result["dispatched"] == [201, 202]
