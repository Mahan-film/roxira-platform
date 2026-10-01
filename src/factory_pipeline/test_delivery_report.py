from src.factory_pipeline.delivery_report import render_delivery_report_fa


def _summary(**overrides):
    summary = {
        "run_id": "run-42",
        "stages": {
            stage: "ok"
            for stage in (
                "intake", "research", "approval", "plan", "task", "review",
                "preview", "deploy", "verify", "report",
            )
        },
        "failed": [],
        "total_cost_usd": 0.42,
    }
    summary.update(overrides)
    return summary


def test_all_ok_report_is_complete_and_shows_cost():
    report = render_delivery_report_fa(_summary())

    assert "تحویل کامل" in report
    assert "هزینهٔ کل: 0.42 دلار" in report


def test_failed_stage_needs_attention_and_is_incomplete():
    summary = _summary(failed=["review"])
    summary["stages"]["review"] = "failed"

    report = render_delivery_report_fa(summary)

    assert "نیازمند توجه" in report
    assert "ناقص" in report


def test_deploy_sha_is_truncated_and_stages_have_fixed_order():
    report = render_delivery_report_fa(_summary(), deploy_sha="1234567890abcdef")

    assert "نسخهٔ استقرار: 1234567890ab" in report
    labels = (
        "دریافت درخواست", "پژوهش", "تأیید", "برنامه‌ریزی", "پیاده‌سازی",
        "بازبینی", "پیش‌نمایش", "استقرار", "راستی‌آزمایی", "گزارش",
    )
    assert [line.split(":")[0] for line in report.splitlines()[1:11]] == list(labels)
