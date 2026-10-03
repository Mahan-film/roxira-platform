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
            "contract": {
                "area": "backend",
                "allowed_paths": [f"src/component_{i}.py"],
                "needs_migration": False,
                "test_command": "python3 -m pytest src/factory/test_factory_plan.py -q",
            },
        }
        for i in range(n)
    ]
    return json.dumps({"tasks": tasks})


def _stub_planner_response(monkeypatch, content):
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
        factory_plan, "call_llm", lambda *a, **k: {"status": "SUCCESS", "content": content}
    )


def _stub_non_dry_plan(monkeypatch, tmp_path, plan_content, max_concurrent=2, comments=None):
    """Run run_plan() end-to-end with every GitHub/LLM/git call mocked."""
    _stub_planner_response(monkeypatch, plan_content)
    worktree = tmp_path / "wt"
    worktree.mkdir()
    monkeypatch.setattr(
        factory_plan.agent_runner, "create_branch_in_place", lambda *a, **k: worktree
    )
    monkeypatch.setattr(factory_plan.agent_runner, "run_cmd", lambda *a, **k: None)
    numbers = iter(range(101, 200))
    monkeypatch.setattr(
        factory_plan, "create_issue", lambda *a, **k: {"number": next(numbers)}
    )
    monkeypatch.setattr(factory_plan, "push_plan_branch", lambda *a, **k: None)
    monkeypatch.setattr(
        factory_plan.agent_runner,
        "create_pull_request",
        lambda *a, **k: {"html_url": "https://x/pr/1"},
    )
    monkeypatch.setattr(
        factory_plan.agent_runner,
        "comment_on_issue",
        lambda *a, **k: comments.append(a[-1]) if comments is not None else None,
    )
    monkeypatch.setattr(factory_plan.agent_runner, "add_labels", lambda *a, **k: None)
    monkeypatch.setattr(factory_plan, "dispatch_workflow", lambda *a, **k: None)
    result = factory_plan.run_plan(
        issue_number=1,
        chosen_option=None,
        repo_dir=tmp_path,
        repo="o/r",
        token="tok",
        max_concurrent=max_concurrent,
    )
    return result, worktree


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


def test_run_plan_valid_contracts_passes_dry_run(tmp_path, monkeypatch):
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


def test_run_plan_missing_contract_fails_without_creating_issues(tmp_path, monkeypatch):
    plan = json.loads(_valid_plan_json(1))
    plan["tasks"][0].pop("contract")
    _stub_planner_response(monkeypatch, json.dumps(plan))
    comments, created = [], []
    monkeypatch.setattr(
        factory_plan.agent_runner,
        "comment_on_issue",
        lambda *a: comments.append(a[-1]),
    )
    monkeypatch.setattr(factory_plan, "create_issue", lambda *a: created.append(a))

    result = factory_plan.run_plan(
        issue_number=1, chosen_option=None, repo_dir=tmp_path, repo="o/r", token="tok", max_concurrent=2
    )

    assert result["status"] == "invalid-plan"
    assert "task contract is required" in result["error"]
    assert created == []
    assert comments


def _overlapping_parallel_plan(n=3):
    plan = json.loads(_valid_plan_json(n))
    for task in plan["tasks"]:
        task["depends_on"] = []
        task["contract"]["allowed_paths"] = ["app/"]
    return plan


def test_run_plan_serializes_overlapping_parallel_task_contracts(tmp_path, monkeypatch):
    plan = _overlapping_parallel_plan(3)
    _stub_planner_response(monkeypatch, json.dumps(plan))
    monkeypatch.setattr(factory_plan.agent_runner, "comment_on_issue", lambda *a: None)

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
    assert result["serialized_pairs"] == [(1, 0), (2, 0), (2, 1)]


def test_validate_task_contracts_chains_overlapping_tasks():
    content = json.dumps(_overlapping_parallel_plan(3))
    tasks = factory_plan.parse_plan_response(content)

    _, new_tasks, pairs = factory_plan.validate_task_contracts(content, tasks)

    assert pairs
    assert factory_plan.topological_order(new_tasks) == [0, 1, 2]
    assert 0 in new_tasks[1].depends_on
    assert 1 in new_tasks[2].depends_on


def test_validate_task_contracts_does_not_chain_independent_tasks():
    plan = json.loads(_valid_plan_json(3))
    for task in plan["tasks"]:
        task["depends_on"] = []
    content = json.dumps(plan)
    tasks = factory_plan.parse_plan_response(content)

    _, new_tasks, pairs = factory_plan.validate_task_contracts(content, tasks)

    assert pairs == []
    assert all(task.depends_on == () for task in new_tasks)


def test_validate_task_contracts_serializes_two_migrations():
    plan = json.loads(_valid_plan_json(2))
    for task in plan["tasks"]:
        task["depends_on"] = []
        task["contract"]["needs_migration"] = True
    content = json.dumps(plan)
    tasks = factory_plan.parse_plan_response(content)

    _, new_tasks, pairs = factory_plan.validate_task_contracts(content, tasks)

    assert pairs == [(1, 0)]
    assert new_tasks[1].depends_on == (0,)


