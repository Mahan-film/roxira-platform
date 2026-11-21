"""Deterministic Persian & Latin PII scrubber (T239 / #978).

Applied before every external LLM, STT, TTS, or judge call from Smart Judge
and the phone/voice agent. Replaces sensitive identifiers with typed
placeholders and restores them in the answer where needed.

Logs ONLY redaction counts per category — NEVER raw values.
"""
from __future__ import annotations

import copy
import logging
import re
from typing import Any, Dict, List, Tuple

logger = logging.getLogger("smartjudge.security.pii_scrubber")

_DIGIT_TRANS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_D = r"[0-9۰-۹٠-٩]"


def normalize_digits(text: str) -> str:
    """Convert Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII 0-9."""
    return text.translate(_DIGIT_TRANS)


def is_valid_iranian_national_id(raw: str) -> bool:
    """Validate a 10-digit Iranian National ID (کدملی) using its official checksum."""
    digits = normalize_digits(raw)
    if len(digits) != 10 or not digits.isdigit():
        return False
    if len(set(digits)) == 1:
        return False
    total = sum(int(digits[i]) * (10 - i) for i in range(9))
    rem = total % 11
    check = int(digits[9])
    return (rem < 2 and check == rem) or (rem >= 2 and check == 11 - rem)


_IBAN_RE = re.compile(rf"(?<![A-Za-z0-9])IR(?:[-\s]?{_D}){{24}}(?!{_D})", re.IGNORECASE)
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_CASE_LABELLED_RE = re.compile(
    rf"(?P<prefix>(?:شماره\s*پرونده|پرونده\s*شماره|کلاسه\s*پرونده|کلاسه|شماره\s*بایگانی|case\s*(?:no\.?|number|#)?)\s*[:：#\-]?\s*)"
    rf"(?P<num>{_D}{{5,16}}(?:[/\-]{_D}{{1,6}})*)",
    re.IGNORECASE,
)
_CASE_CMS_RE = re.compile(rf"(?<!{_D})(?:[9۹]{_D}|[1۱][34۳۴]{_D}{{2}})[0۰][9۹]{{2}}[8۸]{_D}{{8,10}}(?!{_D})")
_CARD_RE = re.compile(rf"(?<!{_D})(?:{_D}{{4}}[-\s]?){{3}}{_D}{{4}}(?!{_D})")
_MOBILE_RE = re.compile(rf"(?<!{_D})(?:(?:\+|00|۰۰|٠٠)[9۹٩][8۸٨]|[0۰٠])?[-\s]?[9۹٩]{_D}{{2}}[-\s]?{_D}{{3}}[-\s]?{_D}{{4}}(?!{_D})")
_LANDLINE_RE = re.compile(rf"(?<!{_D})(?:(?:\+[9۹٩][8۸٨]|(?:00|۰۰|٠٠)[9۹٩][8۸٨]|[0۰٠])[1-8۱-۸١-٨]{_D})[-\s]?{_D}{{7,8}}(?!{_D})")
_NATIONAL_ID_RE = re.compile(rf"(?<!{_D}){_D}{{10}}(?!{_D})")
_PARTY_RE = re.compile(
    r"(?P<role>خواهان|خوانده|شاکی|مشتکی‌عنه|متهم|محکوم‌له|محکوم‌علیه|موکل|تجدیدنظرخواه|تجدیدنظرخوانده)\s*"
    r"(?P<title>آقای|خانم)?\s+(?P<name>[\u0600-\u06FF\s]{3,30}?)"
    r"(?=\s+(?:فرزند|به\s+شماره|دارای|به\s+کدملی|ساکن|با\s+وکالت|و\s+|$))"
)


def log_redaction_counts(counts: Dict[str, int], context: str = "") -> None:
    """Log only non-zero PII redaction counts, never raw values."""
    non_zero = {k: v for k, v in counts.items() if v > 0}
    if not non_zero:
        return
    total = sum(non_zero.values())
    logger.info("pii_scrub context=%s total=%d counts=%s", context or "default", total, non_zero)


