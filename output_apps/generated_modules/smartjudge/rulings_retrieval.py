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
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional, Sequence

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


def parse_and_sort(rows: Iterable[dict]) -> List[dict]:
    """Sort ruling payloads/rows descending by date then by integer ruling number."""
    def _key(r: dict):
        date_iso = str(r.get("date_iso") or "").strip()
        date_fa = str(r.get("date") or "").strip().translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789"))
        fa_tuple = (0, 0, 0)
        if date_fa:
            parts = [int(p) for p in re.findall(r"\d+", date_fa)]
            if len(parts) >= 3:
                fa_tuple = (parts[0], parts[1], parts[2])
            elif len(parts) == 1:
                fa_tuple = (parts[0], 0, 0)
        raw_num = str(r.get("number") or r.get("number_raw") or "").translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789"))
        num_m = re.search(r"\d+", raw_num)
        if not num_m and r.get("title"):
            num_m = re.search(r"\d+", str(r.get("title")).translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")))
        num_val = int(num_m.group(0)) if num_m else 0
        return (date_iso, fa_tuple, num_val)

    return sorted(list(rows or []), key=_key, reverse=True)


_LATEST_CACHE: Dict[str, tuple[float, List[dict]]] = {}
_SCROLL_PAGE = 500
_SCROLL_MAX_PAGES = 10


def _scroll_filter(sub_collection: Optional[str]) -> Optional[dict]:
    """Server-side narrowing for the latest-rulings scroll, so the page limit cannot hide matching rows."""
    if sub_collection in ("unity_rulings", "unity_supreme_court"):
        pairs = [("sub_collection", "unity_rulings"), ("ruling_type", "unity_supreme_court")]
    elif sub_collection in ("admin_court_board", "admin_court"):
        pairs = [("sub_collection", "admin_court_board"), ("ruling_type", "admin_court"),
                 ("ruling_type", "admin_court_board")]
    else:
        return None
    return {"should": [{"key": k, "match": {"value": v}} for k, v in pairs]}
_CACHE_TTL_S = 600.0


async def latest_rulings(
    limit: int = 5,
    sub_collection: Optional[str] = "unity_rulings",
    coll_name: Optional[str] = None
) -> List[dict]:
    """Return latest rulings sorted descending by date/number (cached 10m).
    
    Tries Qdrant scroll first, with fallback to staged JSONL files when Qdrant is offline.
    """
    cache_key = f"{coll_name or collection()}:{sub_collection}:{limit}"
    now = asyncio.get_event_loop().time()
    if cache_key in _LATEST_CACHE:
        ts, cached = _LATEST_CACHE[cache_key]
        if now - ts < _CACHE_TTL_S:
            return cached

    coll = coll_name or collection() or "iran_rulings_v1"
    raw_payloads: List[dict] = []

    # 1. Try Qdrant scroll if reachable
    try:
        from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng
        import httpx
        body: Dict[str, Any] = {"limit": _SCROLL_PAGE, "with_payload": True, "with_vector": False}
        server_filter = _scroll_filter(sub_collection)
        if server_filter:
            body["filter"] = server_filter
        async with httpx.AsyncClient(timeout=4.0) as client:
            # Local Qdrant first, then the read-only Qdrant Cloud replicas (same targets as the vector search).
            for host, base, hdrs in eng._qdrant_targets():
                try:
                    pages = 0
                    page_body = dict(body)
                    while pages < _SCROLL_MAX_PAGES:
                        resp = await client.post(
                            f"{base}/collections/{coll}/points/scroll", json=page_body, headers=hdrs
                        )
                        if pages == 0 and eng._qcloud.skip_cloud_response(host, getattr(resp, "status_code", 0)):
                            break
                        if resp.status_code != 200:
                            break
                        result = resp.json().get("result", {})
                        for pt in result.get("points", []):
                            payload = pt.get("payload")
                            if isinstance(payload, dict):
                                raw_payloads.append(payload)
                        pages += 1
                        nxt = result.get("next_page_offset")
                        if not nxt:
                            break
                        page_body["offset"] = nxt
                    if pages:
                        eng._qcloud.record(host, True)
                except Exception as exc:  # noqa: BLE001
                    logger.debug("rulings scroll host %s unreachable: %s", host, exc)
                    eng._qcloud.record(host, False, type(exc).__name__)
                    continue
                if raw_payloads:
                    break
    except Exception as exc:
        logger.debug("Qdrant scroll offline or failed: %s", exc)

    # 2. Fallback to staged files if Qdrant didn't return points
    if not raw_payloads:
        import json
        staged_files = []
        if sub_collection in ("unity_rulings", "unity_supreme_court", None):
            staged_files.append("data/legal/staged/unity_rulings_2026-10-12.jsonl")
        if sub_collection in ("admin_court_board", "admin_court", None):
            staged_files.append("data/legal/staged/admin_court_board_rulings_2026-10-12.jsonl")
        
        for sf in staged_files:
            p = os.path.abspath(sf)
            if not os.path.exists(p):
                # Search up to repo root
                cur = os.path.dirname(os.path.abspath(__file__))
                for _ in range(5):
                    candidate = os.path.join(cur, sf)
                    if os.path.exists(candidate):
                        p = candidate
                        break
                    cur = os.path.dirname(cur)
            if os.path.exists(p):
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if line:
                                raw_payloads.append(json.loads(line))
                except Exception as exc:
                    logger.debug("Failed to read staged file %s: %s", p, exc)

    # 3. Filter by sub_collection / ruling_type if specified
    filtered = []
    for r in raw_payloads:
        rtype = str(r.get("ruling_type") or "")
        sub_c = str(r.get("sub_collection") or "")
        if sub_collection in ("unity_rulings", "unity_supreme_court"):
            if sub_c == "unity_rulings" or rtype == "unity_supreme_court" or "دیوان عالی" in str(r.get("issuing_body") or ""):
                filtered.append(r)
        elif sub_collection in ("admin_court_board", "admin_court"):
            if sub_c == "admin_court_board" or rtype.startswith("admin_court") or "دیوان عدالت" in str(r.get("issuing_body") or ""):
                filtered.append(r)
        else:
            filtered.append(r)

    # 4. Sort descending by date and number
    sorted_items = parse_and_sort(filtered)
    rows = [payload_to_row(p) for p in sorted_items[:limit]]
    if rows:  # never cache an empty answer: a transient outage would hide rulings for the whole TTL
        _LATEST_CACHE[cache_key] = (now, rows)
    return rows

