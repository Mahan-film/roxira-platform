"""Unit tests for output_apps/ecosystem_core/src/factory/factory_dispatch_next.py
(Project Factory stage 5: on an agent PR merge, dispatch the next ready task(s)).

`compute_dispatch()` is pure (no GitHub call) and gets the most thorough
coverage; `run_dispatch_next()`'s GitHub orchestration is tested with every
network call mocked, same style as src/factory/test_agent_runner.py and
src/factory/test_factory_plan.py.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

factory_dispatch_next = None


@pytest.fixture(scope="session", autouse=True)
def _load_module():
    global factory_dispatch_next
    if factory_dispatch_next is None:
        module_path = (
            Path(__file__).resolve().parents[2]
            / "output_apps"
            / "ecosystem_core"
            / "src"
            / "factory"
            / "factory_dispatch_next.py"
        )
        spec = importlib.util.spec_from_file_location("factory_dispatch_next", module_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["factory_dispatch_next"] = module
        spec.loader.exec_module(module)
        factory_dispatch_next = module
    return factory_dispatch_next


def _task(index, depends_on=()):
    return factory_dispatch_next.PlanTask(index, f"Task {index}", "b", "f", tuple(depends_on))


# ---------------------------------------------------------------------------
# compute_dispatch (pure)
# ---------------------------------------------------------------------------


def test_compute_dispatch_all_open_dispatches_up_to_cap():
    tasks = [_task(0), _task(1), _task(2)]
    states = {i: {"state": "open", "labels": []} for i in range(3)}
    to_dispatch, done, in_progress = factory_dispatch_next.compute_dispatch(
        tasks, states, max_concurrent=2
    )
    assert [t.index for t in to_dispatch] == [0, 1]
    assert done == set()
    assert in_progress == set()


def test_compute_dispatch_closed_issue_is_done():
    tasks = [_task(0), _task(1, depends_on=[0])]
    states = {
        0: {"state": "closed", "labels": ["agent", "agent-dispatched"]},
        1: {"state": "open", "labels": []},
    }
    to_dispatch, done, _in_progress = factory_dispatch_next.compute_dispatch(
        tasks, states, max_concurrent=2
    )
    assert done == {0}
    assert [t.index for t in to_dispatch] == [1]


def test_compute_dispatch_dispatched_label_open_is_in_progress_and_not_redispatched():
    tasks = [_task(0), _task(1)]
    states = {
        0: {"state": "open", "labels": ["agent", "agent-dispatched"]},
        1: {"state": "open", "labels": ["agent"]},
    }
    to_dispatch, _done, in_progress = factory_dispatch_next.compute_dispatch(
        tasks, states, max_concurrent=2
    )
    assert in_progress == {0}
    assert [t.index for t in to_dispatch] == [1]


def test_compute_dispatch_respects_remaining_concurrency_slots():
    tasks = [_task(0), _task(1), _task(2)]
    states = {
        0: {"state": "open", "labels": ["agent-dispatched"]},  # already using 1 of 2 slots
        1: {"state": "open", "labels": []},
        2: {"state": "open", "labels": []},
    }
    to_dispatch, _done, in_progress = factory_dispatch_next.compute_dispatch(
        tasks, states, max_concurrent=2
    )
    assert in_progress == {0}
    assert len(to_dispatch) == 1  # only 1 slot left


def test_compute_dispatch_no_slots_left_dispatches_nothing():
    tasks = [_task(0), _task(1)]
    states = {
        0: {"state": "open", "labels": ["agent-dispatched"]},
        1: {"state": "open", "labels": ["agent-dispatched"]},
    }
    to_dispatch, _done, in_progress = factory_dispatch_next.compute_dispatch(
        tasks, states, max_concurrent=2
    )
    assert to_dispatch == []
    assert in_progress == {0, 1}


def test_compute_dispatch_blocked_task_not_ready_until_dependency_done():
    tasks = [_task(0), _task(1, depends_on=[0])]
    states = {0: {"state": "open", "labels": []}, 1: {"state": "open", "labels": []}}
    to_dispatch, _done, _in_progress = factory_dispatch_next.compute_dispatch(
        tasks, states, max_concurrent=2
    )
    assert [t.index for t in to_dispatch] == [0]  # task 1 still blocked


def test_compute_dispatch_all_done():
    tasks = [_task(0)]
    states = {0: {"state": "closed", "labels": []}}
    to_dispatch, done, in_progress = factory_dispatch_next.compute_dispatch(
        tasks, states, max_concurrent=2
    )
    assert to_dispatch == []
    assert done == {0}
    assert in_progress == set()


# ---------------------------------------------------------------------------
# load_plan / plan_tasks
# ---------------------------------------------------------------------------


def test_load_plan_and_plan_tasks_roundtrip(tmp_path):
    plan = {
        "idea": "Voice App",
        "slug": "voice-app",
        "parent_issue": 1,
        "option": "NestJS",
        "tasks": [
            {"index": 0, "issue": 101, "title": "T0", "depends_on": []},
            {"index": 1, "issue": 102, "title": "T1", "depends_on": [0]},
        ],
    }
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(plan), encoding="utf-8")
    loaded = factory_dispatch_next.load_plan(plan_path)
    assert loaded["idea"] == "Voice App"
    tasks = factory_dispatch_next.plan_tasks(loaded)
    assert [t.index for t in tasks] == [0, 1]
    assert tasks[1].depends_on == (0,)


# ---------------------------------------------------------------------------
# find_checklist_comment
# ---------------------------------------------------------------------------


def test_find_checklist_comment_found():
    marker = factory_dispatch_next.CHECKLIST_MARKER
    comments = [{"id": 1, "body": "hi"}, {"id": 2, "body": f"{marker}\nchecklist"}]
    found = factory_dispatch_next.find_checklist_comment(comments)
    assert found["id"] == 2


def test_find_checklist_comment_missing():
    assert factory_dispatch_next.find_checklist_comment([{"id": 1, "body": "hi"}]) is None


# ---------------------------------------------------------------------------
# run_dispatch_next orchestration (all network mocked)
# ---------------------------------------------------------------------------


def _write_plan(tmp_path, tasks):
    plan = {
        "idea": "Voice App",
        "slug": "voice-app",
        "parent_issue": 1,
        "option": "NestJS",
        "tasks": tasks,
    }
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(plan), encoding="utf-8")
    return plan_path


def test_run_dispatch_next_dispatches_unblocked_task_and_posts_new_checklist(tmp_path, monkeypatch):
    plan_path = _write_plan(
        tmp_path,
        [
            {"index": 0, "issue": 101, "title": "T0", "depends_on": []},
            {"index": 1, "issue": 102, "title": "T1", "depends_on": [0]},
        ],
    )
    states = {
        101: {"state": "closed", "labels": []},
        102: {"state": "open", "labels": [{"name": "agent"}]},
    }
    monkeypatch.setattr(factory_dispatch_next, "get_issue_state", lambda token, repo, n: states[n])
    dispatched = []
    monkeypatch.setattr(
        factory_dispatch_next,
        "dispatch_workflow",
        lambda token, repo, wf, ref, inputs: dispatched.append(inputs),
    )
    labels_added = []
    monkeypatch.setattr(
        factory_dispatch_next.agent_runner,
        "add_labels",
        lambda token, repo, number, labs: labels_added.append((number, labs)),
    )
    monkeypatch.setattr(factory_dispatch_next.agent_runner, "_gh_request", lambda *a, **k: [])
    comments = []
    monkeypatch.setattr(
        factory_dispatch_next.agent_runner,
        "comment_on_issue",
        lambda token, repo, number, body: comments.append((number, body)),
    )

    result = factory_dispatch_next.run_dispatch_next(
        plan_path=plan_path, repo="o/r", token="tok", max_concurrent=2
    )
    assert result["status"] == "dispatched"
    assert result["dispatched"] == [102]
    assert result["done"] == [0]
    assert dispatched == [{"issue_number": "102"}]
    assert (102, ["agent-dispatched"]) in labels_added
    assert any(n == 1 for n, _ in comments)  # new checklist posted (no existing one found)


def test_run_dispatch_next_updates_existing_checklist_instead_of_posting_new(tmp_path, monkeypatch):
    plan_path = _write_plan(tmp_path, [{"index": 0, "issue": 101, "title": "T0", "depends_on": []}])
    monkeypatch.setattr(
        factory_dispatch_next,
        "get_issue_state",
        lambda token, repo, n: {"state": "open", "labels": []},
    )
    monkeypatch.setattr(factory_dispatch_next, "dispatch_workflow", lambda *a, **k: None)
    monkeypatch.setattr(factory_dispatch_next.agent_runner, "add_labels", lambda *a, **k: None)
    marker = factory_dispatch_next.CHECKLIST_MARKER
    monkeypatch.setattr(
        factory_dispatch_next.agent_runner,
        "_gh_request",
        lambda *a, **k: [{"id": 55, "body": f"{marker}\nold"}],
    )
    updated = []
    monkeypatch.setattr(
        factory_dispatch_next,
        "update_issue_comment",
        lambda token, repo, comment_id, body: updated.append((comment_id, body)),
    )
    new_comments = []
    monkeypatch.setattr(
        factory_dispatch_next.agent_runner,
        "comment_on_issue",
        lambda token, repo, number, body: new_comments.append(body),
    )

    factory_dispatch_next.run_dispatch_next(
        plan_path=plan_path, repo="o/r", token="tok", max_concurrent=2
    )
    assert updated and updated[0][0] == 55
    assert not new_comments  # never posts a fresh checklist when one already exists


def test_run_dispatch_next_all_done_posts_completion_message(tmp_path, monkeypatch):
    plan_path = _write_plan(tmp_path, [{"index": 0, "issue": 101, "title": "T0", "depends_on": []}])
    monkeypatch.setattr(
        factory_dispatch_next,
        "get_issue_state",
        lambda token, repo, n: {"state": "closed", "labels": []},
    )
    monkeypatch.setattr(factory_dispatch_next, "dispatch_workflow", lambda *a, **k: None)
    monkeypatch.setattr(factory_dispatch_next.agent_runner, "add_labels", lambda *a, **k: None)
    monkeypatch.setattr(factory_dispatch_next.agent_runner, "_gh_request", lambda *a, **k: [])
    comments = []
    monkeypatch.setattr(
        factory_dispatch_next.agent_runner,
        "comment_on_issue",
        lambda token, repo, number, body: comments.append(body),
    )

    result = factory_dispatch_next.run_dispatch_next(
        plan_path=plan_path, repo="o/r", token="tok", max_concurrent=2
    )
    assert result["status"] == "complete"
    assert any("تکمیل شدند" in c for c in comments)


def test_main_missing_plan_file_returns_zero_without_error(tmp_path, monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "tok")
    missing = tmp_path / "does-not-exist.json"
    rc = factory_dispatch_next.main(["--plan", str(missing), "--repo", "o/r"])
    assert rc == 0


def test_main_missing_token_returns_nonzero(monkeypatch, tmp_path):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    plan_path = _write_plan(tmp_path, [{"index": 0, "issue": 101, "title": "T0", "depends_on": []}])
    rc = factory_dispatch_next.main(["--plan", str(plan_path), "--repo", "o/r"])
    assert rc == 1
