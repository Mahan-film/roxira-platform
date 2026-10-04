"""Issue #423: a skipped/neutral/cancelled/null REQUIRED check never counts as passed."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "ci" / "merge_gate.py"


@pytest.fixture(scope="module")
def gate():
    spec = importlib.util.spec_from_file_location("merge_gate_skipped_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _decide(gate, checks):
    pr = {
        "number": 1,
        "state": "OPEN",
        "is_draft": False,
        "author_login": "bot",
        "head_ref": "issue-1",
        "head_sha": "abc",
        "mergeable": "MERGEABLE",
        "labels": [],
        "additions": 1,
        "deletions": 0,
    }
    return gate.decide(pr, checks, ["src/ops/x.py"], expected_sha="abc", allowed_actors=["bot"])


def _checks(gate, name=None, conclusion="success"):
    names = gate.REQUIRED + gate.EXTRA_REQUIRED
    return [
        {
            "name": n,
            "status": "completed",
            "conclusion": conclusion if n == name else "success",
        }
        for n in names
    ]


def test_all_success_still_merges(gate):
    assert _decide(gate, _checks(gate))["action"] == "merge"


@pytest.mark.parametrize("conclusion", ["skipped", "neutral", "cancelled", None, "SKIPPED"])
def test_required_check_not_passed_blocks(gate, conclusion):
    for name in ("Pytest (unit)", "Frontend gate", "Undefined names"):
        decision = _decide(gate, _checks(gate, name, conclusion))
        assert decision["action"] == "block"
        assert any(name in r for r in decision["reasons"])


def test_skipped_duplicate_run_blocks_even_with_a_success_run(gate):
    checks = _checks(gate)
    checks.append({"name": "Pytest (unit)", "status": "completed", "conclusion": "skipped"})
    assert _decide(gate, checks)["action"] == "block"


def test_uppercase_success_passes(gate):
    assert _decide(gate, _checks(gate, "Pytest (unit)", "SUCCESS"))["action"] == "merge"
