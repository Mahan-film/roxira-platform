"""Read-only public laws API for the website's SEO law pages (no auth, no LLM).

The serving Qdrant collection already holds the statute chunks. On the first
request this module scrolls the whole collection (``with_vector=false``, page
512) into an in-memory index, merges the chunks of each ``(law_id, article_no)``
by ``chunk_index``, and caches the result for 6 hours behind an ``asyncio.Lock``.

Only public fields are ever returned; internal ingestion metadata
(``content_hash``, ``ingest_pipeline``, ``review_reasons``, ``fetched_at``) never
leaves this module. No LLM is ever called.
"""
from __future__ import annotations

import asyncio
import os
import re
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from output_apps.generated_modules.smartjudge import chat_auth

router = APIRouter(prefix="/laws-public", tags=["SmartJudge Public Laws"])

# ── config ──────────────────────────────────────────────────────────────────
QDRANT_HOST = os.environ.get("QDRANT_HOST", "roxira_qdrant_prod")
QDRANT_PORT = os.environ.get("QDRANT_PORT", "6333")
QDRANT_DEFAULT_COLLECTION = "iran_laws_v3"
QDRANT_HOST_CANDIDATES = tuple(
    dict.fromkeys([QDRANT_HOST, "qdrant_prod", "qdrant", "127.0.0.1", "localhost"])
)

CACHE_TTL_SECONDS = 6 * 3600
SCROLL_PAGE = 512
SCROLL_TIMEOUT_SECONDS = 10.0
RATE_LIMIT_PER_MINUTE = 120
SITEMAP_MAX_LIMIT = 5000
CACHE_CONTROL = "public, max-age=3600"

_DIGIT_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _collection() -> str:
    return (
        os.environ.get("LIGHTRAG_QDRANT_COLLECTION", "").strip()
        or QDRANT_DEFAULT_COLLECTION
    )


def _slugify(value: Any) -> str:
    return re.sub(r"[^a-z0-9-]", "-", str(value or "").lower())


def law_slug(law_id: Any) -> str:
    """Law slug: ``law_id`` lowercased, any char outside ``[a-z0-9-]`` -> ``-``."""
    return _slugify(law_id)


def article_slug(article_no: Any) -> str:
    """Article slug: Persian/Arabic digits normalised to ASCII, then slugified."""
    return _slugify(str(article_no or "").translate(_DIGIT_MAP))


def _article_order_key(slug: str) -> tuple:
    """Natural article order: numeric part first, then any ``-suffix``."""
    match = re.match(r"^(\d+)(?:-(\d+))?", slug)
    if match:
        return (0, int(match.group(1)), int(match.group(2) or 0), slug)
    return (1, 0, 0, slug)


def _build_index(payloads: List[Any]) -> dict:
    """Group chunks into laws/articles and merge each article's text."""
    laws: Dict[str, dict] = {}
    for payload in payloads or []:
        if not isinstance(payload, dict):
            continue
        law_id = str(payload.get("law_id") or "").strip()
        if not law_id:
            continue
        law = laws.get(law_id)
        if law is None:
            law = {
                "slug": law_slug(law_id),
                "name": str(payload.get("law_name") or law_id),
                "law_type": payload.get("law_type"),
                "approval_date": payload.get("approval_date"),
                "source": payload.get("source"),
                "source_url": payload.get("source_url"),
                "articles": {},
            }
            laws[law_id] = law
        elif not law["name"] and payload.get("law_name"):
            law["name"] = str(payload["law_name"])

        article_no = str(payload.get("article_no") or "").strip()
        slug = article_slug(article_no)
        if not slug:
            continue
        article = law["articles"].get(slug)
        if article is None:
            article = {
                "slug": slug,
                "label": str(payload.get("article_label") or article_no),
                "status": payload.get("status"),
                "is_active": payload.get("is_active"),
                "approval_date": payload.get("approval_date"),
                "amended_on": payload.get("amended_on"),
                "needs_review": payload.get("needs_review"),
                "source": payload.get("source"),
                "source_url": payload.get("source_url"),
                "_chunks": [],
            }
            law["articles"][slug] = article
        try:
            chunk_index = int(payload.get("chunk_index") or 0)
        except (TypeError, ValueError):
            chunk_index = 0
        article["_chunks"].append((chunk_index, str(payload.get("text") or "")))

    law_list: List[dict] = []
    for law in laws.values():
        for article in law["articles"].values():
            article["_chunks"].sort(key=lambda item: item[0])
            article["text"] = "\n".join(text for _, text in article["_chunks"])
            del article["_chunks"]
        law["order"] = sorted(law["articles"].keys(), key=_article_order_key)
        law_list.append(law)
    law_list.sort(key=lambda item: item["name"])

    by_slug = {law["slug"]: law for law in law_list}
    entries = []
    for law in law_list:
        for slug in law["order"]:
            article = law["articles"][slug]
            entries.append(
                {
                    "path": f"/laws/{law['slug']}/{slug}",
                    "lastmod": (
                        article.get("amended_on")
                        or article.get("approval_date")
                        or law.get("approval_date")
                    ),
                }
            )
    return {"laws": law_list, "by_slug": by_slug, "entries": entries}


