"""Unit tests for output_apps/ecosystem_core/src/factory/automerge_gate.py (W13).

Pure decision logic only, no network, no keys, no gh/git subprocess calls.
Safe for `pytest -m "not integration"`.

automerge_gate.py lives under output_apps/, outside pytest's `testpaths =
["src"]` (see pyproject.toml), so it's loaded dynamically by file path inside
a fixture, same convention as src/factory/test_agent_runner.py.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

automerge_gate = None  # populated by _load_automerge_gate() before any test runs


@pytest.fixture(scope="session", autouse=True)
def _load_automerge_gate():
    global automerge_gate
    if automerge_gate is None:
        module_path = (
            Path(__file__).resolve().parents[2]
            / "output_apps"
            / "ecosystem_core"
            / "src"
            / "factory"
            / "automerge_gate.py"
        )
        spec = importlib.util.spec_from_file_location("automerge_gate", module_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["automerge_gate"] = module
        spec.loader.exec_module(module)
        automerge_gate = module
    return automerge_gate


BOT = "github-actions[bot]"


def _happy_path_input(**overrides):
    kwargs = dict(
        branch="agent/42-fix-thing",
        pr_author_login=BOT,
        ci_conclusion="success",
        review_verdict="approve",
        review_risk="low",
        review_status_creator=BOT,
        head_commit_author_login=BOT,
        changed_files=["src/factory/foo.py"],
        diff_bytes=100,
        automerge_enabled=True,
        max_diff_bytes=60_000,
    )
    kwargs.update(overrides)
    return automerge_gate.GateInput(**kwargs)


# ---------------------------------------------------------------------------
# decide(): the happy path and every single failing condition
# ---------------------------------------------------------------------------


def test_decide_allows_the_fully_compliant_pr():
    decision = automerge_gate.decide(_happy_path_input())
    assert decision.allow is True
    assert decision.reasons == []


def test_decide_blocks_when_automerge_disabled():
    decision = automerge_gate.decide(_happy_path_input(automerge_enabled=False))
    assert decision.allow is False
    assert any("AUTO_MERGE_ENABLED" in r for r in decision.reasons)


def test_decide_blocks_non_agent_branch():
    decision = automerge_gate.decide(_happy_path_input(branch="feature/foo"))
    assert decision.allow is False
    assert any("agent/" in r for r in decision.reasons)


def test_decide_blocks_human_pr_author():
    # A PR opened directly by a human (not the GITHUB_TOKEN bot) must never
    # auto-merge, even from an agent/* branch -- see hub review point 5.
    decision = automerge_gate.decide(_happy_path_input(pr_author_login="mahan-films"))
    assert decision.allow is False
    assert any("PR author is" in r for r in decision.reasons)


def test_decide_blocks_mismatched_head_commit_provenance():
    decision = automerge_gate.decide(_happy_path_input(head_commit_author_login="someone-else"))
    assert decision.allow is False
    assert any("provenance check" in r for r in decision.reasons)


def test_decide_does_not_block_when_provenance_unchecked():
    # None means "the caller couldn't cheaply verify this" -- must not block
    # by itself, only pr_author_login is the required (non-optional) check.
    decision = automerge_gate.decide(_happy_path_input(head_commit_author_login=None))
    assert decision.allow is True


def test_decide_blocks_when_ci_not_green():
    decision = automerge_gate.decide(_happy_path_input(ci_conclusion="failure"))
    assert decision.allow is False
    assert any("CI is not green" in r for r in decision.reasons)


def test_decide_blocks_when_review_not_approve():
    decision = automerge_gate.decide(_happy_path_input(review_verdict="request_changes"))
    assert decision.allow is False
    assert any("agent-review verdict" in r for r in decision.reasons)


def test_decide_blocks_when_review_missing():
    decision = automerge_gate.decide(
        _happy_path_input(review_verdict=None, review_risk=None, review_status_creator=None)
    )
    assert decision.allow is False


def test_decide_blocks_when_risk_not_low():
    decision = automerge_gate.decide(_happy_path_input(review_risk="medium"))
    assert decision.allow is False
    assert any("risk is" in r for r in decision.reasons)


def test_decide_ignores_review_verdict_from_untrusted_status_creator():
    # Even a claimed approve/low-risk verdict must be ignored if the commit
    # status wasn't posted by the trusted bot account -- hub review point 6.
    decision = automerge_gate.decide(
        _happy_path_input(
            review_status_creator="some-random-app[bot]",
            review_verdict="approve",
            review_risk="low",
        )
    )
    assert decision.allow is False
    assert any("status creator is" in r for r in decision.reasons)
    # And it must not also complain about verdict/risk individually -- those
    # are only evaluated once the creator is trusted.
    assert not any("agent-review verdict is" in r for r in decision.reasons)


def test_decide_blocks_when_diff_too_large():
    decision = automerge_gate.decide(_happy_path_input(diff_bytes=999_999, max_diff_bytes=1000))
    assert decision.allow is False
    assert any("over the" in r for r in decision.reasons)


@pytest.mark.parametrize(
    "path",
    [
        "docker-compose.prod.yml",
        ".github/workflows/ci.yml",
        "output_apps/nginx_config/nginx.conf",
        "roxira-worker.service",
        ".env",
        ".env.production",
        "config/models.yaml",
        "scripts/ops/pull_backups_to_mac.sh",
        "src/roxira_manager/db/migrations/0001_init.py",
        "output_apps/enterprise_hub/src/auth/session.ts",
        "output_apps/generated_modules/smartjudge/zibal_client.py",
        "src/payment/handler.py",
    ],
)
def test_decide_blocks_each_denylisted_path(path):
    decision = automerge_gate.decide(_happy_path_input(changed_files=[path]))
    assert decision.allow is False
    assert any("deny list" in r for r in decision.reasons)


def test_decide_allows_ordinary_source_path():
    path = "output_apps/enterprise_hub/src/widgets/foo.ts"
    decision = automerge_gate.decide(_happy_path_input(changed_files=[path]))
    assert decision.allow is True


def test_decide_collects_multiple_reasons_at_once():
    decision = automerge_gate.decide(
        _happy_path_input(automerge_enabled=False, branch="feature/x", ci_conclusion="failure")
    )
    assert decision.allow is False
    assert len(decision.reasons) >= 3


def test_gate_decision_to_dict():
    decision = automerge_gate.decide(_happy_path_input())
    assert decision.to_dict() == {"allow": True, "reasons": []}


# ---------------------------------------------------------------------------
# denylisted_paths() directly
# ---------------------------------------------------------------------------


def test_denylisted_paths_empty_for_clean_diff():
    assert automerge_gate.denylisted_paths(["src/factory/foo.py", "docs/notes.md"]) == []


def test_denylisted_paths_normalizes_leading_slash_and_backslash():
    hits = automerge_gate.denylisted_paths(["/.env", "scripts\\ops\\thing.sh"])
    assert len(hits) == 2


# ---------------------------------------------------------------------------
# main() CLI
# ---------------------------------------------------------------------------


def test_main_prints_allow_true_for_compliant_input(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("AUTO_MERGE_ENABLED", "true")

    review_json = tmp_path / "review.json"
    verdict = {"verdict": "approve", "risk": "low", "reasons": []}
    review_json.write_text(json.dumps({"verdict": verdict}), encoding="utf-8")
    changed_files_file = tmp_path / "changed.txt"
    changed_files_file.write_text("src/factory/foo.py\n", encoding="utf-8")

    rc = automerge_gate.main(
        [
            "--branch",
            "agent/1-x",
            "--pr-author-login",
            BOT,
            "--head-commit-author-login",
            BOT,
            "--ci-conclusion",
            "success",
            "--review-json",
            str(review_json),
            "--review-status-creator",
            BOT,
            "--changed-files-file",
            str(changed_files_file),
            "--diff-bytes",
            "10",
        ]
    )
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out["allow"] is True


def test_main_defaults_automerge_disabled_when_env_unset(monkeypatch, capsys):
    monkeypatch.delenv("AUTO_MERGE_ENABLED", raising=False)
    rc = automerge_gate.main(
        [
            "--branch",
            "agent/1-x",
            "--pr-author-login",
            BOT,
            "--ci-conclusion",
            "success",
        ]
    )
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out["allow"] is False


def test_main_blocks_non_bot_author_by_default(monkeypatch, capsys):
    monkeypatch.setenv("AUTO_MERGE_ENABLED", "true")
    rc = automerge_gate.main(
        [
            "--branch",
            "agent/1-x",
            "--pr-author-login",
            "mahan-films",
            "--ci-conclusion",
            "success",
        ]
    )
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out["allow"] is False
    assert any("PR author is" in r for r in out["reasons"])
