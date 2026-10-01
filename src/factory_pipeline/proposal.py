"""Turn a `run_project_brief()` result (src/automation/project_brief.py) into
the Persian issue comment posted at the end of factory-research.yml (Project
Factory stage 2: 2-3 stack options per layer with scores, monthly cost
estimate, risks, and a recommended option). The full report/JSON is uploaded
as a workflow artifact separately; this comment is a condensed, readable
version kept well under GitHub's 65536-char issue-comment limit.
"""

from __future__ import annotations

from typing import Any

GITHUB_COMMENT_CHAR_LIMIT = 65536
_SAFE_CHAR_BUDGET = 60000
_TRUNCATION_NOTE = (
    "\n\n... (خلاصه به دلیل محدودیت طول کامنت کوتاه شد؛ گزارش کامل در artifact این اجرا موجود است)"
)

# Hidden HTML comment so factory_plan.py (stage 4) can reliably find the most
# recent proposal among an issue's comments -- including a stray owner reply
# containing the same visible heading -- without depending on comment order
# alone. Invisible in GitHub's rendered markdown.
PROPOSAL_MARKER = "<!-- roxira-factory-proposal -->"


def _short_title(idea: str, limit: int = 120) -> str:
    """Return the concise title portion of a Factory subject."""
    return idea.split(" — ", 1)[0].strip()[:limit]


def _format_layer_section(layer: dict[str, Any]) -> list[str]:
    lines = [f"### {layer.get('label_fa') or layer.get('layer', '')} ({layer.get('label_en', '')})"]
    status = layer.get("status", "UNKNOWN")
    if status != "SUCCESS":
        lines.append(f"وضعیت: `{status}`")
    alternatives = layer.get("alternatives") or []
    if not alternatives:
        lines.append("گزینه‌ای یافت نشد.")
        return lines
    recommended = layer.get("recommended")
    for alt in alternatives[:3]:
        if not isinstance(alt, dict):
            continue
        name = alt.get("name", "")
        score = alt.get("adoption_score", "؟")
        cost = alt.get("monthly_cost_usd_estimate") or "نامشخص"
        risks = "، ".join(alt.get("risks") or []) or "—"
        marker = "⭐ " if name and name == recommended else "- "
        lines.append(
            f"{marker}**{name}** — امتیاز پذیرش: {score}/10، هزینه ماهانه: {cost}، ریسک: {risks}"
        )
    if recommended:
        lines.append(f"توصیه: **{recommended}** — {layer.get('recommendation_reason', '')}")
    return lines


def format_proposal_comment(
    brief_result: dict[str, Any],
    *,
    char_budget: int = _SAFE_CHAR_BUDGET,
    artifact_note: str = (
        "گزارش کامل این تحقیق به‌صورت artifact این اجرا در تب Actions پیوست شده است."
    ),
) -> str:
    idea = brief_result.get("idea", "")
    final = brief_result.get("final") or {}
    layers = brief_result.get("layers") or []
    status = brief_result.get("status", "UNKNOWN")
    cost = brief_result.get("total_cost_usd", 0.0) or 0.0

    lines = [
        PROPOSAL_MARKER,
        f"## پیشنهاد فناوری برای: {_short_title(idea)}",
        "",
        f"وضعیت تحقیق: `{status}` — هزینه: ${cost:.4f}",
        "",
    ]

    if final.get("executive_summary"):
        lines += ["### خلاصه مدیریتی", final["executive_summary"], ""]

    if final.get("total_monthly_cost_usd_estimate"):
        lines += [
            f"**برآورد هزینه ماهانه کل استک:** {final['total_monthly_cost_usd_estimate']}",
            "",
        ]

    if final.get("cross_layer_risks"):
        lines += ["### ریسک‌های بین‌لایه‌ای", *[f"- {r}" for r in final["cross_layer_risks"]], ""]

    lines += ["### گزینه‌ها به تفکیک لایه", ""]
    for layer in layers:
        lines += _format_layer_section(layer)
        lines.append("")

    if final.get("open_questions_for_owner"):
        lines += [
            "### سوالات باز برای مالک پروژه",
            *[f"- {q}" for q in final["open_questions_for_owner"]],
            "",
        ]

    lines += [
        "---",
        artifact_note,
        "",
        "برای شروع ساخت، کامنت `/approve` (پذیرش گزینه توصیه‌شده) یا "
        "`/approve <نام گزینه>` بگذارید، یا لیبل `approved` را اضافه کنید. "
        "پیش از این کامنت چیزی ساخته نمی‌شود.",
    ]

    text = "\n".join(lines)
    if len(text) > char_budget:
        text = text[: char_budget - len(_TRUNCATION_NOTE)] + _TRUNCATION_NOTE
    return text