async def _scroll_collection() -> List[dict]:
    """Scroll the whole serving collection (``with_vector=false``, page 512)."""
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
                        payload = point.get("payload") if isinstance(point, dict) else None
                        if isinstance(payload, dict):
                            collected.append(payload)
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
        chat_auth.incr, f"laws_public:rl:{ip}", 60
    )
    if count > RATE_LIMIT_PER_MINUTE:
        return chat_auth.rate_limited(retry_after, anonymous=True)
    return None


def _law_index_item(law: dict) -> dict:
    return {
        "slug": law["slug"],
        "name": law["name"],
        "law_type": law["law_type"],
        "articles_count": len(law["articles"]),
        "approval_date": law["approval_date"],
    }


def _article_summary(article: dict) -> dict:
    return {
        "slug": article["slug"],
        "label": article["label"],
        "status": article["status"],
        "is_active": article["is_active"],
    }


def _article_detail(article: dict) -> dict:
    return {
        "slug": article["slug"],
        "label": article["label"],
        "text": article["text"],
        "status": article["status"],
        "is_active": article["is_active"],
        "approval_date": article["approval_date"],
        "amended_on": article["amended_on"],
        "needs_review": article["needs_review"],
        "source": article["source"],
        "source_url": article["source_url"],
    }


@router.get("/index")
async def laws_index(request: Request):
    denied = await _rate_limit_response(request)
    if denied is not None:
        return denied
    index = await _get_index()
    return _json([_law_index_item(law) for law in index["laws"]])


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
    return _json(
        {"total": len(entries), "entries": entries[offset: offset + limit]}
    )


@router.get("/{law}")
async def law_detail(law: str, request: Request):
    denied = await _rate_limit_response(request)
    if denied is not None:
        return denied
    index = await _get_index()
    law_obj = index["by_slug"].get((law or "").strip().lower())
    if law_obj is None:
        return _json({"detail": "Not Found"}, status_code=404)
    return _json(
        {
            "slug": law_obj["slug"],
            "name": law_obj["name"],
            "law_type": law_obj["law_type"],
            "approval_date": law_obj["approval_date"],
            "source": law_obj["source"],
            "source_url": law_obj["source_url"],
            "articles": [
                _article_summary(law_obj["articles"][slug])
                for slug in law_obj["order"]
            ],
        }
    )


@router.get("/{law}/{article}")
async def article_detail(law: str, article: str, request: Request):
    denied = await _rate_limit_response(request)
    if denied is not None:
        return denied
    index = await _get_index()
    law_obj = index["by_slug"].get((law or "").strip().lower())
    if law_obj is None:
        return _json({"detail": "Not Found"}, status_code=404)
    slug = (article or "").strip().lower()
    article_obj = law_obj["articles"].get(slug)
    if article_obj is None:
        return _json({"detail": "Not Found"}, status_code=404)
    order = law_obj["order"]
    position = order.index(slug)
    return _json(
        {
            "law": {"slug": law_obj["slug"], "name": law_obj["name"]},
            "article": _article_detail(article_obj),
            "prev_slug": order[position - 1] if position > 0 else None,
            "next_slug": order[position + 1] if position + 1 < len(order) else None,
        }
    )
