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
import datetime as _dt
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
        "valid_from": payload.get("valid_from"),
        "valid_to": payload.get("valid_to"),
        "status": payload.get("status"),
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


_DIGIT_TRANS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _norm_issuer(text: str) -> str:
    s = str(text or "").translate(_DIGIT_TRANS)
    s = s.replace("ي", "ی").replace("ك", "ک").replace("‌", " ").replace("ٔ", "").replace("ة", "ه").replace("ئ", "ی").replace("أ", "ا").replace("إ", "ا").replace("ؤ", "و")
    s = s.replace("ریاست", "رییس").replace("رئیس", "رییس")
    s = s.replace("هیأت", "هیئت").replace("هیات", "هیئت").replace("هییت", "هیئت")
    s = s.replace("قضائیه", "قضاییه")
    return re.sub(r"\s+", " ", s).strip()


def _matches_issuer(payload: dict, issuer_query: str) -> bool:
    if not issuer_query:
        return True
    field_val = " ".join(str(payload.get(k) or "") for k in ("issuer", "authority", "issuing_body", "law_name"))
    nf = _norm_issuer(field_val)
    nq = _norm_issuer(issuer_query)
    if nq in nf or nf in nq:
        return True
    stop_words = {"کل", "کشور", "جمهوری", "اسلامی", "ایران", "سازمان", "عمومی"}
    words = [w for w in nq.split() if w not in stop_words]
    return bool(words) and all(w in nf for w in words)


_INACTIVE_STATUSES = {
    "repealed", "revoked", "cancelled", "canceled", "superseded", "expired", "inactive",
    "منسوخ", "لغو شده", "ملغی", "ابطال شده",  # Persian has no case; .lower() leaves these as-is
}


def is_inactive(r: dict) -> bool:
    """True for rows never shown as a current rule (inactive flag or repeal-type status)."""
    if r.get("is_active") is False:
        return True
    status = str(r.get("status") or "").strip().lower()
    return status in _INACTIVE_STATUSES


def is_trusted(r: dict) -> bool:
    """Official tier AND not waiting for review (single definition; catalog_intent imports it).

    Everything else is worded as unofficial / under review."""
    tier = str(r.get("source_tier") or "").strip().lower()
    return tier == "official" and not r.get("needs_review")


