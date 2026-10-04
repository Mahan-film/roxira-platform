"""Pure helpers for the Smart Judge chat path (no I/O, no import-time effects).

* ``to_latin_digits``: Persian/Arabic-Indic digits -> 0-9 for user-facing text.
* ``is_grounded``: did retrieval return real corpus rows (placeholder
  ``FALLBACK`` rows do not count)?
* ``finalize_general_knowledge_answer``: wraps a model answer produced WITHOUT
  corpus grounding: strips article numbers the citation guard did not verify,
  then prepends the fixed general-knowledge notice and appends the disclaimer.

Smart Judge is a non-binding AI assistant, never a judge.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, List

_DIGIT_TRANS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

LATIN_DIGITS_INSTRUCTION = (
    "همهٔ ارقام را فقط با ارقام لاتین 0-9 بنویس (Use Latin digits 0-9 only)."
)

GENERAL_KNOWLEDGE_NOTICE = (
    "توجه: این پاسخ بر اساس دانش حقوقی عمومی است و خارج از پیکرهٔ قوانین "
    "تأییدشدهٔ ما قرار دارد؛ مستند به متن قانونی راستی‌آزمایی‌شده نیست."
)

GENERAL_KNOWLEDGE_INSTRUCTION = (
    "مادهٔ قانونی مرتبطی در پایگاه دانش یافت نشد. با اتکا به دانش حقوقی عمومی "
    "خود پاسخ بده و پاسخ را رد نکن، اما شمارهٔ ماده یا شمارهٔ رأی مشخص "
    "ذکر نکن و فقط به‌صورت کلی به اصول و نهادهای حقوقی اشاره کن."
)

CHAT_DISCLAIMER = (
    "این پاسخ توسط هوش مصنوعی تهیه شده، مشاورهٔ حقوقی قطعی یا رأی قضایی "
    "نیست و باید توسط وکیل یا مرجع صالح بررسی شود."
)

UNVERIFIED_ARTICLE_MARK = "ماده [تأییدنشده]"

_ARTICLE_RE = re.compile(r"ماده(?:\s*ی|\s*ٔ)?\s*(\d+)(\s*مکرر)?")


def to_latin_digits(text: Any) -> Any:
    """Convert ۰-۹ and ٠-٩ to 0-9 in strings; non-strings are returned as is."""
    if not isinstance(text, str):
        return text
    return text.translate(_DIGIT_TRANS)


def is_grounded(laws: Any, precedents: Any = None) -> bool:
    """True when retrieval gave at least one real (non-placeholder) row."""
    for rows in (laws, precedents):
        for row in rows or []:
            if isinstance(row, dict) and str(row.get("match_level") or "") != "FALLBACK":
                return True
    return False


def _verified_numbers(validated: Iterable[Any]) -> set:
    numbers = set()
    for entry in validated or []:
        if not isinstance(entry, dict):
            continue
        raw = entry.get("article", entry.get("article_no"))
        digits = re.sub(r"\D", "", to_latin_digits(str(raw or "")))
        if digits:
            numbers.add(str(int(digits)))
    return numbers


def strip_unverified_articles(text: str, validated: Iterable[Any]) -> str:
    """Replace every «ماده N» not in the verified set with a neutral mark."""
    verified = _verified_numbers(validated)
    source = to_latin_digits(text or "")

    def _sub(match: "re.Match[str]") -> str:
        if str(int(match.group(1))) in verified:
            return match.group(0)
        return UNVERIFIED_ARTICLE_MARK

    return _ARTICLE_RE.sub(_sub, source)


def finalize_general_knowledge_answer(answer: str, validated: Iterable[Any]) -> str:
    """Notice + answer (unverified articles stripped) + disclaimer, Latin digits."""
    body = strip_unverified_articles(answer or "", validated).strip()
    parts: List[str] = [GENERAL_KNOWLEDGE_NOTICE, body, CHAT_DISCLAIMER]
    return "\n\n".join(p for p in parts if p)
