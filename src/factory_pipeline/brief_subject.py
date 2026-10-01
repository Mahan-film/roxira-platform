"""Build concise Factory research inputs from GitHub issue forms."""

import re


LAYERS = (
    "ui_ux", "frontend", "backend", "infra_server", "database_sql",
    "ai_models", "observability", "security", "cost",
)


def _section(body: str, heading: str) -> str:
    match = re.search(
        rf"^###[^\n]*{re.escape(heading)}[^\n]*(?:\n|$)(.*?)(?=^###|\Z)",
        body,
        re.MULTILINE | re.DOTALL,
    )
    return re.sub(r"\s+", " ", match.group(1)).strip() if match else ""


def build_subject(title: str, body: str, max_chars: int = 900) -> str:
    """Return the title plus the issue goal and, where possible, must-haves."""
    goal = (_section(body, "هدف پروژه") or re.sub(r"\s+", " ", body).strip())[:400]
    must_haves = _section(body, "ویژگی‌های ضروری")
    stack = _section(body, "استک فناوری ترجیحی")
    tail = f". ویژگی‌های ضروری: {must_haves}" if must_haves else ""
    if stack and stack != "_No response_":
        tail += f". استک ترجیحی مالک: {stack}"
    subject = f"{title} — {goal[:max(0, max_chars - len(title) - 3 - len(tail))]}{tail}"
    return subject[:max_chars]


def pick_layers(body: str) -> list[str]:
    """Choose radar layers while retaining the Factory baseline layers."""
    remove: set[str] = set()
    lowered = body.lower()
    if "ایستا" in body or "static" in lowered:
        remove.update(("backend", "database_sql", "ai_models", "observability", "security"))
    if "بدون پایگاه داده" in body:
        remove.add("database_sql")
    if "بدون ورود" in body:
        remove.add("security")
    return [layer for layer in LAYERS if layer not in remove]