def scrub_pii_with_counts(
    text: str,
    *,
    mapping: Dict[str, str] | None = None,
    counters: Dict[str, int] | None = None,
    context: str = "",
) -> Tuple[str, Dict[str, str], Dict[str, int]]:
    """Deterministically scrub Persian/Latin PII from ``text``.

    Returns ``(scrubbed_text, mapping, counts)``. Only counts are logged.
    """
    if not text:
        empty_counts = {
            "nid": 0, "mobile": 0, "landline": 0, "iban": 0,
            "card": 0, "case_number": 0, "email": 0, "party": 0,
        }
        return text, (mapping if mapping is not None else {}), empty_counts

    if mapping is None:
        mapping = {}
    if counters is None:
        counters = {
            "nid": 0, "mobile": 0, "landline": 0, "iban": 0,
            "card": 0, "case_number": 0, "email": 0, "party": 0,
        }
    local_counts = {k: 0 for k in counters}

    def _record(key: str, label: str, original: str) -> str:
        counters[key] += 1
        local_counts[key] += 1
        ph = f"[{label}_{counters[key]}]"
        mapping[ph] = original
        return ph

    def _sub_iban(m: re.Match) -> str:
        return _record("iban", "شبا", m.group(0))

    def _sub_email(m: re.Match) -> str:
        return _record("email", "ایمیل", m.group(0))

    def _sub_case_labelled(m: re.Match) -> str:
        ph = _record("case_number", "شماره_پرونده", m.group("num"))
        return f"{m.group('prefix')}{ph}"

    def _sub_case_cms(m: re.Match) -> str:
        return _record("case_number", "شماره_پرونده", m.group(0))

    def _sub_card(m: re.Match) -> str:
        return _record("card", "شماره_کارت", m.group(0))

    def _sub_mobile(m: re.Match) -> str:
        return _record("mobile", "شماره_همراه", m.group(0))

    def _sub_landline(m: re.Match) -> str:
        return _record("landline", "تلفن_ثابت", m.group(0))

    def _sub_nid(m: re.Match) -> str:
        candidate = m.group(0)
        if not is_valid_iranian_national_id(candidate):
            return candidate
        return _record("nid", "کدملی", candidate)

    def _sub_party(m: re.Match) -> str:
        role = m.group("role")
        title = m.group("title") or ""
        name = m.group("name").strip()
        ph = _record("party", role, name)
        parts = [role, title, ph]
        return " ".join(p for p in parts if p)

    # Order matters: longest / most specific patterns first to avoid partial overlaps.
    text = _IBAN_RE.sub(_sub_iban, text)
    text = _EMAIL_RE.sub(_sub_email, text)
    text = _CASE_LABELLED_RE.sub(_sub_case_labelled, text)
    text = _CASE_CMS_RE.sub(_sub_case_cms, text)
    text = _CARD_RE.sub(_sub_card, text)
    text = _MOBILE_RE.sub(_sub_mobile, text)
    text = _LANDLINE_RE.sub(_sub_landline, text)
    text = _NATIONAL_ID_RE.sub(_sub_nid, text)
    text = _PARTY_RE.sub(_sub_party, text)

    if context:
        log_redaction_counts(local_counts, context=context)

    return text, mapping, local_counts


def mask_pii_entities(text: str) -> Tuple[str, Dict[str, str]]:
    """Backward-compatible wrapper returning ``(scrubbed_text, mapping)``."""
    scrubbed, mapping, _ = scrub_pii_with_counts(text)
    return scrubbed, mapping


def unmask_pii_entities(text: str, mapping: Dict[str, str]) -> str:
    """Restore typed placeholders in ``text`` using ``mapping``."""
    if not text or not mapping:
        return text
    for placeholder, original in mapping.items():
        text = text.replace(placeholder, original)
    return text


def scrub_messages(
    messages: List[Dict[str, Any]],
    *,
    context: str = "llm",
) -> Tuple[List[Dict[str, Any]], Dict[str, str], Dict[str, int]]:
    """Deep-copy and scrub all text content in an OpenAI-style messages list.

    Returns ``(scrubbed_messages, mapping, total_counts)``. Logs counts only.
    """
    mapping: Dict[str, str] = {}
    counters: Dict[str, int] = {
        "nid": 0, "mobile": 0, "landline": 0, "iban": 0,
        "card": 0, "case_number": 0, "email": 0, "party": 0,
    }
    scrubbed: List[Dict[str, Any]] = []
    for msg in messages:
        new_msg = copy.deepcopy(msg)
        content = new_msg.get("content")
        if isinstance(content, str):
            new_msg["content"], mapping, _ = scrub_pii_with_counts(
                content, mapping=mapping, counters=counters
            )
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    part["text"], mapping, _ = scrub_pii_with_counts(
                        part["text"], mapping=mapping, counters=counters
                    )
        scrubbed.append(new_msg)

    log_redaction_counts(counters, context=context)
    return scrubbed, mapping, counters
