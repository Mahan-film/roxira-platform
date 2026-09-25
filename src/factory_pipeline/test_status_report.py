from __future__ import annotations

from src.factory_pipeline.status_report import format_progress_checklist, format_status_comment


def _tasks():
    return [
        {"title": "Set up DB schema", "issue": 11, "status": "done", "pr_url": "https://github.com/x/y/pull/1"},
        {"title": "Add API endpoint", "issue": 12, "status": "in_progress", "pr_url": None},
        {"title": "Add frontend page", "issue": 13, "status": "blocked", "pr_url": None},
        {"title": "Write docs", "issue": 14, "status": "open", "pr_url": None},
    ]


def test_progress_checklist_counts_done():
    text = format_progress_checklist("Voice App", _tasks())
    assert "1 از 4 وظیفه تکمیل شده." in text


def test_progress_checklist_shows_each_task_with_icon():
    text = format_progress_checklist("Voice App", _tasks())
    assert "✅ #11: Set up DB schema" in text
    assert "🟨 #12: Add API endpoint" in text
    assert "⛔ #13: Add frontend page" in text
    assert "⬜ #14: Write docs" in text


def test_progress_checklist_links_pr_when_present():
    text = format_progress_checklist("Voice App", _tasks())
    assert "[PR](https://github.com/x/y/pull/1)" in text


def test_unknown_status_defaults_to_open_icon():
    text = format_progress_checklist("Voice App", [{"title": "X", "issue": 1, "status": "weird"}])
    assert "⬜ #1: X" in text


def test_status_comment_includes_spend_and_budget():
    text = format_status_comment(idea="Voice App", tasks=_tasks(), spend_usd=1.23, budget_usd=2.0)
    assert "$1.23" in text
    assert "$2.00" in text


def test_status_comment_spend_unknown():
    text = format_status_comment(idea="Voice App", tasks=_tasks(), spend_usd=None, budget_usd=None)
    assert "قابل استعلام نبود" in text


def test_status_comment_lists_open_prs():
    text = format_status_comment(
        idea="Voice App",
        tasks=_tasks(),
        spend_usd=None,
        budget_usd=None,
        open_prs=["https://github.com/x/y/pull/2"],
    )
    assert "https://github.com/x/y/pull/2" in text
