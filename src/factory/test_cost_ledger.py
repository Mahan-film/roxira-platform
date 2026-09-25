"""Unit tests for output_apps/ecosystem_core/src/factory/cost_ledger.py (W13).

Pure logic + file I/O in a tmp_path only. No network call (openrouter_key_snapshot
is exercised with a fake urlopen), no real API keys. Safe for
`pytest -m "not integration"`.

cost_ledger.py lives under output_apps/, outside pytest's `testpaths = ["src"]`
(see pyproject.toml), so it's loaded dynamically by file path inside a fixture,
same convention as src/factory/test_agent_runner.py -- see that file's docstring
for why (src/test_ci_quarantine_guard.py forbids module-level side effects in
any src/test_*.py).
"""

from __future__ import annotations

import importlib.util
import sys
from datetime import date
from pathlib import Path

import pytest

cost_ledger = None  # populated by _load_cost_ledger() before any test runs


@pytest.fixture(scope="session", autouse=True)
def _load_cost_ledger():
    global cost_ledger
    if cost_ledger is None:
        module_path = (
            Path(__file__).resolve().parents[2]
            / "output_apps"
            / "ecosystem_core"
            / "src"
            / "factory"
            / "cost_ledger.py"
        )
        spec = importlib.util.spec_from_file_location("cost_ledger", module_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["cost_ledger"] = module
        spec.loader.exec_module(module)
        cost_ledger = module
    return cost_ledger


# ---------------------------------------------------------------------------
# append_row / read_rows
# ---------------------------------------------------------------------------


def test_append_row_then_read_rows(tmp_path):
    path = tmp_path / "ledger.jsonl"
    cost_ledger.append_row(path, "agent-task", {"cost_usd": 0.5, "model": "deepseek/x"})
    cost_ledger.append_row(path, "agent-review", {"cost_usd": 0.1, "model": "sonnet"})

    rows = cost_ledger.read_rows(path)
    assert len(rows) == 2
    assert rows[0]["source"] == "agent-task"
    assert rows[0]["cost_usd"] == 0.5
    assert "ts" in rows[0]


def test_append_row_never_writes_a_secret_key_name(tmp_path):
    path = tmp_path / "ledger.jsonl"
    cost_ledger.append_row(path, "agent-review", {"cost_usd": 0.2, "model": "m"})
    raw = path.read_text(encoding="utf-8")
    assert "OPENROUTER" not in raw
    assert "sk-" not in raw


def test_read_rows_skips_missing_file(tmp_path):
    assert cost_ledger.read_rows(tmp_path / "nope.jsonl") == []


def test_read_rows_skips_unparseable_lines(tmp_path):
    path = tmp_path / "ledger.jsonl"
    path.write_text('{"ts": "2026-01-01T00:00:00", "cost_usd": 1}\nnot json\n\n', encoding="utf-8")
    rows = cost_ledger.read_rows(path)
    assert len(rows) == 1


def test_read_rows_concatenates_multiple_files(tmp_path):
    a = tmp_path / "a.jsonl"
    b = tmp_path / "b.jsonl"
    a.write_text('{"ts": "2026-01-01T00:00:00", "cost_usd": 1}\n', encoding="utf-8")
    b.write_text('{"ts": "2026-01-01T00:00:00", "cost_usd": 2}\n', encoding="utf-8")
    rows = cost_ledger.read_rows(a, b)
    assert len(rows) == 2


# ---------------------------------------------------------------------------
# spend_for_day / aggregate
# ---------------------------------------------------------------------------


def _rows():
    return [
        {"ts": "2026-09-25T10:00:00", "source": "agent-task", "model": "deepseek", "cost_usd": 0.3},
        {"ts": "2026-09-25T11:00:00", "source": "agent-task", "model": "deepseek", "cost_usd": 0.2},
        {"ts": "2026-09-25T12:00:00", "source": "agent-review", "model": "sonnet", "cost_usd": 0.1},
        {"ts": "2026-09-24T09:00:00", "source": "agent-task", "model": "deepseek", "cost_usd": 5.0},
    ]


def test_spend_for_day_sums_only_that_day():
    assert cost_ledger.spend_for_day(_rows(), "2026-09-25") == pytest.approx(0.6)


def test_spend_for_day_filters_by_source():
    spend = cost_ledger.spend_for_day(_rows(), "2026-09-25", source="agent-review")
    assert spend == pytest.approx(0.1)


def test_aggregate_groups_by_day_source_model_and_excludes_before_since():
    agg = cost_ledger.aggregate(_rows(), since=date(2026, 9, 25))
    days = {r["day"] for r in agg}
    assert days == {"2026-09-25"}
    task_row = next(r for r in agg if r["source"] == "agent-task")
    assert task_row["calls"] == 2
    assert task_row["cost_usd"] == pytest.approx(0.5)


def test_aggregate_empty_rows_returns_empty_list():
    assert cost_ledger.aggregate([], since=date(2026, 1, 1)) == []


# ---------------------------------------------------------------------------
# render_report
# ---------------------------------------------------------------------------


def test_render_report_empty_english():
    assert "No cost" in cost_ledger.render_report([], lang="en")


def test_render_report_empty_persian():
    text = cost_ledger.render_report([], lang="fa")
    assert "هزینه" in text


def test_render_report_includes_total_and_persian_source_label():
    agg = cost_ledger.aggregate(_rows(), since=date(2026, 9, 25))
    text = cost_ledger.render_report(agg, lang="fa")
    assert "اجرای ایجنت" in text  # SOURCE_AGENT_TASK label
    assert "مجموع" in text


def test_render_report_rejects_bad_lang():
    with pytest.raises(ValueError):
        cost_ledger.render_report([], lang="de")


# ---------------------------------------------------------------------------
# check_daily_budget (network mocked via monkeypatch on openrouter_key_snapshot)
# ---------------------------------------------------------------------------


def test_check_daily_budget_no_budget_configured():
    check = cost_ledger.check_daily_budget("key", 0.0)
    assert check.allowed is True
    assert check.checked_via == "none"


def test_check_daily_budget_unreachable_does_not_block(monkeypatch):
    monkeypatch.setattr(cost_ledger, "openrouter_key_snapshot", lambda api_key, timeout=15.0: None)
    check = cost_ledger.check_daily_budget("key", 2.0)
    assert check.allowed is True
    assert check.checked_via == "unreachable"


def test_check_daily_budget_daily_reset_over_limit_blocks(monkeypatch):
    monkeypatch.setattr(
        cost_ledger,
        "openrouter_key_snapshot",
        lambda api_key, timeout=15.0: {"limit_reset": "daily", "limit_remaining": 0.0},
    )
    check = cost_ledger.check_daily_budget("key", 2.0)
    assert check.allowed is False
    assert check.remaining_usd == 0.0


def test_check_daily_budget_daily_reset_within_limit_allows(monkeypatch):
    monkeypatch.setattr(
        cost_ledger,
        "openrouter_key_snapshot",
        lambda api_key, timeout=15.0: {"limit_reset": "daily", "limit_remaining": 1.5},
    )
    check = cost_ledger.check_daily_budget("key", 2.0)
    assert check.allowed is True
    assert check.remaining_usd == 1.5


def test_check_daily_budget_no_daily_reset_documents_only(monkeypatch):
    monkeypatch.setattr(
        cost_ledger,
        "openrouter_key_snapshot",
        lambda api_key, timeout=15.0: {"limit_reset": None, "limit_remaining": None},
    )
    check = cost_ledger.check_daily_budget("key", 2.0)
    assert check.allowed is True
    assert check.checked_via == "documented-only"


def test_openrouter_key_snapshot_bad_json_returns_none(monkeypatch):
    class _FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"not json"

    monkeypatch.setattr(
        cost_ledger.urllib.request, "urlopen", lambda req, timeout=15.0: _FakeResp()
    )
    assert cost_ledger.openrouter_key_snapshot("key") is None
