"""Pure post-processing of retrieved sources for the Smart Judge text chat (no I/O).

* ``strip_placeholders``: FALLBACK rows are fixed placeholders, never corpus hits.
* ``filter_relevant``: drops rows below ``SMARTJUDGE_MIN_SOURCE_SCORE`` and generic
  keyword-category rows (``HIGH_DOCTRINE``) that only match by category name.
* ``select_displayed``: shows only sources the answer actually cites (article
  number + law name), else the top 3; never more than ``MAX_DISPLAYED_SOURCES``.

Score distribution: lexical Qdrant rows carry ``score`` = number of query tokens
found in the article text (integer, 0..N). Rows from the SQL retriever carry no
score and are kept (they match by exact article/precedent number). Default cutoff
is 2 overlapping tokens; tune with ``SMARTJUDGE_MIN_SOURCE_SCORE``.
"""

from __future__ import annotations

import os
import re
from typing import Any, Iterable, List, Optional

ENV_MIN_SCORE = "SMARTJUDGE_MIN_SOURCE_SCORE"
DEFAULT_MIN_SCORE = 2.0
MAX_DISPLAYED_SOURCES = 5
UNCITED_TOP_N = 3

_DIGIT_TRANS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_ARTICLE_RE = re.compile(r"ماده\s*(?:ی|ٔ)?\s*(\d+)")
_PREC_RE = re.compile(r"(?:رأی|رای|وحدت\s*رویه)[^\d]{0,30}(\d+)")


def _norm(text: Any) -> str:
    s = str(text or "").translate(_DIGIT_TRANS)
    s = s.replace("ي", "ی").replace("ك", "ک").replace("‌", " ").replace("ٔ", "")
    return re.sub(r"\s+", " ", s).strip()


def min_source_score() -> float:
    raw = os.environ.get(ENV_MIN_SCORE, "").strip()
    if not raw:
        return DEFAULT_MIN_SCORE
    try:
        return float(raw)
    except ValueError:
        return DEFAULT_MIN_SCORE


def is_placeholder(row: Any) -> bool:
    return isinstance(row, dict) and str(row.get("match_level") or "") == "FALLBACK"


def strip_placeholders(rows: Optional[Iterable[Any]]) -> List[Any]:
    """Remove FALLBACK placeholder rows (always, whatever the prompt-library flag)."""
    return [r for r in (rows or []) if isinstance(r, dict) and not is_placeholder(r)]


def filter_relevant(rows: Optional[Iterable[Any]], min_score: Optional[float] = None) -> List[Any]:
    """Drop low-score rows and generic HIGH_DOCTRINE category matches."""
    cutoff = min_source_score() if min_score is None else min_score
    out: List[Any] = []
    for r in strip_placeholders(rows):
        if str(r.get("match_level") or "") == "HIGH_DOCTRINE":
            continue
        score = r.get("score")
        if isinstance(score, (int, float)) and not isinstance(score, bool) and score < cutoff:
            continue
        out.append(r)
    return out


def _article_no(row: dict) -> Optional[str]:
    no = row.get("article_no")
    if no not in (None, ""):
        m = re.search(r"\d+", _norm(no))
        if m:
            return m.group(0)
    m = _ARTICLE_RE.search(_norm(row.get("title")))
    return m.group(1) if m else None


def _law_name(row: dict) -> str:
    name = _norm(row.get("law_name"))
    if not name:
        title = _norm(row.get("title"))
        name = re.sub(r"^.*?ماده\s*\d+\s*(?:مکرر)?\s*[-–:]?\s*", "", title) if "ماده" in title else ""
        if not name or name == title:
            name = _norm(row.get("category"))
    name = re.sub(r"^قانون\s+", "", name)
    return name


def cited_in_answer(answer: str, row: dict) -> bool:
    """True when the answer cites this row: article number, plus law name if known."""
    text = _norm(answer)
    if not text or not isinstance(row, dict):
        return False
    if str(row.get("kind") or "") == "precedent" or "subject" in row:
        nums = {m.group(1) for m in _PREC_RE.finditer(text)}
        row_no = re.search(r"\d+", _norm(row.get("title")))
        return bool(row_no and row_no.group(0) in nums)
    no = _article_no(row)
    if no is None:
        return False
    if not any(m.group(1) == no for m in _ARTICLE_RE.finditer(text)):
        return False
    law = _law_name(row)
    return (not law) or law in text


def select_displayed(
    answer: str,
    laws: Optional[List[Any]],
    precedents: Optional[List[Any]],
    max_sources: int = MAX_DISPLAYED_SOURCES,
    uncited_top_n: int = UNCITED_TOP_N,
) -> tuple:
    """Return ``(laws, precedents)`` to display: cited ones, else the top ``uncited_top_n``."""
    laws = list(laws or [])
    precedents = list(precedents or [])
    cited_laws = [r for r in laws if cited_in_answer(answer, r)]
    cited_prec = [r for r in precedents if cited_in_answer(answer, r)]
    if cited_laws or cited_prec:
        laws, precedents = cited_laws, cited_prec
    else:
        combined = [("l", r) for r in laws] + [("p", r) for r in precedents]
        combined = combined[:uncited_top_n]
        laws = [r for k, r in combined if k == "l"]
        precedents = [r for k, r in combined if k == "p"]
    laws = laws[:max_sources]
    precedents = precedents[: max(0, max_sources - len(laws))]
    return laws, precedents
