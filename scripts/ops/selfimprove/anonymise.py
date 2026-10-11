"""Anonymiser for customer chat text. Stdlib only, no imports from the repo.

This file is also piped into `docker exec -i roxira_app_prod python3 -` together with
db_extract.py, so it must stay self-contained and define everything at module level.
Raw user text must pass through anonymise_text() before it leaves the DB-reading step.
"""
import re

_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_URL = re.compile(r"(?i)\b(?:https?://|www\.)\S+")
_SHEBA = re.compile(r"(?i)\bIR\s?\d{2}(?:\s?\d{4}){5}\s?\d{0,2}\b")
_PHONE = re.compile(r"(?<!\d)(?:\+?98|0098|0)?[\s-]?9\d{2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)")
_LANDLINE = re.compile(r"(?<!\d)0\d{2}[\s-]?\d{8}(?!\d)")
_NATIONAL_ID = re.compile(r"(?<!\d)\d{10}(?!\d)")
_LONG_NUM = re.compile(r"(?<!\d)\d{5,}(?!\d)")  # card numbers, case/file numbers, accounts
_TITLE = r"(?:آقای|اقای|خانم|جناب|سرکار|دکتر|مهندس|استاد|حاج|حاجی|سید|آقا|اقا)"
_NAME_AFTER_TITLE = re.compile(_TITLE + r"\s+(?:[^\W\d_]{2,}\s?){1,2}")
_NAME_INTRO = re.compile(
    r"(?:(?:اسم|نام)(?:\s+و\s+نام\s+خانوادگی)?\s+(?:من|ایشان|موکل(?:م)?)\s+|نام\s+خانوادگی(?:\s+من)?\s*[:=]?\s*"
    r"|my\s+name\s+is\s+)(?:[^\W\d_]{2,}\s?){1,3}", re.IGNORECASE)
_NAME_HASTAM = re.compile(r"\bمن\s+(?:[^\W\d_]{2,}\s){1,2}هستم")
_SPACES = re.compile(r"\s+")


def normalise_digits(text: str) -> str:
    return str(text or "").translate(_DIGITS)


def anonymise_text(text: str, limit: int = 300) -> str:
    """Replace phones, national ids, long numbers, e-mails, URLs and likely personal names."""
    t = normalise_digits(text)
    t = _EMAIL.sub("[email]", t)
    t = _URL.sub("[url]", t)
    t = _SHEBA.sub("[iban]", t)
    t = _PHONE.sub("[phone]", t)
    t = _LANDLINE.sub("[phone]", t)
    t = _NATIONAL_ID.sub("[id]", t)
    t = _LONG_NUM.sub("[num]", t)
    t = _NAME_INTRO.sub("[name] ", t)
    t = _NAME_AFTER_TITLE.sub("[name] ", t)
    t = _NAME_HASTAM.sub("[name]", t)
    t = _SPACES.sub(" ", t).strip()
    return t[:limit]
