"""Read-only public regulations («بخشنامه‌ها و مقررات») API for the website's SEO pages.

Mirrors :mod:`laws_public`: on the first request this module scrolls the serving
Qdrant regulations collection (``with_vector=false``, page 512) into an
in-memory index, merges the chunks of each document by ``chunk_index``, and
caches the result for 6 hours behind an ``asyncio.Lock``. The collection is
named by ``SMARTJUDGE_REGULATIONS_COLLECTION``; for these public pages an empty
value falls back to ``iran_regulations_v1`` (the flag being unset keeps the
*retrieval* hook off — see :mod:`regulations_retrieval`).

A document's slug is a stable ``reg-`` + 12 hex of the sha1 of its Qdrant point
id (like ``laws_public``'s ``law-<sha1>``), so pagination and sitemap entries
never depend on ingestion order. Only public fields are ever returned; internal
ingestion metadata never leaves this module. No LLM is ever called and the
collection is never written to.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from output_apps.generated_modules.smartjudge import chat_auth
from output_apps.generated_modules.smartjudge.regulations_retrieval import (
    regulation_title,
)

router = APIRouter(prefix="/regulations-public", tags=["SmartJudge Public Regulations"])

# ── config ──────────────────────────────────────────────────────────────────
QDRANT_HOST = os.environ.get("QDRANT_HOST", "roxira_qdrant_prod")
QDRANT_PORT = os.environ.get("QDRANT_PORT", "6333")
QDRANT_DEFAULT_COLLECTION = "iran_regulations_v1"
QDRANT_HOST_CANDIDATES = tuple(
    dict.fromkeys([QDRANT_HOST, "qdrant_prod", "qdrant", "127.0.0.1", "localhost"])
)

ENV_COLLECTION = "SMARTJUDGE_REGULATIONS_COLLECTION"
_OFF = {"0", "off", "false", "no", "none"}

CACHE_TTL_SECONDS = 6 * 3600
SCROLL_PAGE = 512
SCROLL_TIMEOUT_SECONDS = 10.0
RATE_LIMIT_PER_MINUTE = 120
SITEMAP_MAX_LIMIT = 5000
DEFAULT_LIST_LIMIT = 50
OTHER_ISSUER = "سایر"
CACHE_CONTROL = "public, max-age=3600"


def _collection() -> str:
    """Collection to read; an empty/off flag falls back to the default for public pages."""
    raw = os.environ.get(ENV_COLLECTION, "").strip()
    if raw and raw.lower() not in _OFF:
        return raw
    return QDRANT_DEFAULT_COLLECTION


def regulation_slug(point_id: Any) -> str:
    """Regulation slug: ``reg-`` + 12 hex of the sha1 of the Qdrant point id."""
    digest = hashlib.sha1(str(point_id).encode("utf-8")).hexdigest()
    return f"reg-{digest[:12]}"


def _clean(value: Any) -> str:
    return " ".join(str(value or "").split())


def _document_date(payload: Dict[str, Any]) -> str:
    return _clean(
        payload.get("date")
        or payload.get("approved_on")
        or payload.get("meeting_date")
        or payload.get("approval_date")
    )


def _build_index(points: List[Any]) -> dict:
    """Group Qdrant points into regulations and merge each document's chunks."""
    documents: Dict[str, dict] = {}
    for point in points or []:
        if not isinstance(point, dict):
            continue
        doc_id = str(point.get("doc_id") or "").strip()
        point_id = str(point.get("_point_id") or "").strip()
        issuer = _clean(point.get("issuer"))
        title = _clean(regulation_title(point))
        if not doc_id and not point_id and not title:
            continue
        key = doc_id or point_id or title
        document = documents.get(key)
        if document is None:
            document = {
                "slug": regulation_slug(point_id or doc_id or title),
                "title": title,
                "issuer": issuer,
                "number": _clean(point.get("number")) or _clean(point.get("ref")),
                "date": _document_date(point),
                "doc_type": point.get("doc_type"),
                "subject": _clean(point.get("subject")),
                "source": point.get("source"),
                "source_url": point.get("source_url"),
                "source_tier": point.get("source_tier") or "unofficial",
                "status": point.get("status"),
                "needs_review": bool(point.get("needs_review")),
                "is_active": point.get("is_active", True),
                "_chunks": [],
            }
            documents[key] = document
        else:
            if not document["title"] and title:
                document["title"] = title
            if not document["issuer"] and issuer:
                document["issuer"] = issuer
            if not document["number"]:
                document["number"] = _clean(point.get("number")) or _clean(point.get("ref"))
            if not document["date"]:
                document["date"] = _document_date(point)
            if not document["source_url"] and point.get("source_url"):
                document["source_url"] = point.get("source_url")
            document["needs_review"] = document["needs_review"] or bool(
                point.get("needs_review")
            )

        try:
            chunk_index = int(point.get("chunk_index") or 0)
        except (TypeError, ValueError):
            chunk_index = 0
        body = str(point.get("full_text") or point.get("text") or "")
        document["_chunks"].append((chunk_index, body))

    document_list: List[dict] = []
    for document in documents.values():
        document["_chunks"].sort(key=lambda item: item[0])
        document["text"] = "\n".join(text for _, text in document["_chunks"] if text)
        del document["_chunks"]
        document_list.append(document)
    document_list.sort(key=lambda item: (item["issuer"], item["title"]))

    issuers: Dict[str, int] = {}
    for document in document_list:
        key = document["issuer"] or OTHER_ISSUER
        issuers[key] = issuers.get(key, 0) + 1

    by_slug = {document["slug"]: document for document in document_list}
    entries = [
        {"path": f"/regulations/{document['slug']}", "lastmod": document["date"] or None}
        for document in document_list
    ]
    return {
        "documents": document_list,
        "by_slug": by_slug,
        "issuers": [{"issuer": name, "count": count} for name, count in sorted(issuers.items())],
        "entries": entries,
    }