def test_validate_task_contracts_keeps_error_when_edge_would_create_cycle(monkeypatch):
    content = json.dumps(_overlapping_parallel_plan(2))
    tasks = factory_plan.parse_plan_response(content)
    monkeypatch.setattr(factory_plan, "_would_create_cycle", lambda *a: True)

    with pytest.raises(factory_plan.PlanValidationError) as exc:
        factory_plan.validate_task_contracts(content, tasks)

    assert "Task 0" in str(exc.value) and "Task 1" in str(exc.value)
    assert "overlapping allowed_paths" in str(exc.value)


def test_run_plan_invalid_contract_still_rejected_alongside_overlap(tmp_path, monkeypatch):
    plan = _overlapping_parallel_plan(2)
    plan["tasks"][1]["contract"]["area"] = "nonsense"
    _stub_planner_response(monkeypatch, json.dumps(plan))
    monkeypatch.setattr(factory_plan.agent_runner, "comment_on_issue", lambda *a: None)

    result = factory_plan.run_plan(
        issue_number=1, chosen_option=None, repo_dir=tmp_path, repo="o/r", token="tok", max_concurrent=2
    )

    assert result["status"] == "invalid-plan"
    assert "area is invalid" in result["error"]


def test_run_plan_serialized_plan_md_follows_dependency_order(tmp_path, monkeypatch):
    plan = _overlapping_parallel_plan(3)
    result, worktree = _stub_non_dry_plan(monkeypatch, tmp_path, json.dumps(plan))

    assert result["status"] == "plan-ready"
    assert result["serialized_pairs"] == [(1, 0), (2, 0), (2, 1)]
    assert result["dispatched"] == [101]
    plan_md = (worktree / "projects" / "idea" / "spec" / "plan.md").read_text(encoding="utf-8")
    assert plan_md.index("1. Task 0") < plan_md.index("2. Task 1") < plan_md.index("3. Task 2")
    top_plan = (worktree / "projects" / "idea" / "PLAN.md").read_text(encoding="utf-8")
    assert "task 1: Task 1** (depends on: task 0)" in top_plan


def test_run_plan_plan_md_order_uses_final_dependencies(tmp_path, monkeypatch):
    plan = _overlapping_parallel_plan(3)
    plan["tasks"][0]["depends_on"] = [2]  # 2 must land before 0; task 1 then follows 0
    result, worktree = _stub_non_dry_plan(monkeypatch, tmp_path, json.dumps(plan))

    assert result["status"] == "plan-ready"
    assert result["serialized_pairs"] == [(1, 0)]
    plan_md = (worktree / "projects" / "idea" / "spec" / "plan.md").read_text(encoding="utf-8")
    assert plan_md.index("1. Task 2") < plan_md.index("2. Task 0") < plan_md.index("3. Task 1")


def test_run_plan_summary_mentions_serialized_pairs(tmp_path, monkeypatch):
    comments = []
    result, _ = _stub_non_dry_plan(
        monkeypatch,
        tmp_path,
        json.dumps(_overlapping_parallel_plan(2)),
        comments=comments,
    )

    assert result["serialized_pairs"] == [(1, 0)]
    assert any(
        "برای جلوگیری از تداخل مسیرها، این وظایف پشت‌سرهم اجرا می‌شوند" in body
        for body in comments
    )


def test_run_plan_allows_overlapping_contracts_when_dependent(tmp_path, monkeypatch):
    plan = json.loads(_valid_plan_json(2))
    plan["tasks"][1]["contract"]["allowed_paths"] = ["src/component_0.py"]
    _stub_planner_response(monkeypatch, json.dumps(plan))

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
    independent = json.loads(_valid_plan_json(3))
    for task in independent["tasks"]:
        task["depends_on"] = []
    independent_plan = json.dumps(independent)
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


# ---------------------------------------------------------------------------
# planner tier selection + empty-content retry
# ---------------------------------------------------------------------------


def _stub_issue_and_proposal(monkeypatch):
    monkeypatch.setattr(
        factory_plan, "get_issue", lambda *a, **k: {"title": "Idea", "body": "brief"}
    )
    monkeypatch.setattr(
        factory_plan,
        "list_issue_comments",
        lambda *a, **k: [{"body": f"{factory_plan.PROPOSAL_MARKER}\nproposal"}],
    )
    monkeypatch.setattr(factory_plan.agent_runner, "read_agents_md", lambda *a, **k: "")


def _recording_call_llm(responses):
    calls = []
    remaining = iter(responses)

    def fake(tier, prompt, system_prompt, **kwargs):
        calls.append({"tier": tier, "kwargs": kwargs})
        return next(remaining)

    return fake, calls


def test_planner_tier_defaults_to_cheap(monkeypatch):
    monkeypatch.delenv(factory_plan.FACTORY_PLANNER_TIER_ENV, raising=False)
    assert factory_plan.planner_tier() == "cheap"


def test_planner_tier_reads_valid_env(monkeypatch):
    monkeypatch.setenv(factory_plan.FACTORY_PLANNER_TIER_ENV, "strong")
    assert factory_plan.planner_tier() == "strong"