def gregorian_to_jalali(gy: int, gm: int, gd: int) -> tuple:
    """Exact Gregorian -> Jalali conversion, stdlib only.

    Standard day-count arithmetic used by jalaali-js / jdatetime: 355666 is the day offset between the
    two epochs, 12053 days = one 33-year Jalali cycle, 1461 days = a 4-year group, and months 1-6 have
    31 days (186 days) while 7-12 have 30."""
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    gy2 = gy + 1 if gm > 2 else gy
    days = (355666 + 365 * gy + (gy2 + 3) // 4 - (gy2 + 99) // 100 + (gy2 + 399) // 400
            + gd + g_d_m[gm - 1])
    jy = -1595 + 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    if days < 186:
        return (jy, 1 + days // 31, 1 + days % 31)
    return (jy, 7 + (days - 186) // 30, 1 + (days - 186) % 30)


def is_jalali_leap(jy: int) -> bool:
    """Jalali leap year: 1 Farvardin of the next year falls 366 days later."""
    return (_dt.date(*_jalali_new_year(jy + 1)) - _dt.date(*_jalali_new_year(jy))).days == 366


def _jalali_new_year(jy: int) -> tuple:
    """Gregorian (y, m, d) of 1 Farvardin jy (Nowruz falls on 19-22 March)."""
    gy = jy + 621
    for day in (19, 20, 21, 22):
        if gregorian_to_jalali(gy, 3, day) == (jy, 1, 1):
            return (gy, 3, day)
    raise ValueError(f"no Nowruz found for {jy}")


def _jalali_month_days(jy: int, jm: int) -> int:
    if jm <= 6:
        return 31
    if jm <= 11:
        return 30
    return 30 if is_jalali_leap(jy) else 29


def validated_date(r: dict, today: Optional[_dt.date] = None) -> Optional[tuple]:
    """Jalali (y, m, d) when the row's date parses, is plausible and not in the future, else None.

    OCR rows often carry reversed (d/m/y) or garbled dates; those must never win 'latest'."""
    raw = str(
        r.get("date_iso")
        or r.get("approval_date")
        or r.get("approved_on")
        or r.get("date")
        or r.get("meeting_date")
        or ""
    ).strip().translate(_DIGIT_TRANS)
    parts = [int(p) for p in re.findall(r"\d+", raw)]
    if len(parts) < 3:
        return None
    y, m, d = parts[0], parts[1], parts[2]
    if not (1 <= m <= 12 and 1 <= d <= 31):
        return None
    t = today or _dt.date.today()
    today_j = gregorian_to_jalali(t.year, t.month, t.day)
    if 1900 <= y <= 2100:  # Gregorian: real, not in the future, converted to Jalali for ordering
        try:
            g = _dt.date(y, m, d)
        except ValueError:
            return None
        if g > t:
            return None
        return gregorian_to_jalali(y, m, d)
    if 1300 <= y and (y, m, d) <= today_j and d <= _jalali_month_days(y, m):
        return (y, m, d)
    return None


def parse_and_sort(rows: Iterable[dict], today: Optional[_dt.date] = None) -> List[dict]:
    """Sort payloads/rows: validated date first (newest first), then official-and-reviewed rows,
    then the higher integer number. Rows without a trusted date sink."""
    def _key(r: dict):
        vd = validated_date(r, today)
        raw_num = str(
            r.get("number")
            or r.get("document_number")
            or r.get("number_raw")
            or r.get("item_no")
            or ""
        ).translate(_DIGIT_TRANS)
        num_m = re.findall(r"\d+", raw_num)
        num_val = int(num_m[-1]) if num_m else 0
        if not num_m and r.get("title"):
            t_m = re.findall(r"\d+", str(r.get("title")).translate(_DIGIT_TRANS))
            num_val = int(t_m[0]) if t_m else 0
        return (vd is not None, vd or (0, 0, 0), is_trusted(r), num_val)

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
    elif sub_collection in ("regulations", "regulation"):
        pairs = [("sub_collection", "regulations"), ("category", "REGULATION"),
                 ("doc_type", "circular"), ("doc_type", "board_resolution")]
    else:
        return None
    return {"should": [{"key": k, "match": {"value": v}} for k, v in pairs]}
_CACHE_TTL_S = 600.0


async def latest_rulings(
    limit: int = 5,
    sub_collection: Optional[str] = "unity_rulings",
    coll_name: Optional[str] = None,
    issuer: Optional[str] = None,
    as_of: Optional[str] = None,
    tz: Optional[Any] = None,
) -> List[dict]:
    """Return latest rulings/regulations sorted descending by date/number (cached 10m).
    
    Tries Qdrant scroll first, with fallback to staged JSONL files when Qdrant is offline.
    """
    is_reg = sub_collection in ("regulations", "circulars")
    if is_reg:
        from output_apps.generated_modules.smartjudge import regulations_retrieval as _regs
        coll = coll_name or _regs.collection() or os.environ.get("SMARTJUDGE_REGULATIONS_COLLECTION", "").strip() or "iran_regulations_v3"
    else:
        coll = coll_name or collection() or "iran_rulings_v1"

    cache_key = f"{coll}:{sub_collection}:{issuer or ''}:{limit}:{as_of or ''}:{tz or ''}"
    now = asyncio.get_event_loop().time()
    if cache_key in _LATEST_CACHE:
        ts, cached = _LATEST_CACHE[cache_key]
        if now - ts < _CACHE_TTL_S:
            return cached

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
        if is_reg:
            staged_files.extend([
                "data/legal/staged/cbi_circulars_2026-10-14.jsonl",
                "data/legal/staged/circulars_2026-10-13.jsonl",
                "data/legal/staged/deregulation_board_2026-10-13.jsonl",
                "data/legal/staged/ekhtebar_api_tag_cbi_2026-10-22.jsonl",
                "data/legal/staged/ekhtebar_api_tag_sabti_2026-10-22.jsonl",
            ])
        elif sub_collection in ("unity_rulings", "unity_supreme_court", None):
            staged_files.append("data/legal/staged/unity_rulings_2026-10-12.jsonl")
        elif sub_collection in ("admin_court_board", "admin_court", None):
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

    # 3. Filter by sub_collection / ruling_type / issuer if specified
    filtered = []
    for r in raw_payloads:
        if is_reg:
            if is_inactive(r):
                continue
            if issuer and not _matches_issuer(r, issuer):
                continue
            filtered.append(r)
        elif sub_collection in ("unity_rulings", "unity_supreme_court"):
            rtype = str(r.get("ruling_type") or "")
            sub_c = str(r.get("sub_collection") or "")
            if sub_c == "unity_rulings" or rtype == "unity_supreme_court" or "دیوان عالی" in str(r.get("issuing_body") or ""):
                filtered.append(r)
        elif sub_collection in ("admin_court_board", "admin_court"):
            rtype = str(r.get("ruling_type") or "")
            sub_c = str(r.get("sub_collection") or "")
            if sub_c == "admin_court_board" or rtype.startswith("admin_court") or "دیوان عدالت" in str(r.get("issuing_body") or ""):
                filtered.append(r)
        elif sub_collection in ("regulations", "regulation"):
            if sub_c == "regulations" or r.get("category") == "REGULATION" or r.get("doc_type") in ("circular", "board_resolution"):
                filtered.append(r)
        else:
            filtered.append(r)

    # 4. Sort descending by date and number
    sorted_items = parse_and_sort(filtered)
    if is_reg:
        # Same circular stored twice (official + OCR copy): keep the first; official sorts first.
        seen_keys: set = set()
        deduped = []
        for p in sorted_items:
            k = (str(p.get("number") or "").strip(), validated_date(p))
            if k[0] and k in seen_keys:
                continue
            seen_keys.add(k)
            deduped.append(p)
        sorted_items = deduped
        from output_apps.generated_modules.smartjudge import regulations_retrieval as _regs
        rows = [_regs.payload_to_row(p) for p in sorted_items]
    else:
        rows = [payload_to_row(p) for p in sorted_items]

    # 5. Law validity filtering per #1348/#1374
    from output_apps.generated_modules.smartjudge import abstention_gate as _ag
    rows = _ag.filter_by_as_of(rows, as_of_date=as_of)[:limit]

    if rows:  # never cache an empty answer: a transient outage would hide rulings for the whole TTL
        _LATEST_CACHE[cache_key] = (now, rows)
    return rows

