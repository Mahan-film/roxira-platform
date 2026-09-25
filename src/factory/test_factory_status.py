"""Unit tests for output_apps/ecosystem_core/src/factory/factory_status.py
(Project Factory stage 6: `/status` -> a Persian progress + spend reply).

`build_status()`'s GitHub/OpenRouter calls are mocked, same style as the
other factory_*.py test files; `src/factory_pipeline/test_status_report.py`
already covers the Persian formatting itself in isolation.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

factory_status = None


@pytest.fixture(scope="session", autouse=True)
def _load_module():
    global factory_status
    if factory_status is None:
        module_path = (
            Path(__file__).resolve().parents[2]
            / "output_apps"
            / "ecosystem_core"
            / "src"
            / "factory"
            / "factory_status.py"
        )
        spec = importlib.util.spec_from_file_location("factory_status", module_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["factory_status"] = module
        spec.loader.exec_module(module)
        factory_status = module
    return factory_status


def _plan():
    return {
        "idea": "Voice App",
        "slug": "voice-app",
        "parent_issue": 1,
        "option": "NestJS",
        "tasks": [
            {"index": 0, "issue": 101, "title": "T0", "depends_on": []},
            {"index": 1, "issue": 102, "title": "T1", "depends_on": [0]},
        ],
    }


def test_build_status_reports_done_and_in_progress(monkeypatch):
    info = {
        101: {"state": "closed", "labels": ["agent"], "pr_url": "https://github.com/o/r/pull/5"},
        102: {"state": "open", "labels": ["agent", "agent-dispatched"], "pr_url": "https://github.com/o/r/pull/6"},
    }
    monkeypatch.setattr(factory_status, "get_issue_with_pr", lambda token, repo, n: info[n])
    monkeypatch.setattr(factory_status.agent_runner, "openrouter_key_usage", lambda key: 0.75)

    text = factory_status.build_status(
        plan=_plan(), token="tok", repo="o/r", openrouter_key="or-key", budget_usd=2.0
    )
    assert "✅ #101" in text
    assert "🟨 #102" in text
    assert "$0.75" in text
    assert "$2.00" in text
    assert "[PR](https://github.com/o/r/pull/5)" in text  # shown inline on the done task's own line
    assert "### PR های باز" in text
    open_prs_section = text.split("### PR های باز", 1)[1]
    assert "https://github.com/o/r/pull/6" in open_prs_section
    assert "https://github.com/o/r/pull/5" not in open_prs_section  # done task's PR isn't "open"


def test_build_status_open_task_without_pr(monkeypatch):
    info = {
        101: {"state": "open", "labels": ["agent"], "pr_url": None},
        102: {"state": "open", "labels": ["agent"], "pr_url": None},
    }
    monkeypatch.setattr(factory_status, "get_issue_with_pr", lambda token, repo, n: info[n])
    monkeypatch.setattr(factory_status.agent_runner, "openrouter_key_usage", lambda key: None)

    text = factory_status.build_status(
        plan=_plan(), token="tok", repo="o/r", openrouter_key="", budget_usd=2.0
    )
    assert "⬜ #101" in text
    assert "⬜ #102" in text


def test_build_status_no_openrouter_key_skips_usage_lookup(monkeypatch):
    called = {"used": False}
    open_issue = {"state": "open", "labels": [], "pr_url": None}
    monkeypatch.setattr(factory_status, "get_issue_with_pr", lambda token, repo, n: open_issue)
    monkeypatch.setattr(
        factory_status.agent_runner,
        "openrouter_key_usage",
        lambda key: called.__setitem__("used", True),
    )

    factory_status.build_status(
        plan=_plan(), token="tok", repo="o/r", openrouter_key="", budget_usd=2.0
    )
    assert called["used"] is False  # empty key never triggers a network call


def test_main_missing_plan_posts_persian_notice_and_returns_zero(tmp_path, monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "tok")
    comments = []
    monkeypatch.setattr(
        factory_status.agent_runner,
        "comment_on_issue",
        lambda token, repo, number, body: comments.append(body),
    )
    missing_plan = tmp_path / "does-not-exist.json"
    rc = factory_status.main(["--plan", str(missing_plan), "--issue", "1", "--repo", "o/r"])
    assert rc == 0
    assert comments and "یافت نشد" in comments[0]


def test_main_missing_token_returns_nonzero(monkeypatch, tmp_path):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(_plan()), encoding="utf-8")
    rc = factory_status.main(["--plan", str(plan_path), "--issue", "1", "--repo", "o/r"])
    assert rc == 1


def test_main_posts_status_reply(tmp_path, monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "tok")
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(_plan()), encoding="utf-8")
    monkeypatch.setattr(
        factory_status,
        "get_issue_with_pr",
        lambda token, repo, n: {"state": "open", "labels": [], "pr_url": None},
    )
    monkeypatch.setattr(factory_status.agent_runner, "openrouter_key_usage", lambda key: None)
    comments = []
    monkeypatch.setattr(
        factory_status.agent_runner,
        "comment_on_issue",
        lambda token, repo, number, body: comments.append((number, body)),
    )

    rc = factory_status.main(["--plan", str(plan_path), "--issue", "1", "--repo", "o/r"])
    assert rc == 0
    assert comments and comments[0][0] == 1
