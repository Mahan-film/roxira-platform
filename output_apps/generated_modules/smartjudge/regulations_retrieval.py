"""Regulations retrieval («مقررات»): deregulation-board resolutions + Central Bank of Iran (CBI) circulars.

Behind the flag ``SMARTJUDGE_REGULATIONS_COLLECTION`` (default: unset = OFF, zero behaviour change). When it names a
Qdrant collection (``iran_regulations_v1``, built by scripts/legal/build_regulations_collection_on_server.sh from the
deregulation-board and CBI-circular staged files, bge-m3 vectors like ``iran_laws_v3`` / ``iran_rulings_v1``) the
regulation hits are searched and returned in the existing *precedent* row shape, so callers can reuse the same
filters. They are labelled (``kind="regulation"``, ``category="REGULATION"``) so they stay separate from statutory
articles. Wired into chat by smartjudge_module (own prompt block and the ``regulations`` response field).

Pure helpers (no I/O) are unit-tested offline; ``retrieve_regulations`` takes injectable ``embed``/``search``
callables. Regulations are an unofficial copy; ``source_tier`` travels in the row.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional, Sequence

logger = logging.getLogger(__name__)

try:
    from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as _eng
except Exception:  # noqa: BLE001
    _eng = None

ENV_COLLECTION = "SMARTJUDGE_REGULATIONS_COLLECTION"
ENV_MIN_SCORE = "SMARTJUDGE_REGULATIONS_MIN_SCORE"
ENV_LIMIT = "SMARTJUDGE_REGULATIONS_LIMIT"
DEFAULT_MIN_SCORE = 0.55
DEFAULT_LIMIT = 3
EXPECTED_EMBEDDER = "BAAI/bge-m3"
CATEGORY = "REGULATION"
MATCH_LEVEL = "REGULATION_VECTOR"
_OFF = {"", "0", "off", "false", "no", "none"}

TYPE_LABELS = {
    "board_resolution": "مصوبه هیئت مقررات‌زدایی",
    "circular": "بخشنامه بانک مرکزی",
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
def regulation_title(payload: Dict[str, Any]) -> str:
    """«{issuer} - {subject}»; falls back to the stored ``title``/``ref`` when a field is missing."""
    title = " ".join(str(payload.get("title") or "").split())
    if title:
        return title
    issuer = " ".join(str(payload.get("issuer") or "").split())
    subject = " ".join(str(payload.get("subject") or "").split())
    if issuer and subject:
        return f"{issuer} \u2014 {subject}"
    label = TYPE_LABELS.get(str(payload.get("doc_type") or ""), "")
    return " ".join(x for x in (label, issuer, subject, str(payload.get("ref") or "")) if x)


def payload_to_row(payload: Dict[str, Any], vector_score: Optional[float] = None) -> Dict[str, Any]:
    doc_type = str(payload.get("doc_type") or "")
    body = str(payload.get("full_text") or payload.get("text") or "")
    date = payload.get("date") or payload.get("approved_on") or payload.get("meeting_date")
    return {
        "title": regulation_title(payload),
        "kind": "regulation",
        "category": CATEGORY,
        "doc_type": doc_type,
        "doc_id": str(payload.get("doc_id") or ""),
        "ref": str(payload.get("ref") or ""),
        "issuer": str(payload.get("issuer") or ""),
        "number": str(payload.get("number") or ""),
        "date": str(date or ""),
        "subject": str(payload.get("subject") or ""),
        "needs_review": bool(payload.get("needs_review")),
        "summary": " ".join(body.split())[:1200],
        "source_url": payload.get("source_url"),
        "source_tier": payload.get("source_tier") or "unofficial",
        "match_level": MATCH_LEVEL,
        "vector_score": vector_score,
        "source": f"qdrant:{collection() or 'regulations'}",
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
        key = (p.get("doc_id"), p.get("chunk_index"))
        if key == (None, None):
            key = (p.get("ref"), p.get("title"))
        if key in seen:
            continue
        seen.add(key)
        scored.append((float(score), p))
    scored.sort(key=lambda x: -x[0])
    return [payload_to_row(p, s) for s, p in scored[: max(1, limit)]]


def is_regulation(row: Any) -> bool:
    return isinstance(row, dict) and str(row.get("category") or "") == CATEGORY


BLOCK_TITLE = "بخشنامه‌ها و مقررات"


def split_regulations(rows: Optional[Sequence[Any]]) -> tuple:
    """(regulations, everything else) preserving order."""
    regs, others = [], []
    for r in rows or []:
        (regs if is_regulation(r) else others).append(r)
    return regs, others


def _short(text: Any, limit: int) -> str:
    s = " ".join(str(text or "").split())
    return s if len(s) <= limit else s[: max(0, limit - 1)].rstrip() + "…"


def context_block(rows: Optional[Sequence[Any]], *, top_k: int = 3, summary_chars: int = 500) -> str:
    """Prompt text for the separate «بخشنامه‌ها و مقررات» block; each line carries issuer, number and date."""
    lines = []
    for r in list(rows or [])[:top_k]:
        if not isinstance(r, dict):
            continue
        meta = "، ".join(x for x in (r.get("issuer"), f"شماره {r['number']}" if r.get("number") else "",
                                      f"تاریخ {r['date']}" if r.get("date") else "") if x)
        lines.append(f"- {r.get('title')} ({meta}): {_short(r.get('summary'), summary_chars)}")
    if not lines:
        return ""
    return (f"\n{BLOCK_TITLE} (بخشنامه، نظر یا مصوبه اجرایی است نه قانون؛ شماره، تاریخ و مرجع صادرکننده را هنگام "
            "استناد ذکر کن و آن را جایگزین متن قانون نکن):\n" + "\n".join(lines))


def public_view(rows: Optional[Sequence[Any]], *, max_rows: int = 3, excerpt_chars: int = 240) -> List[Dict[str, Any]]:
    """Response form of the regulations block: title, issuer, number, date, short excerpt, source link."""
    out = []
    for r in list(rows or [])[:max_rows]:
        if not isinstance(r, dict):
            continue
        out.append({
            "title": r.get("title"), "issuer": r.get("issuer"), "number": r.get("number"), "date": r.get("date"),
            "doc_type": r.get("doc_type"), "excerpt": _short(r.get("summary"), excerpt_chars),
            "source_url": r.get("source_url"), "source_tier": r.get("source_tier"),
        })
    return out


# ----------------------------------------------------------------------------- retrieval
EmbedFn = Callable[[str], Optional[List[float]]]
SearchFn = Callable[[List[float], str, int], Awaitable[Optional[List[Dict[str, Any]]]]]


async def retrieve_regulations(
    query: str,
    limit: Optional[int] = None,
    *,
    embed: Optional[EmbedFn] = None,
    search: Optional[SearchFn] = None,
    embedder_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Regulation rows for ``query`` (best effort: any failure -> []). OFF unless the flag names a collection."""
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
            logger.warning("regulations collection %s needs %s but the query embedder is %s; skipped", name, EXPECTED_EMBEDDER, embedder_name)
            return []
        k = limit or default_limit()
        vector = await asyncio.to_thread(embed, text)
        if vector is None:
            return []
        payloads = await search(vector, name, max(k * 4, 8))
        return hits_to_rows(payloads or [], limit=k)
    except Exception as exc:  # noqa: BLE001 - regulations are an optional extra, never break the answer
        logger.warning("regulations retrieval failed: %s", exc)
        return []


