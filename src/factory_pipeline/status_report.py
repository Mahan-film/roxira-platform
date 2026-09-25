"""Persian `/status` reply builder for a Project Factory parent issue (stage 6).

Pure formatting only: `output_apps/ecosystem_core/src/factory/factory_status.py`
gathers child-issue/PR state and OpenRouter spend, then calls
`format_status_comment()`. Also used by factory_plan.py / factory_dispatch_next.py
to render the progress checklist posted/edited on the parent issue.
"""

from __future__ import annotations

from typing import Any

_STATUS_ICON = {"done": "✅", "in_progress": "🟨", "open": "⬜", "blocked": "⛔"}


def format_progress_checklist(idea: str, tasks: list[dict[str, Any]]) -> str:
    """`tasks`: [{"title": str, "issue": int, "status": one of _STATUS_ICON,
    "pr_url": str | None}, ...] in plan (build) order."""
    done = sum(1 for t in tasks if t["status"] == "done")
    lines = [f"## پیشرفت ساخت: {idea}", "", f"{done} از {len(tasks)} وظیفه تکمیل شده.", ""]
    for t in tasks:
        mark = _STATUS_ICON.get(t["status"], "⬜")
        line = f"- {mark} #{t['issue']}: {t['title']}"
        if t.get("pr_url"):
            line += f" — [PR]({t['pr_url']})"
        lines.append(line)
    return "\n".join(lines)


def format_status_comment(
    *,
    idea: str,
    tasks: list[dict[str, Any]],
    spend_usd: float | None,
    budget_usd: float | None,
    open_prs: list[str] | None = None,
) -> str:
    lines = [format_progress_checklist(idea, tasks), ""]

    open_prs = open_prs or []
    if open_prs:
        lines.append("### PR های باز")
        lines.extend(f"- {url}" for url in open_prs)
        lines.append("")

    if spend_usd is not None and budget_usd is not None:
        lines.append(
            f"هزینه صرف‌شده امروز (کلید OpenRouter عامل‌ها): "
            f"${spend_usd:.2f} از سقف ${budget_usd:.2f}."
        )
    elif spend_usd is not None:
        lines.append(f"هزینه صرف‌شده: ${spend_usd:.2f}.")
    else:
        lines.append("هزینه صرف‌شده: در حال حاضر قابل استعلام نبود.")
    return "\n".join(lines)
