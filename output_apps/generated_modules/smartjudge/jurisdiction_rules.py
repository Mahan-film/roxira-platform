"""Load jurisdiction rules maintained as repository data."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import re

import yaml

try:
    from . import court_catalog as _courts
except ImportError:  # pragma: no cover - script/flat import
    from output_apps.generated_modules.smartjudge import court_catalog as _courts


_REQUIRED_KEYS = {
    "id",
    "forum",
    "matter",
    "threshold_rials",
    "legal_basis",
    "source_url",
    "status",
    "note",
}
_ALLOWED_STATUSES = {"confirmed", "needs_lawyer", "superseded"}
_ALLOWED_CONFIDENCE = {"high", "medium", "low"}
_OPTIONAL_STR_KEYS = ("court_key", "above_court_key", "basis_article", "confidence", "above_confidence")
_THRESHOLD_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_DEFAULT_RULES_PATH = Path(__file__).resolve().parents[3] / "config" / "jurisdiction_rules.yaml"


def _parse_threshold(value: Any) -> int | None:
    """None, a real int, or a digit string with ,/٬/_/space separators (Persian digits ok) -> int."""
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError("threshold_rials must be an integer or null")
    if isinstance(value, int):
        number = value
    elif isinstance(value, str):
        cleaned = value.translate(_THRESHOLD_DIGITS)
        for sep in (",", "٬", "_", " ", "\u200c"):
            cleaned = cleaned.replace(sep, "")
        if not cleaned.isascii() or not cleaned.isdigit():
            raise ValueError("threshold_rials must be an integer or null")
        number = int(cleaned)
    else:
        raise ValueError("threshold_rials must be an integer or null")
    if number < 0:
        raise ValueError("threshold_rials must not be negative")
    return number


def load_rules(path: str | Path | None = None) -> list[dict[str, Any]]:
    """Load and validate jurisdiction rules from YAML, using a path-based cache."""
    rules_path = _DEFAULT_RULES_PATH if path is None else Path(path)
    return _load_rules(str(rules_path.resolve()))


@lru_cache(maxsize=None)
def _load_rules(path: str) -> list[dict[str, Any]]:
    with Path(path).open(encoding="utf-8") as rules_file:
        document = yaml.safe_load(rules_file)

    if not isinstance(document, dict) or not isinstance(document.get("rules"), list):
        raise ValueError("Jurisdiction rules YAML must contain a rules list")

    rules = document["rules"]
    seen_ids: set[Any] = set()
    for rule in rules:
        if not isinstance(rule, dict) or not _REQUIRED_KEYS.issubset(rule):
            raise ValueError("Each jurisdiction rule must include all required keys")

        rule_id = rule["id"]
        if not isinstance(rule_id, str):
            raise ValueError("Jurisdiction rule id must be a string")
        if rule_id in seen_ids:
            raise ValueError(f"Duplicate jurisdiction rule id: {rule_id}")
        seen_ids.add(rule_id)

        rule["threshold_rials"] = _parse_threshold(rule["threshold_rials"])
        if not isinstance(rule["status"], str) or rule["status"] not in _ALLOWED_STATUSES:
            raise ValueError("Jurisdiction rule status is invalid")
        for key in _OPTIONAL_STR_KEYS:
            if rule.get(key) is not None and not isinstance(rule[key], str):
                raise ValueError(f"{key} must be a string")
        for key in ("confidence", "above_confidence"):
            if rule.get(key) is not None and rule[key] not in _ALLOWED_CONFIDENCE:
                raise ValueError(f"{key} is invalid")
        for key in ("court_key", "above_court_key"):
            if rule.get(key) is not None and rule[key] not in _courts.COURT_CATALOG:
                raise ValueError(f"{key} is not a catalog court")

    return rules


def confirmed_rules() -> list[dict[str, Any]]:
    """Return the currently confirmed jurisdiction rules."""
    return [rule for rule in load_rules() if rule["status"] == "confirmed"]


# --------------------------------------------------------------------------
# Court suggestion (deterministic, no LLM). Every threshold, court and article
# comes from config/jurisdiction_rules.yaml; this code only compares and formats.
# --------------------------------------------------------------------------
_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_WORD_NUMBERS = {
    "یک": 1, "دو": 2, "سه": 3, "چهار": 4, "پنج": 5, "شش": 6, "هفت": 7, "هشت": 8, "نه": 9,
    "ده": 10, "بیست": 20, "سی": 30, "چهل": 40, "پنجاه": 50, "شصت": 60, "هفتاد": 70,
    "هشتاد": 80, "نود": 90, "صد": 100, "یکصد": 100,
}
_MULTIPLIERS = {"هزار": 10**3, "میلیون": 10**6, "میلیارد": 10**9}
_UNITS = {"ریال": 1, "تومان": 10, "تومن": 10}
_NUM = r"(\d[\d,٬\.]*|" + "|".join(sorted(_WORD_NUMBERS, key=len, reverse=True)) + r")"
_AMOUNT_RE = re.compile(
    _NUM + r"\s*(هزار|میلیون|میلیارد)?\s*(ریال|تومان|تومن)"
)
# Phrases asking "which court / where do I file"
_COURT_QUESTION_RE = re.compile(
    r"کجا\s+(?:باید\s+)?(?:شکایت|دادخواست|طرح\s+دعوا|دعوا|اقامه)"
    r"|کدام\s+(?:دادگاه|مرجع)"
    r"|دادگاه\s+صالح|مرجع\s+صالح|صلاحیت\s+(?:دادگاه|مرجع)"
    r"|به\s+کدام\s+(?:دادگاه|مرجع)|در\s+کدام\s+(?:دادگاه|مرجع)"
    r"|شکایت\s+(?:را\s+)?کجا|دعوا\s+را\s+کجا"
)
_MONEY_HINT_RE = re.compile(
    r"ریال|تومان|مطالبه|طلب|بدهی|قرض|وام|اجاره|خسارت|چک|سفته|وجه|پول|مبلغ|بدهکار"
)
# Courts whose competence is decided by subject matter, not by the monetary limit.
_SUBJECT_COURTS = frozenset(
    {"family", "labor", "administrative", "guild_violations", "computer_guild", "bar_disciplinary",
     "criminal_1", "criminal_2", "revolution", "prosecution_investigator", "prosecution_deputy"}
)


def _norm(text: Any) -> str:
    value = str(text or "").translate(_DIGITS).replace("ي", "ی").replace("ك", "ک")
    return " ".join(value.replace("\u200c", " ").split())


def is_court_question(text: str) -> bool:
    """True when the user asks which court / where to file."""
    return bool(_COURT_QUESTION_RE.search(_norm(text)))


# First-person / personal-case cues: the user asks where to file THEIR OWN matter.
_PERSONAL_RE = re.compile(
    r"(?:شکایت|دادخواست|دعوا|دعوی|طرح\s+دعوا|اقامه)\s+(?:را\s+)?(?:کنم|بدهم|ببرم|کنیم|بکنم|بدم)"
    r"|کجا\s+(?:باید\s+)?(?:شکایت|دادخواست|طرح|دعوا|اقامه|برم|بروم|مراجعه)"
    r"|دعوا(?:ی|ي)\s+من|دعوایم|دعوام|پرونده\s*(?:ام|م\b)|پرونده\s+من"
    r"|طلب\s+دارم|طلبکارم|بدهکارم|از\s+\S+\s+شکایت|از\s+(?:او|وی|ایشان|همسرم|شوهرم|کارفرما\S*|مستاجر\S*|موجر\S*)\s+.*(?:شکایت|طلب)"
    r"|به\s+من\s+بدهکار"
)


_CLAIM_CUE_RE = re.compile(
    r"مطالبه|طلب|بدهی|بدهکار|بستانکار|خسارت|چک\s+برگشتی|برگشت\s+خورد|پس\s+نداد|نپرداخت|وجه\s+(?:من|ما)"
)


def is_personal_matter(text: str) -> bool:
    """True when the text describes the user's own matter: a first-person cue, or a stated
    amount together with a claim/debt cue. An amount alone is not enough.

    General or doctrinal competence questions («حد نصاب ۵۰۰ میلیون تومان برای دادگاه صلح چقدر است؟»)
    return False.
    """
    t = _norm(text)
    if _PERSONAL_RE.search(t):
        return True
    return extract_amount_rials(t) is not None and bool(_CLAIM_CUE_RE.search(t))


def extract_amount_rials(*texts: str) -> int | None:
    """Largest money amount with an explicit unit (ریال/تومان), in rials; None if none is stated.

    A bare number without a unit is NOT guessed: the unit changes the result tenfold.
    """
    best: int | None = None
    for text in texts:
        for m in _AMOUNT_RE.finditer(_norm(text)):
            raw, mult, unit = m.group(1), m.group(2), m.group(3)
            if raw in _WORD_NUMBERS:
                number = float(_WORD_NUMBERS[raw])
            else:
                cleaned = raw.replace(",", "").replace("٬", "")
                if cleaned.count(".") > 1:  # 1.000.000 style thousands separators
                    cleaned = cleaned.replace(".", "")
                try:
                    number = float(cleaned.rstrip("."))
                except ValueError:
                    continue
            value = int(round(number * _MULTIPLIERS.get(mult, 1) * _UNITS[unit]))
            if best is None or value > best:
                best = value
    return best


def _rule_for_court(court_key: str) -> dict[str, Any] | None:
    for rule in load_rules():
        if rule.get("court_key") == court_key and rule["threshold_rials"] is None:
            return rule
    return None


def _monetary_rule() -> dict[str, Any] | None:
    for rule in load_rules():
        if rule.get("court_key") and rule.get("above_court_key") and isinstance(rule["threshold_rials"], int):
            return rule
    return None


def _suggestion(court_key: str, rule: dict[str, Any] | None, confidence: str, amount: int | None) -> dict[str, Any]:
    return {
        "court": _courts.COURT_CATALOG[court_key]["court_name_fa"],
        "court_key": court_key,
        "basis_article": (rule or {}).get("basis_article") or (rule or {}).get("legal_basis"),
        "confidence": confidence,
        "rule_id": (rule or {}).get("id"),
        "rule_status": (rule or {}).get("status"),
        "amount_rials": amount,
    }


def suggest_court(facts: str = "", claims: str = "", amounts: str = "") -> dict[str, Any]:
    """Deterministic competent-court suggestion from the rules plus the extracted amount or type.

    Returns ``{"court_suggestion": dict | None, "missing": "amount" | "type" | None}``.
    ``missing`` is set only when nothing can be suggested and the amount (money claim) or the
    claim type is what is lacking, so a caller may ask one clarifying question.
    """
    # One combined text for every caller: the same words give the same court no matter which
    # argument (facts / claims / amounts) the caller put them in.
    text = _norm(f"{facts} {claims} {amounts}")
    amount = extract_amount_rials(text)
    catalog_hits = _courts.suggest_courts(text, "")
    top = catalog_hits[0]["court_key"] if catalog_hits else None

    if top in _SUBJECT_COURTS:
        rule = _rule_for_court(top)
        confidence = (rule or {}).get("confidence") or "low"
        return {"court_suggestion": _suggestion(top, rule, confidence, amount), "missing": None}

    monetary = bool(amount is not None or _MONEY_HINT_RE.search(text) or top in ("general_civil", "commercial", "peace"))
    rule = _monetary_rule()
    if not monetary or rule is None:
        return {"court_suggestion": None, "missing": "type" if not text.strip() or not monetary else None}
    if amount is None:
        return {"court_suggestion": None, "missing": "amount"}
    if amount <= rule["threshold_rials"]:
        return {
            "court_suggestion": _suggestion(rule["court_key"], rule, rule.get("confidence") or "medium", amount),
            "missing": None,
        }
    return {
        "court_suggestion": _suggestion(
            rule["above_court_key"], rule, rule.get("above_confidence") or "low", amount
        ),
        "missing": None,
    }


def chip_text(suggestion: dict[str, Any]) -> str:
    """Persian confirm-chip label for a suggestion."""
    basis = suggestion.get("basis_article")
    base = f"دادگاه پیشنهادی: {suggestion['court']}"
    return f"{base} (بر اساس {basis}) — درست است؟" if basis else f"{base} — درست است؟"


def prompt_fact(suggestion: dict[str, Any] | None) -> str:
    """System-prompt fact line for an applied rule ('' when there is no suggestion)."""
    if not suggestion:
        return ""
    basis = suggestion.get("basis_article")
    by = f" بر اساس {basis}" if basis else ""
    return (
        f"قاعدهٔ صلاحیت (قطعی، از تنظیمات تأییدشده): دادگاه {suggestion['court']}{by}؛ "
        "این را صریح در پاسخ بیاور و نگو که ماده‌ای پیدا نشد."
    )
