"""Persian renderer for a factory run's final delivery report."""

_STAGES = (
    ("intake", "دریافت درخواست"),
    ("research", "پژوهش"),
    ("approval", "تأیید"),
    ("plan", "برنامه‌ریزی"),
    ("task", "پیاده‌سازی"),
    ("review", "بازبینی"),
    ("preview", "پیش‌نمایش"),
    ("deploy", "استقرار"),
    ("verify", "راستی‌آزمایی"),
    ("report", "گزارش"),
)
_STATUS = {
    "ok": "انجام شد",
    "failed": "ناموفق",
    "started": "در جریان",
    "skipped": "رد شد",
}


def render_delivery_report_fa(
    summary: dict, preview_url: str | None = None, deploy_sha: str | None = None
) -> str:
    """Render a ledger summary as a human-readable Persian delivery report."""
    stages = summary.get("stages", {})
    failed = summary.get("failed", [])
    labels = dict(_STAGES)
    lines = [f"گزارش تحویل — اجرای {summary['run_id']}"]

    for stage, label in _STAGES:
        status = stages.get(stage)
        lines.append(f"{label}: {_STATUS.get(status, 'بدون سابقه')}")

    if failed:
        lines.append(
            "نیازمند توجه: " + "، ".join(labels.get(stage, stage) for stage in failed)
        )
    if preview_url:
        lines.append(f"پیش‌نمایش: {preview_url}")
    if deploy_sha:
        lines.append(f"نسخهٔ استقرار: {deploy_sha[:12]}")
    lines.append(f"هزینهٔ کل: {summary['total_cost_usd']:.2f} دلار")

    complete = not failed and all(stages.get(stage) == "ok" for stage, _ in _STAGES)
    lines.append("وضعیت نهایی: تحویل کامل" if complete else "وضعیت نهایی: ناقص")
    return "\n".join(lines)