_NUM_RE = re.compile(r"\d+")
_LATEST_CACHE: Dict[str, tuple[float, List[dict]]] = {}
_CACHE_TTL_S = 600.0
_SCROLL_PAGE = 64
_SCROLL_MAX_PAGES = 5


def parse_and_sort_regulations(rows: Iterable[dict]) -> List[dict]:
    """Sort regulation payloads/rows descending by date then by integer number."""
    def _key(r: dict):
        date_fa = str(r.get("date") or r.get("approved_on") or r.get("meeting_date") or "").strip().translate(
            str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
        )
        fa_tuple = (0, 0, 0)
        if date_fa:
            parts = [int(p) for p in re.findall(r"\d+", date_fa)]
            if len(parts) >= 3:
                fa_tuple = (parts[0], parts[1], parts[2])
            elif len(parts) == 1:
                fa_tuple = (parts[0], 0, 0)
        raw_num = str(r.get("number") or r.get("ref") or "").translate(
            str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
        )
        num_m = _NUM_RE.search(raw_num)
        if not num_m and r.get("title"):
            num_m = _NUM_RE.search(str(r.get("title")).translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")))
        num_val = int(num_m.group(0)) if num_m else 0
        return (fa_tuple, num_val)

    return sorted(list(rows or []), key=_key, reverse=True)


def _regulation_scroll_filter(issuer: Optional[str] = None) -> Optional[dict]:
    if not issuer:
        return None
    return {"must": [{"key": "issuer", "match": {"text": issuer}}]}


async def latest_regulations(
    limit: int = 5,
    issuer: Optional[str] = None,
    coll_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Return latest regulations sorted descending by date/number (cached 10m).

    Scrolls Qdrant collection when reachable, falls back to staged jsonl files.
    """
    cache_key = f"{coll_name or collection()}:{issuer}:{limit}"
    now = time.monotonic()
    if cache_key in _LATEST_CACHE:
        ts, cached = _LATEST_CACHE[cache_key]
        if now - ts < _CACHE_TTL_S:
            return cached

    coll = coll_name or collection() or "iran_regulations_v1"
    raw_payloads: List[dict] = []

    # 1. Try Qdrant scroll (when legal_graph engine is available)
    if _eng is not None:
        try:
            import httpx
            body: Dict[str, Any] = {"limit": _SCROLL_PAGE, "with_payload": True, "with_vector": False}
            sf = _regulation_scroll_filter(issuer)
            if sf:
                body["filter"] = sf
            async with httpx.AsyncClient(timeout=4.0) as client:
                req_timeout = httpx.Timeout(2.0, connect=1.0)
                for host, base, hdrs in _eng._qdrant_targets():
                    try:
                        pages = 0
                        page_body = dict(body)
                        while pages < _SCROLL_MAX_PAGES:
                            resp = await client.post(
                                f"{base}/collections/{coll}/points/scroll",
                                json=page_body,
                                headers=hdrs,
                                timeout=req_timeout,
                            )
                            if pages == 0 and _eng._qcloud.skip_cloud_response(host, resp.status_code):
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
                            _eng._qcloud.record(host, True)
                    except Exception as exc:  # noqa: BLE001
                        logger.debug("regulations scroll host %s unreachable: %s", host, exc)
                        _eng._qcloud.record(host, False, type(exc).__name__)
                        continue
                    if raw_payloads:
                        break
        except Exception as exc:  # noqa: BLE001
            logger.debug("Qdrant regulations scroll offline: %s", exc)

    # 2. Fallback to staged files
    if not raw_payloads:
        import json
        staged_files = [
            "data/legal/staged/cbi_circulars_2026-10-12.jsonl",
            "data/legal/staged/deregulation_board_2026-10-12.jsonl",
        ]
        for sf in staged_files:
            p = os.path.abspath(sf)
            if not os.path.exists(p):
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
                except Exception as exc:  # noqa: BLE001
                    logger.debug("Failed reading staged regulation file %s: %s", p, exc)
            else:
                logger.info("Staged regulation file %s not found on host", p)

    # 3. Filter by issuer if specified
    filtered = []
    for r in raw_payloads:
        if issuer and issuer not in str(r.get("issuer") or ""):
            continue
        filtered.append(r)

    # 4. Sort descending by date and number
    sorted_items = parse_and_sort_regulations(filtered)
    rows = [payload_to_row(p) for p in sorted_items[:limit]]
    if rows:
        _LATEST_CACHE[cache_key] = (now, rows)
    return rows

