from __future__ import annotations

from src.factory_pipeline.ledger_comments import encode_event
from src.factory_pipeline.report_cli import (
    NO_DATA_FA,
    _decode_comment_pages,
    build_report,
    main,
)
from src.factory_pipeline.run_ledger import make_event


def _bodies() -> list[str]:
    return [
        encode_event(
            make_event("run-7", "research", "success", now="2026-10-01T10:00:00Z", cost_usd=0.10)
        ),
        encode_event(
            make_event("run-7", "plan", "failure", now="2026-10-01T10:05:00Z", cost_usd=0.05)
        ),
        encode_event(
            make_event("run-7", "task", "success", now="2026-10-01T10:10:00Z", cost_usd=0.02)
        ),
    ]


def test_report_shows_stage_statuses_and_total_cost():
    report = build_report(_bodies())

    assert "پژوهش: انجام شد" in report
    assert "برنامه‌ریزی: ناموفق" in report
    assert "پیاده‌سازی: انجام شد" in report
    assert "دریافت درخواست: بدون سابقه" in report
    assert "هزینهٔ کل: 0.17 دلار" in report


def test_report_appends_persian_budget_line():
    report = build_report(_bodies())

    assert "بودجه:" in report
    assert "0.17" in report


def test_no_ledger_comments_gives_no_data_line():
    assert build_report([]) == NO_DATA_FA


def test_main_uses_injected_fetch(capsys):
    calls: list[int] = []

    def fake_fetch(issue: int) -> list[str]:
        calls.append(issue)
        return _bodies()

    assert main(["--issue", "42"], fetch=fake_fetch) == 0
    assert calls == [42]
    assert "گزارش تحویل" in capsys.readouterr().out


def test_decode_comment_pages_handles_paginated_output():
    raw = '[{"body": "a"}, {"body": "b"}]\n[{"body": "c"}]'

    assert [comment["body"] for comment in _decode_comment_pages(raw)] == ["a", "b", "c"]
