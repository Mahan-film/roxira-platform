"""Deterministic post-answer verifier for Smart Judge v2 (T246 / #985).

Checks temporal validity (as_of / repealed), numeric/duration/fraction grounding,
phantom citations, and Tier 1/2 source authority without network or LLM calls.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from output_apps.generated_modules.smartjudge.abstention_gate import (
    deterministic_citation_check,
    filter_by_as_of,
    norm,
)
from output_apps.generated_modules.smartjudge.authority_tiers import (
    STATUS_REPEALED,
    has_authoritative_chunk,
    resolve_chunk_status,
)

_NUMBER_OR_FRACTION_RE = re.compile(r"\d+(?:[./]\d+)?")


@dataclass
class VerificationResult:
    passed: bool
    action: str  # "pass" | "regenerate_quote_only" | "abstain"
    reasons: List[str] = field(default_factory=list)
    phantom_citations: List[Dict[str, Any]] = field(default_factory=list)
    repealed_or_out_of_date: List[Dict[str, Any]] = field(default_factory=list)
    ungrounded_numbers: List[str] = field(default_factory=list)
    has_authoritative_source: bool = True

    def to_sse_event(self) -> Dict[str, Any]:
        return {
            "event": "verification",
            "data": {
                "passed": self.passed,
                "action": self.action,
                "reasons": list(self.reasons),
                "phantom_citations_count": len(self.phantom_citations),
                "repealed_or_out_of_date_count": len(self.repealed_or_out_of_date),
                "ungrounded_numbers": list(self.ungrounded_numbers),
                "has_authoritative_source": self.has_authoritative_source,
            },
        }


def _extract_normalized_numbers(text: str) -> List[str]:
    normalized = norm(text)
    seen: set = set()
    out: List[str] = []
    for match in _NUMBER_OR_FRACTION_RE.findall(normalized):
        if match not in seen:
            seen.add(match)
            out.append(match)
    return out


def _chunk_corpus_text(chunks: Sequence[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for c in chunks:
        if not isinstance(c, dict):
            continue
        for key in ("text", "summary", "content", "title", "law_name", "article_no", "article", "number", "date"):
            val = c.get(key)
            if val is not None:
                parts.append(norm(val))
    return " ".join(parts)


def verify_post_answer(
    answer_text: str,
    retrieved_chunks: Sequence[Dict[str, Any]],
    *,
    cited_items: Optional[Sequence[Dict[str, Any]]] = None,
    as_of_date: Optional[str] = None,
    require_authoritative: bool = True,
) -> VerificationResult:
    """Deterministically verify an answer against retrieved chunks."""
    reasons: List[str] = []
    phantom_citations: List[Dict[str, Any]] = []
    repealed_or_out_of_date: List[Dict[str, Any]] = []
    ungrounded_numbers: List[str] = []

    valid_chunks = filter_by_as_of(retrieved_chunks, as_of_date=as_of_date)
    valid_ids = {id(c) for c in valid_chunks}

    for c in retrieved_chunks:
        if not isinstance(c, dict):
            continue
        if resolve_chunk_status(c) == STATUS_REPEALED or id(c) not in valid_ids:
            repealed_or_out_of_date.append(dict(c))

    if repealed_or_out_of_date and not valid_chunks:
        reasons.append("repealed_or_out_of_date")

    has_auth = has_authoritative_chunk(valid_chunks) if valid_chunks else False
    if require_authoritative and not has_auth:
        reasons.append("no_authoritative_source")

    if cited_items:
        _valid, dropped, unofficial_alone = deterministic_citation_check(cited_items, valid_chunks)
        phantom_citations.extend(dropped)
        if dropped:
            reasons.append("phantom_citation")
        if unofficial_alone and require_authoritative and "no_authoritative_source" not in reasons:
            reasons.append("unofficial_only_citation")

    corpus = _chunk_corpus_text(valid_chunks)
    for num in _extract_normalized_numbers(answer_text):
        if num not in corpus:
            ungrounded_numbers.append(num)
    if ungrounded_numbers:
        reasons.append("ungrounded_number")

    passed = len(reasons) == 0
    if passed:
        action = "pass"
    elif "no_authoritative_source" in reasons or "repealed_or_out_of_date" in reasons:
        action = "abstain"
    else:
        action = "regenerate_quote_only"

    return VerificationResult(
        passed=passed,
        action=action,
        reasons=reasons,
        phantom_citations=phantom_citations,
        repealed_or_out_of_date=repealed_or_out_of_date,
        ungrounded_numbers=ungrounded_numbers,
        has_authoritative_source=has_auth,
    )
