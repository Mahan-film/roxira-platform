"""Pure core for the non-binding AI draft ruling («پیش‌نویس رأی»).

All side effects are injected and SYNCHRONOUS (callers with async backends
wrap them, e.g. with ``asyncio.run`` or ``run_in_executor``):

* ``retrieve(case) -> list[{"law_name", "article_no", "text"}]``
* ``call_llm(prompt) -> str`` (JSON text, optionally wrapped in ``` fences)
* ``verify_citations(text) -> {"validated_articles": [...]}`` where each
  entry is ``{"law_name": str, "article_no": str|int}``. The repo's
  ``/citations/verify`` handler in ``smartjudge_module.py`` returns entries
  keyed ``law`` / ``article``; those keys are accepted too. Law names and
  article numbers are normalised (Persian/Arabic digits, ي/ك, whitespace,
  leading zeros) the same way on both sides before comparison.

``verify_citations`` is called once PER cited article with the text
``"<law_name> ماده <article_no>"``. A citation survives only if it is in the
retrieved set AND the validator returned a matching validated article.

Nothing here logs, and no raw prompt, facts or party names are ever put into
exceptions or returned error text. The module must stay valid Python 3.11.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple

BANNER = (
    "پیش‌نویس غیررسمی و غیرقطعی تولیدشده با هوش مصنوعی؛ "
    "رأی دادگاه نیست و باید توسط قاضی یا وکیل صالح بررسی شود."
)
STATUS_DRAFT = "AI_DRAFT_UNVERIFIED"
STATUS_INSUFFICIENT = "INSUFFICIENT_BASIS"
CRIMINAL_PREFIX = "پیشنهاد (غیرقطعی): "
PUNISHMENT_PLACEHOLDER = "مجازات توسط مرجع صالح تعیین می‌شود"

NONFINAL_PREFIX = CRIMINAL_PREFIX
LATIN_DIGITS_RULE = "همهٔ ارقام را فقط با ارقام لاتین 0-9 بنویس (Use Latin digits)."

# court_type -> display name, party labels (side_a, side_b) and a short structure checklist.
COURT_TYPES: Dict[str, Dict[str, Any]] = {
    "civil": {
        "name": "دادگاه حقوقی",
        "parties": ("خواهان", "خوانده"),
        "checklist": "",
    },
    "criminal": {
        "name": "دادگاه کیفری",
        "parties": ("شاکی", "متهم"),
        "checklist": "",
    },
    "family": {
        "name": "دادگاه خانواده",
        "parties": ("خواهان", "خوانده"),
        "checklist": (
            "ساختار پیشنهادی: نسبت و وضعیت زوجین/خویشاوندی، موضوع (مهریه، نفقه، طلاق، "
            "حضانت، ملاقات)، ادله و گواهی‌ها، ملاحظات مصلحت کودک در صورت وجود، "
            "ارجاع به داوری/مشاوره در صورت لزوم."
        ),
    },
    "commercial": {
        "name": "دادگاه تجاری",
        "parties": ("خواهان", "خوانده"),
        "checklist": (
            "ساختار پیشنهادی: شخصیت تجاری طرفین (تاجر/شرکت)، قرارداد یا سند تجاری "
            "(چک، سفته، برات)، تعهدات و نقض، دفاتر و اسناد تجاری، خسارت تأخیر تأدیه."
        ),
    },
    "labor": {
        "name": "دادگاه کار (شورای حل اختلاف کار)",
        "parties": ("کارگر", "کارفرما"),
        "checklist": (
            "ساختار پیشنهادی: رابطهٔ کارگری-کارفرمایی و نوع قرارداد، سابقه و آخرین "
            "حقوق، موضوع اختلاف (اخراج، مطالبات، بیمه)، ادله و گزارش بازرسی کار."
        ),
    },
    "administrative": {
        "name": "دیوان عدالت اداری",
        "parties": ("شاکی", "مشتکی‌عنه (مرجع اداری)"),
        "checklist": (
            "ساختار پیشنهادی: مرجع اداری و مصوبه یا تصمیم مورد اعتراض، صلاحیت دیوان، "
            "مهلت اعتراض، دلایل مخالفت با قانون یا خروج از اختیار، درخواست ابطال یا "
            "الزام به انجام وظیفه."
        ),
    },
    "general_civil": {
        "name": "دادگاه عمومی حقوقی",
        "parties": ("خواهان", "خوانده"),
        "checklist": (
            "ساختار پیشنهادی: خواسته و بهای آن، دلایل و مستندات، دفاعیات خوانده، "
            "موضوعات اختلافی، نتیجهٔ پیشنهادی غیرقطعی."
        ),
    },
    "peace": {
        "name": "دادگاه صلح",
        "parties": ("خواهان", "خوانده"),
        "checklist": (
            "ساختار پیشنهادی: خواسته و بهای آن، مستندات، دفاعیات، موضوعات اختلافی، "
            "نتیجهٔ پیشنهادی غیرقطعی."
        ),
    },
    "criminal_1": {
        "name": "دادگاه کیفری یک",
        "parties": ("شاکی", "متهم"),
        "checklist": (
            "ساختار پیشنهادی: عنوان اتهام، خلاصهٔ کیفرخواست، ادله و دفاعیات، "
            "موضوعات اثباتی؛ بدون تعیین مجازات قطعی."
        ),
    },
    "criminal_2": {
        "name": "دادگاه کیفری دو",
        "parties": ("شاکی", "متهم"),
        "checklist": (
            "ساختار پیشنهادی: عنوان اتهام، خلاصهٔ کیفرخواست، ادله و دفاعیات، "
            "موضوعات اثباتی؛ بدون تعیین مجازات قطعی."
        ),
    },
    "revolution": {
        "name": "دادگاه انقلاب",
        "parties": ("شاکی", "متهم"),
        "checklist": (
            "ساختار پیشنهادی: عنوان اتهام، خلاصهٔ کیفرخواست، ادله و دفاعیات، "
            "موضوعات اثباتی؛ بدون تعیین مجازات قطعی."
        ),
    },
    "guild_violations": {
        "name": "هیئت/کمیسیون رسیدگی به تخلفات صنفی",
        "parties": ("شاکی/گزارش‌دهنده", "متشاکی (واحد صنفی)"),
        "checklist": (
            "ساختار پیشنهادی: واحد صنفی و نوع پروانه، گزارش تخلف، دفاعیات متشاکی، "
            "ادله و صورت‌جلسه بازرسی؛ بدون تعیین جریمهٔ قطعی."
        ),
    },
    "computer_guild": {
        "name": "رسیدگی انتظامی نظام صنفی رایانه‌ای / تخلفات حوزهٔ فناوری و هوش مصنوعی",
        "parties": ("شاکی/گزارش‌دهنده", "متشاکی"),
        "checklist": (
            "ساختار پیشنهادی: عضویت یا پروانهٔ صنفی، شرح تخلف حرفه‌ای، ادله فنی، "
            "دفاعیات؛ بدون تعیین مجازات انتظامی قطعی."
        ),
    },
    "bar_disciplinary": {
        "name": "دادگاه انتظامی وکلا",
        "parties": ("شاکی", "وکیل مورد شکایت"),
        "checklist": (
            "ساختار پیشنهادی: شرح شکایت، سوابق وکالت، ادله، دفاعیات وکیل؛ "
            "بدون تعیین مجازات انتظامی قطعی."
        ),
    },
}
NONFINAL_COURT_TYPES = (
    "family",
    "commercial",
    "labor",
    "administrative",
    "general_civil",
    "peace",
    "guild_violations",
    "computer_guild",
    "bar_disciplinary",
)
CRIMINAL_COURT_TYPES = ("criminal", "criminal_1", "criminal_2", "revolution")
COURT_TYPE_NAMES = tuple(COURT_TYPES)

MAX_EVIDENCE_ITEMS = 20
MAX_EVIDENCE_TITLE = 200
MAX_EVIDENCE_TEXT = 6000
MAX_FACTS = 12000
MAX_CLAIMS = 6000
MAX_NAME = 300
MAX_PROMPT_ARTICLES = 12
MAX_ARTICLE_TEXT = 1500

_STR_KEYS = ("facts_summary", "claims_summary", "proposed_operative_part")
_LIST_KEYS = ("evidence_review", "issues", "uncertainties", "missing_information")

_DIGIT_TRANS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_FORBIDDEN_RE = re.compile(r"APPROVED|FINAL|قوه\s*قضائیه|قوه\s*قضاییه", re.IGNORECASE)
_FENCE_RE = re.compile(r"^\s*```[a-zA-Z0-9_-]*\s*\n?(.*?)\n?\s*```\s*$", re.DOTALL)

_DURATION = r"(?:[0-9۰-۹٠-٩]|سال|ماه|روز|ضربه|میلیون|ریال|تومان|مدت)"
_PUNISHMENT_RE = re.compile(
    r"(?:حبس|شلاق|قصاص|اعدام)"
    r"|(?:جزای\s*نقدی|دیه|مجازات)[^.\n]{0,40}?" + _DURATION
)


@dataclass
class RulingCase:
    """Input case. For criminal cases claimant=complainant, respondent=accused."""

    court_type: str
    claimant: str
    respondent: str
    facts: str
    claims: str
    evidence: List[Dict[str, str]]
    jurisdiction: Optional[str] = None

    def __post_init__(self) -> None:
        if self.court_type not in COURT_TYPES:
            raise ValueError("نوع دادگاه نامعتبر است")
        for value in (self.claimant, self.respondent):
            if not isinstance(value, str) or not value.strip() or len(value) > MAX_NAME:
                raise ValueError("نام طرفین باید متن غیرخالی و حداکثر ۳۰۰ نویسه باشد")
        if self.jurisdiction is not None and (
            not isinstance(self.jurisdiction, str)
            or not self.jurisdiction.strip()
            or len(self.jurisdiction) > MAX_NAME
        ):
            raise ValueError("مرجع رسیدگی باید متن غیرخالی و حداکثر ۳۰۰ نویسه باشد")
        if not isinstance(self.facts, str) or len(self.facts) > MAX_FACTS:
            raise ValueError("شرح وقایع نامعتبر یا بیش از ۱۲۰۰۰ نویسه است")
        if not isinstance(self.claims, str) or len(self.claims) > MAX_CLAIMS:
            raise ValueError("خواسته‌ها نامعتبر یا بیش از ۶۰۰۰ نویسه است")
        if not isinstance(self.evidence, list) or len(self.evidence) > MAX_EVIDENCE_ITEMS:
            raise ValueError("تعداد ادله نامعتبر یا بیش از ۲۰ مورد است")
        for item in self.evidence:
            if not isinstance(item, dict):
                raise ValueError("هر دلیل باید دارای عنوان و متن باشد")
            title, text = item.get("title", ""), item.get("text", "")
            if not isinstance(title, str) or not isinstance(text, str):
                raise ValueError("عنوان و متن دلیل باید متن باشند")
            if len(title) > MAX_EVIDENCE_TITLE or len(text) > MAX_EVIDENCE_TEXT:
                raise ValueError("عنوان یا متن یکی از ادله بیش از حد مجاز است")


# ---------------------------------------------------------------- helpers
def _norm_law(value: Any) -> str:
    text = str(value or "").translate(_DIGIT_TRANS)
    text = text.replace("ي", "ی").replace("ك", "ک").replace("‌", " ")
    return " ".join(text.split())


def _norm_article(value: Any) -> str:
    text = _norm_law(value)
    text = re.sub(r"^ماده\s*", "", text)
    text = text.strip()
    if text.isdigit():
        text = str(int(text))
    return text


def _key(law: Any, article: Any) -> Tuple[str, str]:
    return (_norm_law(law), _norm_article(article))


def _insufficient(missing: List[str], removed: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
    """The single constructor for every INSUFFICIENT_BASIS result."""
    return _scrub(
        {
            "status": STATUS_INSUFFICIENT,
            "requires_human_review": True,
            "banner": BANNER,
            "proposed_operative_part": "",
            "removed_citations": list(removed or []),
            "missing_information": list(missing),
        }
    )


def _clean_retrieved(rows: Any) -> List[Dict[str, str]]:
    cleaned: List[Dict[str, str]] = []
    if not isinstance(rows, list):
        return cleaned
    for row in rows:
        if not isinstance(row, dict):
            continue
        law, article, text = row.get("law_name"), row.get("article_no"), row.get("text")
        if not isinstance(law, str) or not law.strip():
            continue
        if not isinstance(article, (str, int)) or isinstance(article, bool) or not str(article).strip():
            continue
        if not isinstance(text, str):
            continue
        cleaned.append({"law_name": law, "article_no": str(article), "text": text[:MAX_ARTICLE_TEXT]})
        if len(cleaned) >= MAX_PROMPT_ARTICLES:
            break
    return cleaned


def _build_prompt(case: RulingCase, articles: List[Dict[str, str]]) -> str:
    article_lines = [
        "- " + a["law_name"] + " ماده " + a["article_no"] + ": " + a["text"] for a in articles
    ]
    evidence_lines = ["- " + e.get("title", "") + ": " + e.get("text", "") for e in case.evidence]
    articles_block = "\n".join(article_lines)
    evidence_block = "\n".join(evidence_lines) if evidence_lines else "- (ندارد)"
    meta = COURT_TYPES[case.court_type]
    side_a, side_b = meta["parties"]
    extra = ""
    if meta["checklist"]:
        extra = (
            meta["checklist"] + "\n"
            "هیچ مبلغ قطعی، حضانت قطعی یا حکم قطعی ننویس؛ هر نتیجه را «پیشنهاد (غیرقطعی)» بنام.\n"
        )
    template = (
        "{\n"
        '  "facts_summary": "string",\n'
        '  "claims_summary": "string",\n'
        '  "evidence_review": ["string"],\n'
        '  "issues": ["string"],\n'
        '  "legal_reasoning": [{"issue": "string", '
        '"articles": [{"law_name": "string", "article_no": "string"}], "reasoning": "string"}],\n'
        '  "proposed_operative_part": "string",\n'
        '  "uncertainties": ["string"],\n'
        '  "missing_information": ["string"]\n'
        "}"
    )
    return (
        "تو دستیار تهیه «پیش‌نویس غیررسمی و غیرقطعی» برای بررسی انسانی هستی، نه رأی دادگاه.\n"
        "فقط از مواد قانونی فهرست‌شده در زیر به‌عنوان مبنای قانونی مجاز استفاده کن و "
        "فقط همین مواد را استناد کن. هیچ ماده یا قانون دیگری نساز. "
        "اگر این مواد برای نتیجه‌گیری کافی نیستند، در proposed_operative_part "
        "بنویس «اطلاعات کافی نیست» و کمبودها را در missing_information بیاور.\n\n"
        "مواد قانونی مجاز:\n" + articles_block + "\n\n"
        + extra + LATIN_DIGITS_RULE + "\n"
        "نوع پرونده: " + case.court_type + " (" + meta["name"] + ")\n"
        + ("مرجع: " + case.jurisdiction + "\n" if case.jurisdiction else "")
        + side_a + ": " + case.claimant + "\n"
        + side_b + ": " + case.respondent + "\n"
        "شرح وقایع: " + case.facts + "\n"
        "خواسته‌ها: " + case.claims + "\n"
        "ادله:\n" + evidence_block + "\n\n"
        "فقط یک شیء JSON با همین کلیدها و بدون هیچ متن دیگر برگردان:\n" + template + "\n"
    )


def _parse_json(raw: Any) -> Any:
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    match = _FENCE_RE.match(text)
    if match:
        text = match.group(1).strip()
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        pass
    start, end = text.find("{"), text.rfind("}")
    if 0 <= start < end:
        try:
            return json.loads(text[start : end + 1])
        except (ValueError, TypeError):
            return None
    return None


def _is_accepted(verify_citations: Callable[[str], Any], law: str, article: str) -> bool:
    try:
        report = verify_citations(law + " ماده " + article)
    except Exception:
        return False
    if not isinstance(report, dict):
        return False
    wanted = _key(law, article)
    entries = report.get("validated_articles")
    if not isinstance(entries, list):
        return False
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        got = _key(entry.get("law_name", entry.get("law")), entry.get("article_no", entry.get("article")))
        if got == wanted:
            return True
    return False


_DIGIT_SKIP_KEYS = ("articles", "removed_citations", "status", "banner")


def _latinize(value: Any) -> Any:
    """Latin digits in model-facing text; identifier-like keys are left untouched."""
    if isinstance(value, str):
        return value.translate(_DIGIT_TRANS)
    if isinstance(value, list):
        return [_latinize(v) for v in value]
    if isinstance(value, dict):
        return {k: (v if k in _DIGIT_SKIP_KEYS else _latinize(v)) for k, v in value.items()}
    return value


def _scrub(value: Any) -> Any:
    if isinstance(value, str):
        return _FORBIDDEN_RE.sub("", value)
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    if isinstance(value, dict):
        return {k: _scrub(v) for k, v in value.items()}
    return value


# ------------------------------------------------------------- public API
def generate_ruling_draft(
    case: RulingCase,
    *,
    retrieve: Callable[[RulingCase], List[Dict[str, Any]]],
    call_llm: Callable[[str], str],
    verify_citations: Callable[[str], Dict[str, Any]],
) -> Dict[str, Any]:
    """Build a non-binding draft; never raises on retrieval/LLM/validator failure."""
    try:
        articles = _clean_retrieved(retrieve(case))
    except Exception:
        return _insufficient(["بازیابی مواد قانونی با خطا مواجه شد"])
    if not articles:
        return _insufficient(["هیچ ماده قانونی مرتبط با پرونده یافت نشد"])

    try:
        raw = call_llm(_build_prompt(case, articles))
    except Exception:
        return _insufficient(["دریافت پاسخ از مدل با خطا مواجه شد"])

    data = _parse_json(raw)
    if not isinstance(data, dict):
        return _insufficient(["پاسخ مدل قابل پردازش نبود"])

    missing: List[str] = []
    result: Dict[str, Any] = {}
    for name in _STR_KEYS:
        value = data.get(name)
        if isinstance(value, str):
            result[name] = value
        else:
            result[name] = ""
            missing.append("کلید " + name + " در پاسخ مدل نامعتبر یا ناموجود بود")
    for name in _LIST_KEYS:
        value = data.get(name)
        if isinstance(value, list):
            result[name] = [v for v in value if isinstance(v, str)]
        else:
            result[name] = []
            missing.append("کلید " + name + " در پاسخ مدل نامعتبر یا ناموجود بود")

    allowed = {_key(a["law_name"], a["article_no"]): a for a in articles}
    verdicts: Dict[Tuple[str, str], bool] = {}
    removed: List[Dict[str, str]] = []
    reasoning_out: List[Dict[str, Any]] = []
    verified_laws: List[str] = []

    raw_reasoning = data.get("legal_reasoning")
    if not isinstance(raw_reasoning, list):
        raw_reasoning = []
        missing.append("کلید legal_reasoning در پاسخ مدل نامعتبر یا ناموجود بود")
    for item in raw_reasoning:
        if not isinstance(item, dict) or not isinstance(item.get("articles"), list):
            missing.append("یک مورد از استدلال حقوقی ساختار نامعتبر داشت و حذف شد")
            continue
        kept: List[Dict[str, str]] = []
        for art in item["articles"]:
            if not isinstance(art, dict):
                missing.append("یک ماده استنادشده ساختار نامعتبر داشت و حذف شد")
                continue
            law, number = art.get("law_name"), art.get("article_no")
            label = {"law_name": str(law), "article_no": str(number)}
            if not isinstance(law, str) or not isinstance(number, (str, int)) or isinstance(number, bool):
                removed.append({**label, "reason": "invalid_citation_format"})
                continue
            k = _key(law, number)
            if k not in allowed:
                removed.append({**label, "reason": "not_in_retrieved_set"})
                continue
            if k not in verdicts:
                verdicts[k] = _is_accepted(verify_citations, allowed[k]["law_name"], allowed[k]["article_no"])
            if not verdicts[k]:
                removed.append({**label, "reason": "rejected_by_verify_citations"})
                continue
            clean = {"law_name": allowed[k]["law_name"], "article_no": allowed[k]["article_no"]}
            if clean not in kept:
                kept.append(clean)
                verified_laws.append(clean["law_name"])
        if not kept:
            missing.append("یک استدلال حقوقی بدون ماده معتبر حذف شد")
            continue
        issue, reasoning = item.get("issue"), item.get("reasoning")
        reasoning_out.append(
            {
                "issue": issue if isinstance(issue, str) else "",
                "articles": kept,
                "reasoning": reasoning if isinstance(reasoning, str) else "",
            }
        )

    if not reasoning_out:
        return _insufficient(missing + ["هیچ ماده قانونی معتبر و تأییدشده‌ای باقی نماند"], removed)

    result["legal_reasoning"] = reasoning_out
    if case.court_type in CRIMINAL_COURT_TYPES:
        part = result["proposed_operative_part"].strip()
        if part.startswith(CRIMINAL_PREFIX.strip()):
            part = part[len(CRIMINAL_PREFIX.strip()) :].strip()
        has_penal_basis = any("مجازات" in _norm_law(name) for name in verified_laws)
        if _PUNISHMENT_RE.search(part) and not has_penal_basis:
            part = PUNISHMENT_PLACEHOLDER
        result["proposed_operative_part"] = CRIMINAL_PREFIX + part

    elif case.court_type in NONFINAL_COURT_TYPES:
        part = result["proposed_operative_part"].strip()
        if part.startswith(NONFINAL_PREFIX.strip()):
            part = part[len(NONFINAL_PREFIX.strip()) :].strip()
        result["proposed_operative_part"] = NONFINAL_PREFIX + part

    result["missing_information"] = result["missing_information"] + missing
    result["removed_citations"] = removed
    result["status"] = STATUS_DRAFT
    result["requires_human_review"] = True
    result["banner"] = BANNER
    scrubbed = _scrub(_latinize(result))
    scrubbed["banner"] = BANNER
    return scrubbed
