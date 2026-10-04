"""Pure core for the non-binding AI indictment draft («پیش‌نویس کیفرخواست»).

Prosecution-stage drafting aid, never a judicial act. Mirrors ruling_draft.py:
all side effects are injected and synchronous (``retrieve``, ``call_llm``,
``verify_citations`` with the same contracts). Only articles that are in the
retrieved set AND accepted by the citation guard survive. No punishment is ever
output. Nothing here logs; no case text goes into exceptions. Python 3.11-safe.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

try:
    from . import ruling_draft as _rd
except ImportError:  # pragma: no cover - flat import fallback
    from output_apps.generated_modules.smartjudge import ruling_draft as _rd

BANNER = _rd.BANNER
STATUS_DRAFT = _rd.STATUS_DRAFT
STATUS_INSUFFICIENT = _rd.STATUS_INSUFFICIENT
NONFINAL_PREFIX = _rd.NONFINAL_PREFIX
PUNISHMENT_PLACEHOLDER = _rd.PUNISHMENT_PLACEHOLDER

MAX_NAME = _rd.MAX_NAME
MAX_FACTS = _rd.MAX_FACTS
MAX_CHARGES_HINT = 1000
MAX_EVIDENCE_ITEMS = _rd.MAX_EVIDENCE_ITEMS
MAX_EVIDENCE_TITLE = _rd.MAX_EVIDENCE_TITLE
MAX_EVIDENCE_TEXT = _rd.MAX_EVIDENCE_TEXT


@dataclass
class IndictmentCase:
    accused: str
    complainant: str
    facts: str
    evidence: List[Dict[str, str]] = field(default_factory=list)
    charges_hint: Optional[str] = None

    def __post_init__(self) -> None:
        for value in (self.accused, self.complainant):
            if not isinstance(value, str) or not value.strip() or len(value) > MAX_NAME:
                raise ValueError("نام طرفین باید متن غیرخالی و حداکثر ۳۰۰ نویسه باشد")
        if not isinstance(self.facts, str) or not self.facts.strip() or len(self.facts) > MAX_FACTS:
            raise ValueError("شرح وقایع نامعتبر است")
        if self.charges_hint is not None and (
            not isinstance(self.charges_hint, str) or len(self.charges_hint) > MAX_CHARGES_HINT
        ):
            raise ValueError("عنوان اتهامی پیشنهادی نامعتبر است")
        if not isinstance(self.evidence, list) or len(self.evidence) > MAX_EVIDENCE_ITEMS:
            raise ValueError("تعداد ادله نامعتبر است")
        for item in self.evidence:
            if not isinstance(item, dict):
                raise ValueError("هر دلیل باید دارای عنوان و متن باشد")
            title, text = item.get("title", ""), item.get("text", "")
            if not isinstance(title, str) or not isinstance(text, str):
                raise ValueError("عنوان و متن دلیل باید متن باشند")
            if len(title) > MAX_EVIDENCE_TITLE or len(text) > MAX_EVIDENCE_TEXT:
                raise ValueError("عنوان یا متن یکی از ادله بیش از حد مجاز است")


def _insufficient(missing: List[str], removed: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
    return _rd._scrub(
        {
            "status": STATUS_INSUFFICIENT,
            "requires_human_review": True,
            "banner": BANNER,
            "charge_description": "",
            "evidence_summary": "",
            "legal_basis": [],
            "removed_citations": list(removed or []),
            "missing_information": list(missing),
        }
    )


def _build_prompt(case: IndictmentCase, articles: List[Dict[str, str]]) -> str:
    article_lines = ["- " + a["law_name"] + " ماده " + a["article_no"] + ": " + a["text"] for a in articles]
    evidence_lines = ["- " + e.get("title", "") + ": " + e.get("text", "") for e in case.evidence]
    template = (
        "{\n"
        '  "charge_description": "string",\n'
        '  "evidence_summary": "string",\n'
        '  "legal_basis": [{"law_name": "string", "article_no": "string", "reasoning": "string"}],\n'
        '  "missing_information": ["string"]\n'
        "}"
    )
    return (
        "تو دستیار تهیه «پیش‌نویس غیررسمی کیفرخواست» برای بررسی انسانی هستی، نه سند قضایی.\n"
        "فقط از مواد فهرست‌شده زیر استناد کن و هیچ ماده یا قانون دیگری نساز. "
        "هرگز مجازات، حبس، جزای نقدی یا حکم تعیین نکن. اگر مواد کافی نیستند، "
        "کمبودها را در missing_information بیاور.\n\n"
        "مواد قانونی مجاز:\n" + "\n".join(article_lines) + "\n\n"
        + _rd.LATIN_DIGITS_RULE + "\n"
        "شاکی: " + case.complainant + "\n"
        "متهم: " + case.accused + "\n"
        + ("عنوان اتهامی پیشنهادی کاربر: " + case.charges_hint + "\n" if case.charges_hint else "")
        + "شرح وقایع: " + case.facts + "\n"
        "ادله:\n" + ("\n".join(evidence_lines) if evidence_lines else "- (ندارد)") + "\n\n"
        "فقط یک شیء JSON با همین کلیدها و بدون هیچ متن دیگر برگردان:\n" + template + "\n"
    )


def generate_indictment_draft(
    case: IndictmentCase,
    *,
    retrieve: Callable[[IndictmentCase], List[Dict[str, Any]]],
    call_llm: Callable[[str], str],
    verify_citations: Callable[[str], Dict[str, Any]],
) -> Dict[str, Any]:
    """Build a non-binding indictment draft; never raises on backend failure."""
    try:
        articles = _rd._clean_retrieved(retrieve(case))
    except Exception:
        return _insufficient(["بازیابی مواد قانونی با خطا مواجه شد"])
    if not articles:
        return _insufficient(["هیچ ماده قانونی مرتبط با پرونده یافت نشد"])
    try:
        raw = call_llm(_build_prompt(case, articles))
    except Exception:
        return _insufficient(["دریافت پاسخ از مدل با خطا مواجه شد"])
    data = _rd._parse_json(raw)
    if not isinstance(data, dict):
        return _insufficient(["پاسخ مدل قابل پردازش نبود"])

    missing: List[str] = []
    out: Dict[str, Any] = {}
    for name in ("charge_description", "evidence_summary"):
        value = data.get(name)
        if isinstance(value, str):
            out[name] = value
        else:
            out[name] = ""
            missing.append("کلید " + name + " در پاسخ مدل نامعتبر یا ناموجود بود")
    raw_missing = data.get("missing_information")
    if isinstance(raw_missing, list):
        model_missing = [v for v in raw_missing if isinstance(v, str)]
    else:
        model_missing = []
        missing.append("کلید missing_information در پاسخ مدل نامعتبر یا ناموجود بود")

    allowed = {_rd._key(a["law_name"], a["article_no"]): a for a in articles}
    verdicts: Dict[Any, bool] = {}
    removed: List[Dict[str, str]] = []
    basis: List[Dict[str, str]] = []
    seen = set()
    raw_basis = data.get("legal_basis")
    if not isinstance(raw_basis, list):
        raw_basis = []
        missing.append("کلید legal_basis در پاسخ مدل نامعتبر یا ناموجود بود")
    for item in raw_basis:
        if not isinstance(item, dict):
            missing.append("یک مبنای قانونی ساختار نامعتبر داشت و حذف شد")
            continue
        law, number = item.get("law_name"), item.get("article_no")
        label = {"law_name": str(law), "article_no": str(number)}
        if not isinstance(law, str) or not isinstance(number, (str, int)) or isinstance(number, bool):
            removed.append({**label, "reason": "invalid_citation_format"})
            continue
        k = _rd._key(law, number)
        if k not in allowed:
            removed.append({**label, "reason": "not_in_retrieved_set"})
            continue
        if k not in verdicts:
            verdicts[k] = _rd._is_accepted(verify_citations, allowed[k]["law_name"], allowed[k]["article_no"])
        if not verdicts[k]:
            removed.append({**label, "reason": "rejected_by_verify_citations"})
            continue
        if k in seen:
            continue
        seen.add(k)
        reasoning = item.get("reasoning")
        basis.append(
            {
                "law_name": allowed[k]["law_name"],
                "article_no": allowed[k]["article_no"],
                "reasoning": reasoning if isinstance(reasoning, str) else "",
            }
        )
    if not basis:
        return _insufficient(missing + ["هیچ ماده قانونی معتبر و تأییدشده‌ای باقی نماند"], removed)

    for name in ("charge_description", "evidence_summary"):
        if _rd._PUNISHMENT_RE.search(out[name]):
            out[name] = PUNISHMENT_PLACEHOLDER
    for item in basis:
        if _rd._PUNISHMENT_RE.search(item["reasoning"]):
            item["reasoning"] = PUNISHMENT_PLACEHOLDER
    part = out["charge_description"].strip()
    if part.startswith(NONFINAL_PREFIX.strip()):
        part = part[len(NONFINAL_PREFIX.strip()) :].strip()
    out["charge_description"] = NONFINAL_PREFIX + part
    out["legal_basis"] = basis
    out["missing_information"] = model_missing + missing
    out["removed_citations"] = removed
    out["status"] = STATUS_DRAFT
    out["requires_human_review"] = True
    for item in out["legal_basis"]:
        item["reasoning"] = _rd._latinize(item["reasoning"])
    out["legal_basis"] = [dict(i) for i in out["legal_basis"]]
    keep = out.pop("legal_basis")
    removed_keep = out.pop("removed_citations")
    scrubbed = _rd._scrub(_rd._latinize(out))
    scrubbed["legal_basis"] = _rd._scrub(keep)
    scrubbed["removed_citations"] = removed_keep
    scrubbed["banner"] = BANNER
    return scrubbed
