"""Unit tests for output_apps/ecosystem_core/src/factory/factory_approval_gate.py
(Project Factory stage 3: /approve comment or `approved` label -> proceed?).

Pure logic only: `decide()` has no GitHub call and no file write. Loaded the
same way src/factory/test_agent_runner.py loads agent_runner.py -- by file
path, inside a fixture, not at collection/import time -- because this module
lives under output_apps/, outside pytest's `testpaths = ["src"]` (see
pyproject.toml), and src/test_ci_quarantine_guard.py forbids import-time side
effects in any src/test_*.py.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

factory_approval_gate = None


@pytest.fixture(scope="session", autouse=True)
def _load_module():
    global factory_approval_gate
    if factory_approval_gate is None:
        module_path = (
            Path(__file__).resolve().parents[2]
            / "output_apps"
            / "ecosystem_core"
            / "src"
            / "factory"
            / "factory_approval_gate.py"
        )
        spec = importlib.util.spec_from_file_location("factory_approval_gate", module_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["factory_approval_gate"] = module
        spec.loader.exec_module(module)
        factory_approval_gate = module
    return factory_approval_gate


def test_bare_approve_comment_proceeds_with_no_option():
    result = factory_approval_gate.decide("issue_comment", "/approve", "")
    assert result == {"proceed": "true", "option": ""}


def test_approve_with_option_comment():
    result = factory_approval_gate.decide("issue_comment", "/approve Option B", "")
    assert result == {"proceed": "true", "option": "Option B"}


def test_unrelated_comment_does_not_proceed():
    result = factory_approval_gate.decide("issue_comment", "looks good, thanks!", "")
    assert result == {"proceed": "false"}


def test_approved_label_proceeds():
    result = factory_approval_gate.decide("issues", "", "approved")
    assert result == {"proceed": "true", "option": ""}


def test_approved_label_case_insensitive():
    result = factory_approval_gate.decide("issues", "", "Approved")
    assert result == {"proceed": "true", "option": ""}


def test_other_label_does_not_proceed():
    result = factory_approval_gate.decide("issues", "", "bug")
    assert result == {"proceed": "false"}


def test_write_outputs_to_github_output_file(tmp_path, monkeypatch):
    output_file = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    factory_approval_gate._write_outputs({"proceed": "true", "option": "Option A"})
    content = output_file.read_text(encoding="utf-8")
    assert "proceed=true" in content
    assert "option=Option A" in content


def test_write_outputs_appends_without_truncating(tmp_path, monkeypatch):
    output_file = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    factory_approval_gate._write_outputs({"a": "1"})
    factory_approval_gate._write_outputs({"b": "2"})
    content = output_file.read_text(encoding="utf-8")
    assert "a=1" in content
    assert "b=2" in content


def test_main_returns_zero(monkeypatch, tmp_path):
    output_file = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    rc = factory_approval_gate.main(["--event-name", "issue_comment", "--comment-body", "/approve"])
    assert rc == 0
    assert "proceed=true" in output_file.read_text(encoding="utf-8")
