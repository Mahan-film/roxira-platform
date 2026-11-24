"""
Catalog Intent Recognition & Meta-Retrieval Helper for SmartJudge.
Detects queries asking for 'the latest / newest / last unity ruling or regulation'
and provides deterministic, hallucination-free catalog retrieval.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger("smartjudge.catalog_intent")

_DIGIT_TRANS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

# Match patterns for "latest / newest / last number" of rulings
_LATEST_KW = r"(?:آخرین|جدیدترین|تازه‌ترین|تازه ترین|اخرین|واپسین|\bآخر\b|\bاخر\b)"
_UNITY_KW = r"(?:وحدت\s*رویه|رای\s*وسط\s*روی|آرای\s*وحدت\s*رویه|ارای\s*وحدت\s*رویه)"
_SUPREME_KW = r"(?:دیوان\s*عالی(?:\s*کشور)?|دیوان\s*آلی(?:\s*کشور)?)"
_ADMIN_KW = r"(?:دیوان\s*عدالت(?:\s*اداری)?|هیئت\s*عمومی\s*دیوان\s*عدالت)"
_REG_KW = r"(?:بخشنامه|مصوبه|مقررات|تصویب‌نامه|تصویب\s*نامه|آیین‌نامه|آیین\s*نامه|نظریه(?:\s*مشورتی)?)"

_RE_LATEST_UNITY = re.compile(
    rf"(?:{_LATEST_KW}.*?{_UNITY_KW}|{_UNITY_KW}.*?{_LATEST_KW}|{_LATEST_KW}.*?{_SUPREME_KW}.*?ر[اأ]ی|شماره.*?(?:آخرین|اخرین|جدیدترین).*?{_UNITY_KW})",
    re.UNICODE | re.IGNORECASE,
)
_RE_LATEST_ADMIN = re.compile(
    rf"(?:{_LATEST_KW}.*?{_ADMIN_KW}|{_ADMIN_KW}.*?{_LATEST_KW})",
    re.UNICODE | re.IGNORECASE,
)
_RE_LATEST_REG = re.compile(
    rf"(?:{_LATEST_KW}.*?{_REG_KW}|{_REG_KW}.*?{_LATEST_KW})",
    re.UNICODE | re.IGNORECASE,
)

_RE_NUMBER_QUERY = re.compile(
    r"(?:شمار[هۀ]?|شماره[‌\s]*چند|چند\s*بوده|کدام\s*است|چیست|چی\s*بوده)",
    re.UNICODE | re.IGNORECASE,
)


def _norm(text: str) -> str:
    s = str(text or "").translate(_DIGIT_TRANS)
    s = s.replace("ي", "ی").replace("ك", "ک").replace("‌", " ").replace("ٔ", "").replace("ة", "ه").replace("ئ", "ی").replace("أ", "ا").replace("إ", "ا").replace("ؤ", "و")
    return re.sub(r"\s+", " ", s).strip()


_ISSUER_PATTERNS = [
    ("بانک مرکزی", re.compile(r"(?:بانک\s*مرکزی(?:\s*جمهوری\s*اسلامی(?:\s*ایران)?)?|cbi)", re.UNICODE | re.IGNORECASE)),
    ("رئیس قوه قضاییه", re.compile(r"(?:رییس\s*قوه\s*قضاییه|ریاست\s*قوه\s*قضاییه|رییس\s*دستگاه\s*قضا)", re.UNICODE | re.IGNORECASE)),
    ("اداره حقوقی قوه قضاییه", re.compile(r"(?:اداره\s*(?:کل\s*)?حقوقی(?:\s*قوه\s*قضاییه)?)", re.UNICODE | re.IGNORECASE)),
    ("هیئت مقررات‌زدایی", re.compile(r"(?:هی[ییت]\s*مقررات\s*زدایی|مقررات\s*زدایی)", re.UNICODE | re.IGNORECASE)),
    ("سازمان امور مالیاتی", re.compile(r"(?:(?:سازمان\s*)?امور\s*مالیاتی|سازمان\s*مالیاتی)", re.UNICODE | re.IGNORECASE)),
    ("سازمان ثبت اسناد", re.compile(r"(?:(?:سازمان\s*)?ثبت\s*اسناد(?:\s*و\s*املاک)?)", re.UNICODE | re.IGNORECASE)),
    ("سازمان تامین اجتماعی", re.compile(r"(?:(?:سازمان\s*)?تامین\s*اجتماعی)", re.UNICODE | re.IGNORECASE)),
    ("دیوان عدالت اداری", re.compile(r"(?:دیوان\s*عدالت(?:\s*اداری)?)", re.UNICODE | re.IGNORECASE)),
]


def detect_issuer(text: str) -> Optional[str]:
    """Detect issuing authority in query text using normalized Persian matching."""
    norm_text = _norm(text)
    for canonical, pat in _ISSUER_PATTERNS:
        if pat.search(norm_text):
            return canonical
    return None


def detect(user_text: str) -> Optional[Dict[str, Any]]:
    """Detect meta-queries for latest rulings/regulations."""
    if not user_text:
        return None
    if len(user_text.strip()) > 300:
        logger.debug("catalog_intent: query length %d exceeds threshold, skipping meta detection", len(user_text))
        return None

    norm_text = _norm(user_text)

    if _RE_LATEST_UNITY.search(norm_text):
        is_num_ask = bool(_RE_NUMBER_QUERY.search(norm_text))
        return {
            "intent": "latest_ruling",
            "target": "unity_supreme_court",
            "sub_collection": "unity_rulings",
            "is_number_ask": is_num_ask,
        }

    if _RE_LATEST_ADMIN.search(norm_text):
        is_num_ask = bool(_RE_NUMBER_QUERY.search(norm_text))
        return {
            "intent": "latest_ruling",
            "target": "admin_court",
            "sub_collection": "admin_court_board",
            "is_number_ask": is_num_ask,
        }

    if _RE_LATEST_REG.search(norm_text):
        issuer = detect_issuer(norm_text)
        is_num_ask = bool(re.search(r"شمار[هۀ]", norm_text) and _RE_NUMBER_QUERY.search(norm_text))
        return {
            "intent": "latest_regulation",
            "target": "regulation",
            "sub_collection": "regulations",
            "issuer": issuer,
            "is_number_ask": is_num_ask,
        }

    return None


def build_catalog_context(catalog_rows: List[Dict[str, Any]], target: str = "unity_supreme_court") -> str:
    """Deterministic context block for the prompt."""
    if not catalog_rows:
        return ""
    lines = []
    for r in catalog_rows[:5]:
        title = r.get("title") or (
            f"بخشنامه شماره {r.get('number')}" if target == "regulation" else f"رأی شماره {r.get('number')}"
        )
        date = r.get("date") or ""
        subject = r.get("subject") or r.get("summary") or ""
        body = r.get("issuer") or r.get("issuing_body") or ""
        line = f"- {title} (تاریخ: {date}، مرجع: {body}): {subject[:250]}"
        lines.append(line)

    if target == "unity_supreme_court":
        target_fa = "آرای وحدت رویه دیوان عالی کشور"
    elif target == "regulation":
        target_fa = "بخشنامه‌ها و مقررات اجرایی"
    else:
        target_fa = "آرای هیئت عمومی دیوان عدالت اداری"
    return f"\nفهرست قطعی و معتبر از پایگاه داده سامانه ({target_fa}):\n" + "\n".join(lines) + "\n"


def format_deterministic_answer(
    catalog_rows: List[Dict[str, Any]],
    target: str = "unity_supreme_court",
    is_voice: bool = True,
) -> str:
    """Format a 100% verified, hallucination-free direct answer for meta-queries."""
    if not catalog_rows:
        if target == "regulation":
            return "در حال حاضر اطلاعات مربوط به آخرین بخشنامه یا مقرره از پایگاه داده سامانه قابل استعلام نیست."
        return "در حال حاضر اطلاعات مربوط به آخرین رأی از پایگاه داده سامانه قابل استعلام نیست."

    top = catalog_rows[0]
    num = top.get("number") or ""
    date = top.get("date") or ""
    body = top.get("issuer") or top.get("issuing_body") or ("مرجع رسمی" if target == "regulation" else "دیوان عالی کشور")
    subject = (top.get("subject") or top.get("summary") or "").strip()
    if len(subject) > 200:
        subject = subject[:197] + "…"

    if is_voice:
        if target == "regulation":
            issuer_part = f" {body}" if body else ""
            ans = f"پاسخ: آخرین بخشنامه یا مقرره{issuer_part} در پایگاه داده، شماره {num} مورخ {date} است."
        elif target == "unity_supreme_court":
            ans = f"پاسخ: آخرین رأی وحدت رویه هیئت عمومی دیوان عالی کشور در پایگاه داده، رأی شماره {num} مورخ {date} است."
        else:
            ans = f"پاسخ: آخرین دادنامه هیئت عمومی دیوان عدالت اداری در پایگاه داده، شماره {num} مورخ {date} است."
        if subject:
            ans += f" موضوع در خصوص {subject} می‌باشد."
        return ans

    # Text mode answer
    title = top.get("title") or (f"بخشنامه شماره {num}" if target == "regulation" else f"رأی شماره {num}")
    ans = f"**پاسخ مستقیم:**\nمطابق داده‌های ثبت‌شده در پایگاه رسمی سامانه، آخرین {title} مورخ **{date}** می‌باشد.\n\n"
    if subject:
        ans += f"**خلاصه موضوع:**\n{subject}\n\n"
    ans += "این مورد بر اساس آخرین به‌روزرسانی سامانه ارائه گردیده است."
    return ans