async def _scroll_collection() -> List[dict]:
    """Scroll the whole regulations collection (``with_vector=false``, page 512), read-only."""
    import httpx

    collection = _collection()
    base_body = {"limit": SCROLL_PAGE, "with_payload": True, "with_vector": False}
    async with httpx.AsyncClient(timeout=SCROLL_TIMEOUT_SECONDS) as client:
        for host in QDRANT_HOST_CANDIDATES:
            url = f"http://{host}:{QDRANT_PORT}/collections/{collection}/points/scroll"
            collected: List[dict] = []
            offset = None
            try:
                while True:
                    body = dict(base_body)
                    if offset is not None:
                        body["offset"] = offset
                    response = await client.post(url, json=body)
                    response.raise_for_status()
                    result = (response.json() or {}).get("result") or {}
                    points = result.get("points") or []
                    for point in points:
                        if not isinstance(point, dict):
                            continue
                        payload = point.get("payload")
                        if isinstance(payload, dict):
                            enriched = dict(payload)
                            enriched["_point_id"] = point.get("id")
                            collected.append(enriched)
                    offset = result.get("next_page_offset")
                    if offset is None or not points:
                        break
            except Exception:
                continue
            return collected
    return []


_index_lock = asyncio.Lock()
_index_cache: Dict[str, Any] = {"data": None, "expires_at": 0.0}


async def _get_index() -> dict:
    """Return the cached index, rebuilding it (once) when stale."""
    data = _index_cache.get("data")
    if data is not None and _index_cache.get("expires_at", 0.0) > time.time():
        return data
    async with _index_lock:
        data = _index_cache.get("data")
        if data is not None and _index_cache.get("expires_at", 0.0) > time.time():
            return data
        data = _build_index(await _scroll_collection())
        _index_cache["data"] = data
        _index_cache["expires_at"] = time.time() + CACHE_TTL_SECONDS
        return data


def reset_cache_for_tests() -> None:
    _index_cache["data"] = None
    _index_cache["expires_at"] = 0.0


def _json(content: Any, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        content=content,
        status_code=status_code,
        headers={"Cache-Control": CACHE_CONTROL},
    )


async def _rate_limit_response(request: Request) -> Optional[JSONResponse]:
    """Per-IP limit (120/min) using the shared ``chat_auth.incr`` counter."""
    ip = chat_auth.request_ip(request)
    count, retry_after = await asyncio.to_thread(
        chat_auth.incr, f"regulations_public:rl:{ip}", 60
    )
    if count > RATE_LIMIT_PER_MINUTE:
        return chat_auth.rate_limited(retry_after, anonymous=True)
    return None


def _list_item(document: dict) -> dict:
    return {
        "slug": document["slug"],
        "title": document["title"],
        "number": document["number"] or None,
        "date": document["date"] or None,
        "issuer": document["issuer"] or None,
    }


def _detail(document: dict) -> dict:
    return {
        "slug": document["slug"],
        "title": document["title"],
        "number": document["number"] or None,
        "date": document["date"] or None,
        "issuer": document["issuer"] or None,
        "subject": document["subject"] or None,
        "doc_type": document["doc_type"],
        "text": document["text"],
        "source": document["source"],
        "source_url": document["source_url"],
        "source_tier": document["source_tier"],
        "needs_review": bool(document["needs_review"]),
        "status": document["status"],
    }


@router.get("/index")
async def regulations_index(request: Request):
    denied = await _rate_limit_response(request)
    if denied is not None:
        return denied
    index = await _get_index()
    return _json({"issuers": index["issuers"], "total": len(index["documents"])})


@router.get("/list")
async def regulations_list(
    request: Request,
    issuer: Optional[str] = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(DEFAULT_LIST_LIMIT, ge=1, le=SITEMAP_MAX_LIMIT),
):
    denied = await _rate_limit_response(request)
    if denied is not None:
        return denied
    index = await _get_index()
    documents = index["documents"]
    wanted = (issuer or "").strip()
    if wanted:
        documents = [
            document for document in documents if (document["issuer"] or OTHER_ISSUER) == wanted
        ]
    window = documents[offset: offset + limit]
    return _json({"total": len(documents), "items": [_list_item(document) for document in window]})


@router.get("/sitemap-entries")
async def sitemap_entries(
    request: Request,
    offset: int = Query(0, ge=0),
    limit: int = Query(1000, ge=1, le=SITEMAP_MAX_LIMIT),
):
    denied = await _rate_limit_response(request)
    if denied is not None:
        return denied
    index = await _get_index()
    entries = index["entries"]
    return _json({"total": len(entries), "entries": entries[offset: offset + limit]})


@router.get("/{slug}")
async def regulation_detail(slug: str, request: Request):
    denied = await _rate_limit_response(request)
    if denied is not None:
        return denied
    index = await _get_index()
    document = index["by_slug"].get((slug or "").strip().lower())
    if document is None:
        return _json({"detail": "Not Found"}, status_code=404)
    return _json(_detail(document))
