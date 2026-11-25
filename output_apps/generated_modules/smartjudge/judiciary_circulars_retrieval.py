"""Judiciary circulars retrieval («بخشنامه‌های قوه قضائیه»): Qdrant ``judiciary_circulars`` collection.

Behind the flag ``JUDICIARY_CIRCULARS_COLLECTION`` (default: unset = OFF, zero behaviour change).
When set (e.g. ``judiciary_circulars``, 250 bge-m3 points in prod Qdrant with payload fields
``circular_no``, ``title``, ``subject``, ``text``, ``year``), circular questions are searched in
parallel with laws and regulations and mapped into the common regulation/citation row shape.
Deduplication in ``merge_circulars`` prevents double-citing circulars that also appear in
``iran_regulations_v3b``.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

ENV_COLLECTION = "JUDICIARY_CIRCULARS_COLLECTION"
ENV_MIN_SCORE = "JUDICIARY_CIRCULARS_MIN_SCORE"
ENV_LIMIT = "JUDICIARY_CIRCULARS_LIMIT"
DEFAULT_MIN_SCORE = 0.55
DEFAULT_LIMIT = 3
EXPECTED_EMBEDDER = "BAAI/bge-m3"
CATEGORY = "REGULATION"
DOC_TYPE = "judiciary_circular"
DEFAULT_ISSUER = "رئیس قوه قضائیه"
MATCH_LEVEL = "JUDICIARY_CIRCULAR_VECTOR"
_OFF = {"", "0", "off", "false", "no", "none"}

_CIRCULAR_QUERY_RE = re.compile(
    r"(?:بخشنامه|دستورالعمل|دستور\s+اداری|قوه\s+قضائیه|رئیس\s+قوه)",
    re.UNICODE,
)


def collection() -> str:
    """The collection name when the flag is on, else '' (OFF)."""
    raw = os.environ.get(ENV_COLLECTION, "").strip()
    return "" if raw.lower() in _OFF else raw


def enabled() -> bool:
    return bool(collection())


def min_score() -> float:
    try:
        return float(os.environ.get(ENV_MIN_SCORE, "") or DEFAULT_MIN_SCORE)
    except ValueError:
        return DEFAULT_MIN_SCORE


def default_limit() -> int:
    try:
        return max(1, int(os.environ.get(ENV_LIMIT, "") or DEFAULT_LIMIT))
    except ValueError:
        return DEFAULT_LIMIT


def is_circular_question(query: str) -> bool:
    """Return True when the user query asks about circulars/directives."""
    return bool(_CIRCULAR_QUERY_RE.search(query or ""))


def _norm_key(text: Any) -> str:
    s = str(text or "").replace("\u200c", " ").replace("ي", "ی").replace("ك", "ک")
    return " ".join(s.split()).strip().lower()


def circular_title(payload: Dict[str, Any]) -> str:
    """Resolve display title from ``title``, or ``circular_no`` + ``subject``."""
    title = " ".join(str(payload.get("title") or "").split())
    if title:
        return title
    circular_no = " ".join(str(payload.get("circular_no") or payload.get("number") or "").split())
    subject = " ".join(str(payload.get("subject") or "").split())
    if circular_no and subject:
        return f"بخشنامه شماره {circular_no} \u2014 {subject}"
    if circular_no:
        return f"بخشنامه شماره {circular_no}"
    return subject or DEFAULT_ISSUER


def payload_to_row(payload: Dict[str, Any], vector_score: Optional[float] = None) -> Dict[str, Any]:
    """Map ``judiciary_circulars`` payload to the common regulation/citation row shape."""
    circular_no = str(payload.get("circular_no") or payload.get("number") or "").strip()
    date = str(payload.get("date") or payload.get("year") or "").strip()
    body = str(payload.get("text") or payload.get("full_text") or "")
    issuer = str(payload.get("issuer") or DEFAULT_ISSUER).strip() or DEFAULT_ISSUER
    return {
        "title": circular_title(payload),
        "kind": "regulation",
        "category": CATEGORY,
        "doc_type": DOC_TYPE,
        "doc_id": str(payload.get("doc_id") or (f"jc:{circular_no}" if circular_no else "")),
        "ref": str(payload.get("ref") or circular_no),
        "issuer": issuer,
        "number": circular_no,
        "date": date,
        "subject": str(payload.get("subject") or ""),
        "needs_review": bool(payload.get("needs_review")),
        "summary": " ".join(body.split())[:1200],
        "source_url": payload.get("source_url"),
        "source_tier": payload.get("source_tier") or "unofficial",
        "match_level": MATCH_LEVEL,
        "vector_score": vector_score,
        "source": f"qdrant:{collection() or 'judiciary_circulars'}",
        "valid_from": payload.get("valid_from"),
        "valid_to": payload.get("valid_to"),
        "status": payload.get("status"),
    }


def hits_to_rows(
    payloads: Sequence[Dict[str, Any]],
    *,
    cutoff: Optional[float] = None,
    limit: int = DEFAULT_LIMIT,
) -> List[Dict[str, Any]]:
    """Qdrant payloads (each carrying ``_vector_score``) -> deduplicated rows above cutoff."""
    cutoff = min_score() if cutoff is None else cutoff
    seen: set = set()
    scored: List[tuple] = []
    for p in payloads or []:
        if not isinstance(p, dict) or p.get("is_active") is False:
            continue
        score = p.get("_vector_score")
        if not isinstance(score, (int, float)) or isinstance(score, bool) or score < cutoff:
            continue
        cno = _norm_key(p.get("circular_no") or p.get("number"))
        key = (cno, p.get("chunk_index")) if cno else (_norm_key(p.get("title")), p.get("year"))
        if key in seen:
            continue
        seen.add(key)
        scored.append((float(score), p))
    scored.sort(key=lambda x: -x[0])
    return [payload_to_row(p, s) for s, p in scored[: max(1, limit)]]


def merge_circulars(
    precedents: Optional[Sequence[Any]],
    circulars: Optional[Sequence[Any]],
) -> List[Any]:
    """Append judiciary circular rows not already present in ``precedents`` (e.g. from ``iran_regulations_v3b``)."""
    out = list(precedents or [])
    seen_ids = set()
    seen_nums = set()
    seen_titles = set()
    for r in out:
        if not isinstance(r, dict):
            continue
        if r.get("doc_id"):
            seen_ids.add((str(r.get("doc_id")), r.get("chunk_index")))
        num = _norm_key(r.get("number") or r.get("ref"))
        if num:
            seen_nums.add(num)
        title = _norm_key(r.get("title"))
        if title:
            seen_titles.add(title)

    for c in circulars or []:
        if not isinstance(c, dict):
            continue
        cid = (str(c.get("doc_id") or ""), c.get("chunk_index"))
        num = _norm_key(c.get("number") or c.get("ref"))
        title = _norm_key(c.get("title"))
        if cid[0] and cid in seen_ids:
            continue
        if num and num in seen_nums:
            continue
        if title and title in seen_titles:
            continue
        if cid[0]:
            seen_ids.add(cid)
        if num:
            seen_nums.add(num)
        if title:
            seen_titles.add(title)
        out.append(c)
    return out


EmbedFn = Callable[[str], Optional[List[float]]]
SearchFn = Callable[[List[float], str, int], Awaitable[Optional[List[Dict[str, Any]]]]]


async def retrieve_judiciary_circulars(
    query: str,
    limit: Optional[int] = None,
    *,
    embed: Optional[EmbedFn] = None,
    search: Optional[SearchFn] = None,
    embedder_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Judiciary circular rows for ``query`` (best effort: any failure -> []). OFF unless flag is set."""
    name = collection()
    text = (query or "").strip()
    if not name or not text:
        return []
    try:
        if embed is None or search is None or embedder_name is None:
            from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng

            embed = embed or eng._embed_query_sync
            embedder_name = embedder_name or eng.QDRANT_EMBED_MODEL_NAME

            async def _search(vec: List[float], coll: str, k: int):
                return await eng._qdrant_vector_search_httpx(vec, coll, k, True)

            search = search or _search
        if embedder_name != EXPECTED_EMBEDDER:
            logger.warning(
                "judiciary circulars collection %s needs %s but query embedder is %s; skipped",
                name, EXPECTED_EMBEDDER, embedder_name,
            )
            return []
        k = limit or default_limit()
        vector = await asyncio.to_thread(embed, text)
        if vector is None:
            return []
        payloads = await search(vector, name, max(k * 4, 8))
        return hits_to_rows(payloads or [], limit=k)
    except Exception as exc:  # noqa: BLE001 - optional extra, never break chat
        logger.warning("judiciary circulars retrieval failed: %s", exc)
        return []
