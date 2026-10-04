"""Offline tests for the test-tampering signals in scripts/dev/merge_check.py."""

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def mc():
    path = ROOT / "scripts/dev/merge_check.py"
    spec = importlib.util.spec_from_file_location("merge_check_tamper_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _diff(name, added=(), removed=()):
    out = [f"diff --git a/{name} b/{name}", f"--- a/{name}", f"+++ b/{name}", "@@ -1 +1 @@"]
    out += [f"+{x}" for x in added] + [f"-{x}" for x in removed]
    return "\n".join(out) + "\n"


def _run(mc, diff, path="src/test_a.py"):
    pr = {
        "state": "OPEN",
        "isDraft": False,
        "headRefOid": "abc",
        "labels": [],
        "files": [{"path": path}],
        "additions": 10,
        "deletions": 0,
    }

    def gh(args):
        return json.dumps(pr) if args[:2] == ["pr", "view"] else diff

    return mc.check(1, gh=gh, cfg=mc.load_config())


def _tampered_lines():
    return [
        "@pytest.mark.skip(reason='x')",
        "    pytest.skip('x')",
        "@pytest.mark.xfail",
        "    it.only('x', () => {})",
        "import os  # noqa",
        "x: int = y  # type: ignore",
    ]


@pytest.mark.parametrize("idx", range(6))
def test_added_tamper_line_needs_owner_review(mc, idx):
    line = _tampered_lines()[idx]
    diff = _diff("src/test_a.py", ["def test_a():", line, "    assert 1"])
    text, code, _ = _run(mc, diff)
    assert code == 10, text
    assert "test tampering signal" in text


def test_tamper_in_non_test_file_is_ignored(mc):
    diff = _diff("src/a.py", ["import os  # noqa"])
    text, _, _ = _run(mc, diff, "src/a.py")
    assert "tampering" not in text


def test_removed_tamper_line_is_not_flagged(mc):
    diff = _diff("src/test_a.py", ["def test_a():", "    assert 1"], ["# noqa", "# type: ignore"])
    text, _, _ = _run(mc, diff)
    assert "tampering" not in text


def test_assert_net_removal_over_two_needs_review(mc):
    removed = ["    assert 1", "    assert 2", "    assert 3"]
    added = ["    x = 1", "    y = 2", "    z = 3", "    w = 4"]
    text, code, _ = _run(mc, _diff("src/test_a.py", added, removed))
    assert code == 10, text
    assert "assertions removed" in text


def test_assert_net_removal_of_two_is_tolerated(mc):
    removed = ["    assert 1", "    assert 2"]
    added = ["    x = 1", "    y = 2", "    z = 3"]
    text, _, _ = _run(mc, _diff("src/test_a.py", added, removed))
    assert "assertions removed" not in text


def test_assert_replaced_one_for_one_is_fine(mc):
    removed = ["    assert a", "    assert b", "    assert c", "    assert d"]
    added = ["    assert e", "    assert f", "    assert g", "    assert h", "    pass"]
    text, _, _ = _run(mc, _diff("src/test_a.py", added, removed))
    assert "assertions removed" not in text


def test_existing_block_rules_still_win(mc):
    d = _diff("src/test_a.py", ["# noqa"], ["def test_a():", "    assert 1", "    assert 2"])
    text, code, _ = _run(mc, d)
    assert code == 20 and "test file reduced" in text