def test_planner_tier_invalid_env_falls_back_to_cheap(monkeypatch):
    monkeypatch.setenv(factory_plan.FACTORY_PLANNER_TIER_ENV, "expensive")
    assert factory_plan.planner_tier() == "cheap"


def test_run_plan_single_call_when_first_succeeds(tmp_path, monkeypatch):
    monkeypatch.setenv(factory_plan.FACTORY_PLANNER_TIER_ENV, "cheap")
    _stub_issue_and_proposal(monkeypatch)
    fake, calls = _recording_call_llm([{"status": "SUCCESS", "content": _valid_plan_json(1)}])
    monkeypatch.setattr(factory_plan, "call_llm", fake)

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
    assert len(calls) == 1
    assert calls[0]["tier"] == "cheap"
    assert calls[0]["kwargs"]["max_tokens"] == 8000


def test_run_plan_empty_content_retries_once_on_strong(tmp_path, monkeypatch):
    monkeypatch.setenv(factory_plan.FACTORY_PLANNER_TIER_ENV, "cheap")
    _stub_issue_and_proposal(monkeypatch)
    fake, calls = _recording_call_llm(
        [
            {"status": "SUCCESS", "content": "   "},
            {"status": "SUCCESS", "content": _valid_plan_json(1)},
        ]
    )
    monkeypatch.setattr(factory_plan, "call_llm", fake)

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
    assert [c["tier"] for c in calls] == ["cheap", "strong"]
    assert calls[0]["kwargs"]["max_tokens"] == 8000
    assert calls[1]["kwargs"]["max_tokens"] == 16000


def test_run_plan_both_attempts_fail_reports_tiers_without_tasks(tmp_path, monkeypatch):
    monkeypatch.setenv(factory_plan.FACTORY_PLANNER_TIER_ENV, "cheap")
    _stub_issue_and_proposal(monkeypatch)
    fake, calls = _recording_call_llm(
        [
            {"status": "ERROR", "error": "empty completion content"},
            {"status": "SUCCESS", "content": ""},
        ]
    )
    monkeypatch.setattr(factory_plan, "call_llm", fake)
    comments, created = [], []
    monkeypatch.setattr(
        factory_plan.agent_runner,
        "comment_on_issue",
        lambda token, repo, number, body: comments.append(body),
    )
    monkeypatch.setattr(
        factory_plan, "create_issue", lambda *a, **k: (created.append(a), {"number": 1})[1]
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
    assert result["tiers"] == ["cheap", "strong"]
    assert len(calls) == 2
    assert created == []
    assert comments
    assert "cheap" in comments[0] and "strong" in comments[0]


def test_run_plan_env_tier_strong_used_for_first_call(tmp_path, monkeypatch):
    monkeypatch.setenv(factory_plan.FACTORY_PLANNER_TIER_ENV, "strong")
    _stub_issue_and_proposal(monkeypatch)
    fake, calls = _recording_call_llm([{"status": "SUCCESS", "content": _valid_plan_json(1)}])
    monkeypatch.setattr(factory_plan, "call_llm", fake)

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
    assert len(calls) == 1
    assert calls[0]["tier"] == "strong"


# ---------------------------------------------------------------------------
# spec artifacts (report-only)
# ---------------------------------------------------------------------------


def test_run_plan_writes_spec_artifacts_with_task_lines(tmp_path, monkeypatch):
    result, worktree = _stub_non_dry_plan(monkeypatch, tmp_path, _valid_plan_json(3))

    assert result["status"] == "plan-ready"
    spec_dir = worktree / "projects" / "idea" / "spec"
    assert sorted(p.name for p in spec_dir.iterdir()) == [
        "acceptance.md",
        "plan.md",
        "spec.md",
        "tasks.md",
    ]
    tasks_md = (spec_dir / "tasks.md").read_text(encoding="utf-8")
    assert "- Task 0 owned: src/component_0.py" in tasks_md
    assert "- Task 1 owned: src/component_1.py" in tasks_md
    assert "- Task 2 owned: src/component_2.py" in tasks_md
    plan_md = (spec_dir / "plan.md").read_text(encoding="utf-8")
    assert "1. Task 0" in plan_md
    assert "2. Task 1" in plan_md
    assert "3. Task 2" in plan_md
    spec_md = (spec_dir / "spec.md").read_text(encoding="utf-8")
    assert "version:" in spec_md
    assert "proposal" in spec_md
    assert result["spec_warnings"] == []


def test_run_plan_reports_spec_warning_without_failing(tmp_path, monkeypatch):
    original_template = factory_plan.render_template

    def broken_template(slug):
        artifacts = original_template(slug)
        artifacts["acceptance.md"] = "# Acceptance\n"
        return artifacts

    monkeypatch.setattr(factory_plan, "render_template", broken_template)

    result, _ = _stub_non_dry_plan(monkeypatch, tmp_path, _valid_plan_json(1))

    assert result["status"] == "plan-ready"
    assert "acceptance.md has no checklist line" in result["spec_warnings"]
