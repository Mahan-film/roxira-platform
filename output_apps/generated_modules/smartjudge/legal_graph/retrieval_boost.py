"""Pure (no I/O) helpers for hybrid legal retrieval.

* ``normalize_text`` / ``tokens``: Persian/Arabic character + digit normalisation, so
  "ي/ك", ZWNJ, hamza forms, "تجدید نظر" vs "تجدیدنظر" and Persian digits all compare equal.
* ``lexical_overlap``: stop-word-free token overlap between a query and an article.
* ``keyword_targets``: small topic map (appeal deadlines, cheque, lease, custody,
  inheritance, dowry, fraud) -> (law-name fragments, article numbers). It is a RETRIEVAL
  BOOST only: it names where to look, it is never used as answer text.
* ``rrf_merge``: weighted Reciprocal Rank Fusion over several ranked key lists.
* ``is_relevant``: relevance cutoff that keeps high-similarity vector hits.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Dict, Hashable, Iterable, List, Sequence, Set, Tuple

_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_CHAR_MAP = str.maketrans(
    {
        "ي": "ی", "ى": "ی", "ئ": "ی", "ك": "ک", "ة": "ه", "ۀ": "ه",
        "آ": "ا", "أ": "ا", "إ": "ا", "ٱ": "ا", "ؤ": "و", "ـ": "", "‌": " ", "‍": "",
        "ٔ": "", "ء": "",
    }
)
_DIACRITICS = re.compile("[ً-ٰٟ]")
_PHRASES: Tuple[Tuple[str, str], ...] = (
    ("تجدید نظر", "تجدیدنظر"),
    ("وا خواهی", "واخواهی"),
    ("نظر خواهی", "نظرخواهی"),
    ("دادخواهی", "دادخواهی"),
)
_WORD_RE = re.compile(r"[\w]+", re.UNICODE)

STOPWORDS = frozenset(
    "از در به با که را این آن و یا است هست بود باشد می شود شود چه چقدر چند چیست کدام آیا برای تا بر "
    "یک هر هم اما ولی اگر بعد قبل پس طبق چگونه چطور باید میشود شده کرد کنم کند کنید".split()
)


def normalize_text(text: Any) -> str:
    s = str(text or "").translate(_DIGITS).translate(_CHAR_MAP)
    s = _DIACRITICS.sub("", s).lower()
    s = re.sub(r"\s+", " ", s).strip()
    for src, dst in _PHRASES:
        s = s.replace(src, dst)
    return s


def _stem(token: str) -> str:
    for suffix in ("های", "ها", "ان"):
        if len(token) > len(suffix) + 2 and token.endswith(suffix):
            return token[: -len(suffix)]
    return token


def tokens(text: Any) -> Set[str]:
    out: Set[str] = set()
    for tok in _WORD_RE.findall(normalize_text(text)):
        if len(tok) < 2 or tok in STOPWORDS or tok.isdigit():
            continue
        out.add(_stem(tok))
    return out


def lexical_overlap(query: Any, text: Any) -> int:
    """Count of distinct non-stop query tokens present in ``text``.

    "تجدیدنظرخواهی" also matches an article that says "تجدیدنظر" (prefix rule, >=6 chars).
    """
    q = tokens(query)
    t = tokens(text)
    if not q or not t:
        return 0
    hits = 0
    for tok in q:
        if tok in t or (len(tok) >= 6 and any(x.startswith(tok[:6]) or tok.startswith(x) for x in t if len(x) >= 6)):
            hits += 1
    return hits


# ---------------------------------------------------------------------------
# Topic -> where-to-look map (boost only)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class KeywordRule:
    name: str
    triggers: Tuple[str, ...]  # normalised substrings; any one fires the rule
    law_fragments: Tuple[str, ...]  # normalised substrings of acceptable law_name values
    articles: Tuple[int, ...] = ()  # specific articles to fetch (empty = law-level boost only)
    priority: Tuple[int, ...] = ()  # articles always returned first when found (the core provisions)


def _rng(a: int, b: int) -> Tuple[int, ...]:
    return tuple(range(a, b + 1))


_CPC = ("ایین دادرسی مدنی", "ایین دادرسی دادگاههای عمومی و انقلاب در امور مدنی", "ایین دادرسی دادگاه های عمومی و انقلاب در امور مدنی")

KEYWORD_RULES: Tuple[KeywordRule, ...] = (
    KeywordRule("appeal", ("تجدیدنظر",), _CPC, _rng(330, 339), (336,)),
    KeywordRule("default-judgment-objection", ("واخواهی", "غیابی"), _CPC, _rng(303, 306), (303,)),
    KeywordRule("appeal-deadline", ("مهلت اعتراض", "مهلت شکایت", "مهلت فرجام"), _CPC, _rng(330, 339) + _rng(303, 306)),
    KeywordRule("cheque", ("چک", "صدور چک", "برگشت خورد", "برگشتی"), ("صدور چک",)),
    KeywordRule("lease", ("اجاره", "مستاجر", "موجر", "تخلیه", "اجاره نامه", "اجاره بها"), ("روابط موجر و مستاجر",)),
    KeywordRule("custody", ("حضانت", "نگهداری فرزند", "سرپرستی فرزند"), ("قانون مدنی", "حمایت خانواده"), _rng(1168, 1173)),
    KeywordRule("inheritance", ("ارث", "ارثیه", "وراث", "ورثه", "سهم الارث", "ترکه", "وصیت"), ("قانون مدنی",), _rng(861, 949)),
    KeywordRule("dowry", ("مهریه", "مهر", "صداق", "نفقه"), ("قانون مدنی", "نحوه اجرای محکومیت"), _rng(1078, 1101)),
    KeywordRule(
        "fraud",
        ("کلاهبرداری", "کلاه برداری"),
        ("ارتشا اختلاس و کلاهبرداری", "تشدید مجازات مرتکبین ارتشا"),
        (1,),
    ),
)


def _trigger_hit(trigger: str, q_text: str, q_tokens: List[str]) -> bool:
    if " " in trigger:
        return trigger in q_text
    return any(t == trigger or (len(trigger) >= 4 and t.startswith(trigger)) for t in q_tokens)


def keyword_targets(query: Any) -> List[KeywordRule]:
    """Rules fired by ``query`` (in map order). Whole-word / prefix matching, not substring."""
    q_text = normalize_text(query)
    q_tokens = _WORD_RE.findall(q_text)
    return [r for r in KEYWORD_RULES if any(_trigger_hit(t, q_text, q_tokens) for t in r.triggers)]


def law_matches(law_name: Any, fragments: Iterable[str]) -> bool:
    name = normalize_text(law_name)
    return any(f in name for f in fragments)


# ---------------------------------------------------------------------------
# Fusion + cutoff
# ---------------------------------------------------------------------------
def rrf_merge(rankings: Sequence[Tuple[float, Sequence[Hashable]]], k: int = 60) -> List[Hashable]:
    """Weighted Reciprocal Rank Fusion: ``rankings`` = [(weight, ordered keys), ...]."""
    scores: Dict[Hashable, float] = {}
    first_seen: Dict[Hashable, int] = {}
    for weight, keys in rankings:
        for rank, key in enumerate(keys):
            scores[key] = scores.get(key, 0.0) + weight / (k + rank + 1)
            first_seen.setdefault(key, len(first_seen))
    return sorted(scores, key=lambda key: (-scores[key], first_seen[key]))


DEFAULT_MIN_VECTOR_SCORE = 0.55
TRUSTED_MATCH_LEVELS = frozenset({"QDRANT_EXACT", "KEYWORD_BOOST"})


def min_vector_score() -> float:
    raw = os.environ.get("SMARTJUDGE_MIN_VECTOR_SCORE", "").strip()
    try:
        return float(raw) if raw else DEFAULT_MIN_VECTOR_SCORE
    except ValueError:
        return DEFAULT_MIN_VECTOR_SCORE


def is_relevant(row: Dict[str, Any], min_token_score: float, min_vec: float | None = None) -> bool:
    """Keep a row if its token score passes OR it is a strong vector hit OR it is exact/boosted.

    Rows with no numeric score at all (SQL retriever) are kept, as before.
    """
    if str(row.get("match_level") or "") in TRUSTED_MATCH_LEVELS:
        return True
    cutoff_vec = min_vector_score() if min_vec is None else min_vec
    vec = row.get("vector_score")
    if isinstance(vec, (int, float)) and not isinstance(vec, bool) and vec >= cutoff_vec:
        return True
    score = row.get("score")
    if isinstance(score, (int, float)) and not isinstance(score, bool):
        return score >= min_token_score
    return True
