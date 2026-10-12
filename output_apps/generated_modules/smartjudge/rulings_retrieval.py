"""Judicial-practice retrieval («رویه قضایی»): unity rulings + Administrative Court General Board rulings.

Behind the flag ``SMARTJUDGE_RULINGS_COLLECTION`` (default: unset = OFF, zero behaviour change). When it names a Qdrant
collection (``iran_rulings_v1``, built by scripts/legal/build_rulings_collection_on_server.sh from the ekhtebar.ir
staged files, bge-m3 vectors like ``iran_laws_v3``) the ruling hits are searched in parallel with the laws and
returned in the existing *precedent* row shape, so ``unified_precedents`` / ``source_filter`` / the chat prompt keep
working. They are labelled (``kind="precedent"``, ``category="RULING"``) so the chat can show them in their own
«رویه قضایی» block with the ruling number and date, separate from statutory articles.

Pure helpers (no I/O) are unit-tested offline; ``retrieve_rulings`` takes injectable ``embed``/``search`` callables.
Rulings are an unofficial copy (ekhtebar.ir), shown as such: ``source_tier`` travels in the row.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

ENV_COLLECTION = "SMARTJUDGE_RULINGS_COLLECTION"
ENV_MIN_SCORE = "SMARTJUDGE_RULINGS_MIN_SCORE"
ENV_LIMIT = "SMARTJUDGE_RULINGS_LIMIT"
DEFAULT_MIN_SCORE = 0.55
DEFAULT_LIMIT = 3
EXPECTED_EMBEDDER = "BAAI/bge-m3"
BLOCK_TITLE = "رویه قضایی"
RULING_CATEGORY = "RULING"
MATCH_LEVEL = "RULING_VECTOR"
_OFF = {"", "0", "off", "false", "no", "none"}

TYPE_LABELS = {
    "unity_supreme_court": "رأی وحدت رویه",
    "admin_court_unity": "رأی وحدت رویه",
    "admin_court_annulment": "دادنامه",
    "admin_court_board_other": "دادنامه",
}
BINDING = {
    "unity_supreme_court": "لازم‌الاتباع برای دادگاه‌ها (ماده ۴۷۱ ق.آ.د.ک)",
    "admin_court_unity": "لازم‌الاتباع برای شعب دیوان و مراجع اداری",
    "admin_court_annulment": "ابطال مقرره؛ معتبر و ملاک عمل در مراجع قضایی و اداری",
    "admin_court_board_other": "رأی هیئت عمومی دیوان عدالت اداری",
}


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


# ----------------------------------------------------------------------------- row shaping
def ruling_title(payload: Dict[str, Any]) -> str:
    """«رأی وحدت رویه شماره 882 هیئت عمومی دیوان عالی کشور – 1405/06/17»: the FIRST digits are the ruling number
    (source_filter.cited_in_answer matches a cited number against them)."""
    label = TYPE_LABELS.get(str(payload.get("ruling_type") or ""), "رأی")
    title = f"{label} شماره {payload.get('number')}"
    body = str(payload.get("issuing_body") or "").strip()
    if body:
        title += f" {body}"
    date = str(payload.get("date") or "").strip()
    if date:
        title += f" – {date}"
    return title


def payload_to_row(payload: Dict[str, Any], vector_score: Optional[float] = None) -> Dict[str, Any]:
    rtype = str(payload.get("ruling_type") or "")
    holding = str(payload.get("holding") or "").strip()
    summary = holding or str(payload.get("text") or payload.get("full_text") or "")
    return {
        "title": ruling_title(payload),
        "kind": "precedent",
        "category": RULING_CATEGORY,
        "ruling_type": rtype,
        "number": str(payload.get("number") or ""),
        "date": str(payload.get("date") or ""),
        "issuing_body": str(payload.get("issuing_body") or ""),
        "subject": str(payload.get("subject") or ""),
        "summary": " ".join(summary.split())[:1200],
        "binding_effect": BINDING.get(rtype, ""),
        "laws_referenced": list(payload.get("laws_referenced") or [])[:8],
        "source_url": payload.get("source_url"),
        "source_tier": payload.get("source_tier") or "unofficial",
        "match_level": MATCH_LEVEL,
        "vector_score": vector_score,
        "source": f"qdrant:{collection() or 'rulings'}",
    }


def hits_to_rows(payloads: Sequence[Dict[str, Any]], *, cutoff: Optional[float] = None, limit: int = DEFAULT_LIMIT) -> List[Dict[str, Any]]:
    """Qdrant payloads (each may carry ``_vector_score``) -> deduplicated rows above the cutoff, best score first."""
    cutoff = min_score() if cutoff is None else cutoff
    seen: set = set()
    scored: List[tuple] = []
    for p in payloads or []:
        if not isinstance(p, dict) or p.get("is_active") is False:
            continue
        score = p.get("_vector_score")
        if not isinstance(score, (int, float)) or isinstance(score, bool) or score < cutoff:
            continue
        key = p.get("ruling_id") or (p.get("ruling_type"), p.get("number"), p.get("date"))
        if key in seen:
            continue
        seen.add(key)
        scored.append((float(score), p))
    scored.sort(key=lambda x: -x[0])
    return [payload_to_row(p, s) for s, p in scored[: max(1, limit)]]


def is_ruling(row: Any) -> bool:
    return isinstance(row, dict) and str(row.get("category") or "") == RULING_CATEGORY


def split_rulings(precedents: Optional[Sequence[Any]]) -> tuple:
    """(rulings, other precedents) preserving order."""
    rulings, others = [], []
    for r in precedents or []:
        (rulings if is_ruling(r) else others).append(r)
    return rulings, others


def merge_rulings(precedents: Optional[Sequence[Any]], rulings: Optional[Sequence[Any]]) -> List[Any]:
    """Existing precedents first (unchanged order), ruling rows appended; a ruling whose (type, number) is already
    present is not added twice."""
    out = list(precedents or [])
    have = {(r.get("ruling_type"), r.get("number"), r.get("date")) for r in out if is_ruling(r)}
    for r in rulings or []:
        key = (r.get("ruling_type"), r.get("number"), r.get("date"))
        if key in have:
            continue
        have.add(key)
        out.append(r)
    return out


def _short(text: Any, limit: int) -> str:
    s = " ".join(str(text or "").split())
    return s if len(s) <= limit else s[: max(0, limit - 1)].rstrip() + "…"


def context_block(rulings: Optional[Sequence[Any]], *, top_k: int = 3, summary_chars: int = 500) -> str:
    """Prompt text for the separate «رویه قضایی» block; every line carries the ruling number and date."""
    lines = []
    for r in list(rulings or [])[:top_k]:
        if not isinstance(r, dict):
            continue
        extra = f" ({r['binding_effect']})" if r.get("binding_effect") else ""
        lines.append(f"- {r.get('title')}{extra}: {_short(r.get('summary'), summary_chars)}")
    if not lines:
        return ""
    return f"\n{BLOCK_TITLE} (آرای وحدت رویه و آرای هیئت عمومی دیوان عدالت اداری؛ شماره و تاریخ را هنگام استناد ذکر کن):\n" + "\n".join(lines)


def public_view(rulings: Optional[Sequence[Any]], *, max_rows: int = 5, excerpt_chars: int = 240) -> List[Dict[str, Any]]:
    """Response form of the «رویه قضایی» block: number, date, body, subject, short excerpt, source link."""
    out = []
    for r in list(rulings or [])[:max_rows]:
        if not isinstance(r, dict):
            continue
        out.append({
            "title": r.get("title"), "number": r.get("number"), "date": r.get("date"),
            "issuing_body": r.get("issuing_body"), "ruling_type": r.get("ruling_type"),
            "subject": _short(r.get("subject"), 200), "excerpt": _short(r.get("summary"), excerpt_chars),
            "binding_effect": r.get("binding_effect"), "source_url": r.get("source_url"),
            "source_tier": r.get("source_tier"),
        })
    return out


# ----------------------------------------------------------------------------- retrieval
EmbedFn = Callable[[str], Optional[List[float]]]
SearchFn = Callable[[List[float], str, int], Awaitable[Optional[List[Dict[str, Any]]]]]


async def retrieve_rulings(
    query: str,
    limit: Optional[int] = None,
    *,
    embed: Optional[EmbedFn] = None,
    search: Optional[SearchFn] = None,
    embedder_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Ruling rows for ``query`` (best effort: any failure -> []). OFF unless the flag names a collection."""
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
        if embedder_name != EXPECTED_EMBEDDER:  # vectors in the collection are bge-m3; a different query embedder = noise
            logger.warning("rulings collection %s needs %s but the query embedder is %s; skipped", name, EXPECTED_EMBEDDER, embedder_name)
            return []
        k = limit or default_limit()
        vector = await asyncio.to_thread(embed, text)
        if vector is None:
            return []
        payloads = await search(vector, name, max(k * 4, 8))
        return hits_to_rows(payloads or [], limit=k)
    except Exception as exc:  # noqa: BLE001 - rulings are an optional extra, never break the answer
        logger.warning("rulings retrieval failed: %s", exc)
        return []


_NUM_RE = re.compile(r"\d+")


def first_number(title: Any) -> Optional[str]:
    m = _NUM_RE.search(str(title or ""))
    return m.group(0) if m else None
