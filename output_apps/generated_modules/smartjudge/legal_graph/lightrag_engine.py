"""
موتور گراف دانش حقوقی بر پایهٔ LightRAG — لایهٔ بازیابی دوسطحی هستهٔ SmartJudge.

نصب موتور:  pip install lightrag-hku

معماری بازیابی سه‌لایه (هر لایه در نبود لایهٔ قبلی فعال می‌شود):
  لایهٔ ۱ — LightRAG (گراف موجودیت/رابطه + برداری، حالت hybrid/mix)
  لایهٔ ۲ — دو بازیابی SQL بومی (`src.legal_intelligence.dual_retrieval`)
  لایهٔ ۳ — پاسخ قالبی امن (`_fallback_knowledge_graph`)

خروجی همهٔ لایه‌ها یک قرارداد ثابت است: (laws, precedents).

قرارداد هم‌روندی (asyncio):
  FastAPI کاملاً async است، پس مسیر اصلی همیشه مستقیماً ``await`` می‌کند
  (``rag_query`` / ``rag_retrieve`` / ``ingest_texts_async``). در این ماژول هرگز
  ``asyncio.run`` از داخل زمینهٔ async صدا زده نمی‌شود (خطای مهلک
  "asyncio.run() cannot be called from a running event loop").
  برای فراخوانی‌های قدیمی و همگام، پل ``run_coro_blocking`` وجود دارد: اگر حلقهٔ
  رویدادی در حال اجرا نباشد ``asyncio.run`` و اگر حلقه فعال باشد، کار در یک نخ
  جداگانه اجرا می‌شود تا حلقهٔ رویداد مسدود یا تودرتو نشود.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import json
import logging
import os
import re
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger("smartjudge.lightrag")

# ── نصب/نبود بستهٔ LightRAG (pip install lightrag-hku) ────────────────────────
try:  # pragma: no cover - وابسته به محیط نصب
    from lightrag import LightRAG, QueryParam  # type: ignore

    try:
        from lightrag.llm.openai import openai_complete_if_cache, openai_embed  # type: ignore
    except Exception:  # noqa: BLE001 - مسیر ماژول در نسخه‌ها جابه‌جا شده است
        from lightrag.llm.openai import (  # type: ignore
            openai_complete_if_cache,
            openai_embedding as openai_embed,
        )
    try:
        from lightrag.utils import EmbeddingFunc  # type: ignore
    except Exception:  # noqa: BLE001
        EmbeddingFunc = None  # type: ignore

    LIGHTRAG_AVAILABLE = True
    LIGHTRAG_IMPORT_ERROR: Optional[str] = None
except Exception as exc:  # noqa: BLE001
    LIGHTRAG_AVAILABLE = False
    LIGHTRAG_IMPORT_ERROR = f"{type(exc).__name__}: {exc}"
    LightRAG = None  # type: ignore
    QueryParam = None  # type: ignore
    openai_complete_if_cache = None  # type: ignore
    openai_embed = None  # type: ignore
    EmbeddingFunc = None  # type: ignore

OPENROUTER_BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
# مدل‌ها از پیکربندی زندهٔ موتور خوانده می‌شوند تا کاتالوگ مدل تک‌منبع بماند
LIGHTRAG_LLM_MODEL = os.environ.get(
    "LIGHTRAG_LLM_MODEL", os.environ.get("DEFAULT_LLM_MODEL", "deepseek/deepseek-v4.1-flash")
)
LIGHTRAG_EMBED_MODEL = os.environ.get(
    "LIGHTRAG_EMBED_MODEL", "openai/text-embedding-3-small"
)
LIGHTRAG_EMBED_DIM = int(os.environ.get("LIGHTRAG_EMBED_DIM", "1536"))
LIGHTRAG_QUERY_MODE = os.environ.get("LIGHTRAG_QUERY_MODE", "mix")  # mix = graph + vector
LIGHTRAG_WORKING_DIR = os.environ.get("LIGHTRAG_WORKING_DIR", "/data/lightrag/smartjudge")

# ── لایهٔ جایگزین برداری (Qdrant) وقتی گراف محلی خالی است ─────────────────────
# LightRAG گراف را در graph_chunk_entity_relation.graphml نگه می‌دارد. اگر این فایل
# وجود نداشته باشد یا صفر موجودیت داشته باشد (نصب تازه، volume خالی، خرابی ingest)،
# بازیابی به‌صورت خودکار و بی‌خطا روی مجموعهٔ برداری Qdrant انجام می‌شود.
QDRANT_HOST = os.environ.get("QDRANT_HOST", "roxira_qdrant_prod")
QDRANT_PORT = os.environ.get("QDRANT_PORT", "6333")
QDRANT_FALLBACK_COLLECTION = os.environ.get("LIGHTRAG_QDRANT_COLLECTION", "iran_laws_bge_m3")
QDRANT_FALLBACK_TIMEOUT = float(os.environ.get("LIGHTRAG_QDRANT_TIMEOUT", "4"))
# کش منفی کوتاه: اگر همهٔ میزبان‌های Qdrant پاسخ ندادند، تا این مدت دوباره کاوش
# نمی‌کنیم تا مسیر پرس‌وجوی صوتی/بلادرنگ به‌خاطر سرویس خواب‌رفته کند نشود.
QDRANT_RETRY_COOLDOWN = float(os.environ.get("LIGHTRAG_QDRANT_RETRY_COOLDOWN", "30"))
GRAPH_FILE_NAME = "graph_chunk_entity_relation.graphml"
LIGHTRAG_SYNC_TIMEOUT = float(os.environ.get("LIGHTRAG_SYNC_TIMEOUT", "120"))
_QDRANT_HOST_CANDIDATES: Tuple[str, ...] = tuple(
    dict.fromkeys([QDRANT_HOST, "qdrant_prod", "qdrant", "127.0.0.1", "localhost"])
)

_rag_lock = threading.Lock()
_rag_instance: Any = None
_rag_init_error: Optional[str] = None


def _api_key() -> str:
    return os.environ.get("OPENROUTER_API_KEY", "").strip()


def is_ready() -> bool:
    """آیا LightRAG نصب و کلید مدل تنظیم شده است؟"""
    return LIGHTRAG_AVAILABLE and bool(_api_key()) and EmbeddingFunc is not None


async def _llm_func(prompt: str, system_prompt: Optional[str] = None, **kwargs: Any) -> str:
    assert openai_complete_if_cache is not None
    return await openai_complete_if_cache(
        LIGHTRAG_LLM_MODEL,
        prompt,
        system_prompt=system_prompt,
        api_key=_api_key(),
        base_url=OPENROUTER_BASE_URL,
        **kwargs,
    )


async def _embed_func(texts: List[str], **kwargs: Any) -> Any:
    assert openai_embed is not None
    return await openai_embed.func(
        texts,
        model=LIGHTRAG_EMBED_MODEL,
        api_key=_api_key(),
        base_url=OPENROUTER_BASE_URL,
    )


def get_rag() -> Any:
    """ساخت تنبل و یک‌بارهٔ نمونهٔ LightRAG (گراف + برداری)."""
    global _rag_instance, _rag_init_error
    if not is_ready():
        return None
    if _rag_instance is not None:
        return _rag_instance

    with _rag_lock:
        if _rag_instance is not None:
            return _rag_instance
        try:
            embedding_func = EmbeddingFunc(
                embedding_dim=LIGHTRAG_EMBED_DIM,
                max_token_size=8192,
                func=_embed_func,
            )
            _rag_instance = LightRAG(
                working_dir=LIGHTRAG_WORKING_DIR,
                llm_model_func=_llm_func,
                llm_model_name=LIGHTRAG_LLM_MODEL,
                embedding_func=embedding_func,
            )
            logger.info(
                "LightRAG initialized (llm=%s, embed=%s, dir=%s)",
                LIGHTRAG_LLM_MODEL,
                LIGHTRAG_EMBED_MODEL,
                LIGHTRAG_WORKING_DIR,
            )
        except Exception as exc:  # noqa: BLE001
            _rag_init_error = f"{type(exc).__name__}: {exc}"
            logger.warning("LightRAG init failed: %s", _rag_init_error)
            return None
    return _rag_instance


async def _initialize_storages(rag: Any) -> None:
    """نسخه‌های ≥1.1 به مقداردهی اولیهٔ صریح فضای ذخیره‌سازی نیاز دارند."""
    initializer = getattr(rag, "initialize_storages", None)
    if initializer is None:
        return
    result = initializer()
    if asyncio.iscoroutine(result):
        await result


def run_coro_blocking(coro: Any, timeout: Optional[float] = None) -> Any:
    """
    پل اجرای یک کوروتین از بستر همگام، بدون برخورد با حلقهٔ رویداد جاری.

    • اگر هیچ حلقهٔ رویدادی در این نخ فعال نباشد → ``asyncio.run`` (امن).
    • اگر حلقهٔ رویداد فعال باشد (مثلاً داخل یک روت FastAPI) → ``asyncio.run``
      ممنوع است، پس کوروتین در نخ کارگری جداگانه با حلقهٔ مستقل خودش اجرا و
      نتیجه‌اش بازگردانده می‌شود؛ حلقهٔ اصلی نه مسدودِ تودرتو می‌شود و نه
      RuntimeError می‌دهد.
    """
    if not asyncio.iscoroutine(coro):
        return coro
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=1, thread_name_prefix="lightrag-sync"
    ) as pool:
        future = pool.submit(asyncio.run, coro)
        return future.result(timeout=timeout if timeout is not None else LIGHTRAG_SYNC_TIMEOUT)


async def ingest_texts_async(
    texts: Sequence[str], on_progress: Optional[Callable[[str], None]] = None
) -> dict:
    """درج اسناد حقوقی در گراف دانش (نسخهٔ async — مسیر اصلی برای FastAPI)."""
    rag = get_rag()
    if rag is None:
        return {
            "status": "UNAVAILABLE",
            "inserted": 0,
            "error": LIGHTRAG_IMPORT_ERROR or _rag_init_error,
        }

    inserted = 0
    try:
        await _initialize_storages(rag)
        total = len(list(texts))
        for index, text in enumerate(texts):
            payload = (text or "").strip()
            if not payload:
                continue
            insert = rag.ainsert if hasattr(rag, "ainsert") else rag.insert
            result = insert(payload)
            if asyncio.iscoroutine(result):
                await result
            inserted += 1
            if on_progress:
                on_progress(f"{index + 1}/{total}")
        return {"status": "SUCCESS", "inserted": inserted, "error": None}
    except Exception as exc:  # noqa: BLE001
        logger.warning("LightRAG ingest failed: %s", exc)
        return {"status": "ERROR", "inserted": inserted, "error": f"{type(exc).__name__}: {exc}"}


def ingest_texts(texts: List[str], on_progress: Optional[Callable[[str], None]] = None) -> dict:
    """
    نسخهٔ همگام درج اسناد (سازگاری عقب‌گرد). از داخل کد async به‌جای این تابع،
    ``await ingest_texts_async(...)`` را صدا بزنید.
    """
    if get_rag() is None:
        return {
            "status": "UNAVAILABLE",
            "inserted": 0,
            "error": LIGHTRAG_IMPORT_ERROR or _rag_init_error,
        }
    return run_coro_blocking(ingest_texts_async(texts, on_progress))


# ── بررسی خالی بودن گراف محلی (graphml) ─────────────────────────────────────
def graph_entity_count(working_dir: Optional[str] = None) -> int:
    """شمارش موجودیت‌های گراف ذخیره‌شده روی دیسک. صفر = گراف خالی/ساخته‌نشده."""
    directory = working_dir or LIGHTRAG_WORKING_DIR
    path = os.path.join(directory, GRAPH_FILE_NAME)
    try:
        if not os.path.isfile(path):
            return 0
        count = 0
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                stripped = line.lstrip()
                if stripped.startswith("<node ") or stripped.startswith("<node>"):
                    count += 1
        return count
    except Exception as exc:  # noqa: BLE001
        logger.debug("graph entity count failed (%s): %s", path, exc)
        return 0


def graph_is_empty(working_dir: Optional[str] = None) -> bool:
    """آیا گراف محلی موجودیتی ندارد؟ (محرک تنزل خودکار به Qdrant)"""
    return graph_entity_count(working_dir) <= 0


# ── لایهٔ جایگزین برداری: Qdrant (iran_laws_bge_m3) ──────────────────────────
_PAYLOAD_TEXT_KEYS = (
    "text",
    "content",
    "summary",
    "title",
    "name",
    "article",
    "body",
    "description",
    "law_text",
)
_TOKEN_RE = re.compile(r"[\w\u0600-\u06FF]+", re.UNICODE)


def _payload_text(payload: Dict[str, Any]) -> str:
    parts: List[str] = []
    for key in _PAYLOAD_TEXT_KEYS:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())
    return " ".join(parts)


def _tokens(text: str) -> set:
    return {token.lower() for token in _TOKEN_RE.findall(text or "") if len(token) > 1}


def _rank_payloads(payloads: Sequence[Dict[str, Any]], query: str, limit: int) -> List[Dict[str, Any]]:
    """رتبه‌بندی واژگانی نقاط Qdrant تا مرتبط‌ترین مواد اول برگردند."""
    tokens = _tokens(query)
    scored: List[Tuple[int, int, Dict[str, Any], str]] = []
    for index, payload in enumerate(payloads):
        if not isinstance(payload, dict):
            continue
        text = _payload_text(payload)
        overlap = len(tokens & _tokens(text)) if tokens else 0
        scored.append((overlap, -index, payload, text))
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)

    rows: List[Dict[str, Any]] = []
    for overlap, _, payload, text in scored[: max(1, limit)]:
        raw_id = payload.get("id") or payload.get("uid") or payload.get("article_no")
        title = (
            payload.get("title")
            or payload.get("name")
            or payload.get("article")
            or (f"سند حقوقی {raw_id}" if raw_id else "سند حقوقی")
        )
        rows.append(
            {
                "title": str(title),
                "category": str(payload.get("category") or payload.get("collection") or QDRANT_FALLBACK_COLLECTION),
                "summary": (text or json.dumps(payload, ensure_ascii=False))[:1200],
                "match_level": "QDRANT_FALLBACK",
                "source": f"qdrant:{QDRANT_FALLBACK_COLLECTION}",
                "score": overlap,
            }
        )
    return rows


def _scroll_body(limit: int) -> Dict[str, Any]:
    return {"limit": max(limit * 4, 20), "with_payload": True, "with_vector": False}


_qdrant_failed_at: float = 0.0


def _qdrant_probe_suppressed() -> bool:
    """آیا کاوش Qdrant موقتاً به‌خاطر شکست‌های قبلی متوقف شده است؟"""
    if QDRANT_RETRY_COOLDOWN <= 0 or not _qdrant_failed_at:
        return False
    return (time.monotonic() - _qdrant_failed_at) < QDRANT_RETRY_COOLDOWN


def qdrant_fallback_state() -> Dict[str, Any]:
    """وضعیت کش منفی Qdrant برای پایش عملیاتی."""
    age = (time.monotonic() - _qdrant_failed_at) if _qdrant_failed_at else None
    return {
        "collection": QDRANT_FALLBACK_COLLECTION,
        "candidates": list(_QDRANT_HOST_CANDIDATES),
        "timeout_seconds": QDRANT_FALLBACK_TIMEOUT,
        "cooldown_seconds": QDRANT_RETRY_COOLDOWN,
        "suppressed": _qdrant_probe_suppressed(),
        "last_failure_age_seconds": round(age, 2) if age is not None else None,
    }


def _extract_points(response: Any) -> List[Dict[str, Any]]:
    try:
        if getattr(response, "status_code", 0) != 200:
            return []
        payload = response.json()
    except Exception:  # noqa: BLE001
        return []
    points = ((payload or {}).get("result") or {}).get("points") or []
    rows: List[Dict[str, Any]] = []
    for point in points:
        body = (point or {}).get("payload")
        if isinstance(body, dict):
            rows.append(body)
    return rows


async def _qdrant_scroll_httpx(query: str, limit: int) -> List[Dict[str, Any]]:
    import httpx  # وابستگی اختیاری؛ در نبود آن مسیر urllib فعال می‌شود

    async with httpx.AsyncClient(timeout=QDRANT_FALLBACK_TIMEOUT) as client:
        for host in _QDRANT_HOST_CANDIDATES:
            url = f"http://{host}:{QDRANT_PORT}/collections/{QDRANT_FALLBACK_COLLECTION}/points/scroll"
            try:
                response = await client.post(url, json=_scroll_body(limit))
            except Exception as exc:  # noqa: BLE001
                logger.debug("qdrant host %s unreachable: %s", host, exc)
                continue
            rows = _extract_points(response)
            if rows:
                logger.info("Qdrant fallback hit %s (%d points)", url, len(rows))
                return rows
    return []


def _qdrant_scroll_urllib(query: str, limit: int) -> List[Dict[str, Any]]:
    """مسیر بدون httpx (فقط stdlib) برای محیط‌های حداقلی."""
    import urllib.error
    import urllib.request

    body = json.dumps(_scroll_body(limit)).encode("utf-8")
    for host in _QDRANT_HOST_CANDIDATES:
        url = f"http://{host}:{QDRANT_PORT}/collections/{QDRANT_FALLBACK_COLLECTION}/points/scroll"
        request = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json"}, method="POST"
        )
        try:
            with urllib.request.urlopen(request, timeout=QDRANT_FALLBACK_TIMEOUT) as response:
                payload = json.loads(response.read().decode("utf-8") or "{}")
        except Exception as exc:  # noqa: BLE001
            logger.debug("qdrant (urllib) host %s unreachable: %s", host, exc)
            continue
        points = ((payload or {}).get("result") or {}).get("points") or []
        rows = [p.get("payload") for p in points if isinstance(p.get("payload"), dict)]
        if rows:
            return rows
    return []


async def qdrant_fallback_laws(query: str, limit: int = 5) -> List[Dict[str, Any]]:
    """
    بازیابی مواد قانونی از Qdrant (پیش‌فرض ``iran_laws_bge_m3``) وقتی گراف محلی
    خالی است. هرگز استثنا پرتاب نمی‌کند؛ در نبود سرویس، فهرست خالی برمی‌گرداند.
    در نبود سرویس یک کش منفی کوتاه فعال می‌شود تا تأخیر پرس‌وجوهای بعدی صفر بماند.
    """
    global _qdrant_failed_at
    text = (query or "").strip()
    if not text:
        return []
    if _qdrant_probe_suppressed():
        logger.debug("Qdrant fallback skipped (negative cache active)")
        return []

    desired = max(1, int(limit))
    try:
        payloads = await _qdrant_scroll_httpx(text, desired)
    except ImportError:
        payloads = await asyncio.to_thread(_qdrant_scroll_urllib, text, desired)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Qdrant fallback failed: %s", exc)
        payloads = []

    if not payloads:
        _qdrant_failed_at = time.monotonic()
        logger.warning(
            "Qdrant fallback unavailable on %s -> negative cache %ss",
            ",".join(_QDRANT_HOST_CANDIDATES[:3]),
            QDRANT_RETRY_COOLDOWN,
        )
        return []

    _qdrant_failed_at = 0.0
    return _rank_payloads(payloads, text, desired)


def _format_qdrant_answer(laws: Sequence[Dict[str, Any]]) -> Optional[str]:
    if not laws:
        return None
    parts = []
    for row in laws:
        title = str(row.get("title") or "سند حقوقی")
        summary = str(row.get("summary") or "").strip()
        parts.append(f"{title}: {summary}" if summary else title)
    return "\n".join(parts).strip() or None


async def qdrant_retrieve(query: str, limit: int = 5) -> Dict[str, Any]:
    """
    بازیابی مستقیم برداری از Qdrant (``iran_laws_bge_m3``) — بدون دخالت گراف.

    برای اندپوینت ``POST /api/v1/apps/judge/query`` که می‌خواهد مستقل از وضعیت
    گراف محلی، صرفاً از پایگاه برداری بپرسد. هرگز استثنا پرتاب نمی‌کند.
    """
    text = (query or "").strip()
    if not text:
        return {"source": "empty", "answer": None, "laws": [], "collection": None}
    laws = await qdrant_fallback_laws(text, limit=max(1, int(limit)))
    return {
        "source": "qdrant-fallback" if laws else "unavailable",
        "answer": _format_qdrant_answer(laws),
        "laws": laws,
        "collection": QDRANT_FALLBACK_COLLECTION if laws else None,
    }


async def rag_query(
    query_text: str,
    mode: Optional[str] = None,
    top_k: int = 6,
    allow_qdrant_fallback: bool = True,
) -> Optional[str]:
    """
    پرس‌وجوی متنی از گراف دانش (async — مستقیماً await می‌شود).

    در نبود موتور یا خالی بودن گراف، در صورت ``allow_qdrant_fallback`` به‌صورت
    خودکار روی Qdrant (``iran_laws_bge_m3``) جست‌وجو می‌کند. خروجی ``None`` یعنی
    همهٔ لایه‌ها تهی بودند (تنزل به بازیابی SQL در لایهٔ بالاتر).
    """
    text = (query_text or "").strip()
    if not text:
        return None

    rag = get_rag()
    entities = graph_entity_count()

    if rag is not None and entities > 0:
        try:
            await _initialize_storages(rag)
            query = rag.aquery if hasattr(rag, "aquery") else rag.query
            param = QueryParam(mode=mode or LIGHTRAG_QUERY_MODE, top_k=top_k)
            result = query(text, param=param)
            if asyncio.iscoroutine(result):
                result = await result
            answer = str(result or "").strip()
            if answer:
                return answer
            logger.info(
                "LightRAG returned an empty answer (entities=%d); using Qdrant fallback", entities
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("LightRAG query failed: %s", exc)
    elif rag is not None:
        logger.info(
            "LightRAG graph has 0 entities in %s -> Qdrant fallback (%s)",
            LIGHTRAG_WORKING_DIR,
            QDRANT_FALLBACK_COLLECTION,
        )
    else:
        logger.info(
            "LightRAG engine unavailable (%s) -> Qdrant fallback (%s)",
            LIGHTRAG_IMPORT_ERROR or _rag_init_error,
            QDRANT_FALLBACK_COLLECTION,
        )

    if allow_qdrant_fallback:
        laws = await qdrant_fallback_laws(text, limit=max(1, min(top_k, 5)))
        return _format_qdrant_answer(laws)
    return None


async def rag_retrieve(query_text: str, limit: int = 5, mode: Optional[str] = None) -> Dict[str, Any]:
    """
    بازیابی یک‌پارچه با برچسب منبع — برای لایه‌بندی شفاف در SmartJudge.

    ``source`` یکی از: ``lightrag-graph`` | ``lightrag-empty-answer`` |
    ``qdrant-fallback`` | ``graph-empty`` | ``unavailable`` | ``empty``.
    """
    text = (query_text or "").strip()
    entities = graph_entity_count()
    if not text:
        return {"source": "empty", "answer": None, "laws": [], "entities": entities, "collection": None}

    rag = get_rag()
    if rag is not None and entities > 0:
        answer = await rag_query(text, mode=mode, top_k=max(limit, 4), allow_qdrant_fallback=False)
        if answer:
            return {
                "source": "lightrag-graph",
                "answer": answer,
                "laws": [],
                "entities": entities,
                "collection": None,
            }
        laws = await qdrant_fallback_laws(text, limit=limit)
        return {
            "source": "lightrag-empty-answer" if laws else "graph-empty",
            "answer": _format_qdrant_answer(laws),
            "laws": laws,
            "entities": entities,
            "collection": QDRANT_FALLBACK_COLLECTION if laws else None,
        }

    laws = await qdrant_fallback_laws(text, limit=limit)
    return {
        "source": "qdrant-fallback" if laws else ("graph-empty" if rag is not None else "unavailable"),
        "answer": _format_qdrant_answer(laws),
        "laws": laws,
        "entities": entities,
        "collection": QDRANT_FALLBACK_COLLECTION if laws else None,
    }


def rag_query_sync(query_text: str, mode: Optional[str] = None, top_k: int = 6) -> Optional[str]:
    """پل همگام برای فراخوانی‌های قدیمی (بدون برخورد asyncio). مسیر اصلی async است."""
    return run_coro_blocking(rag_query(query_text, mode=mode, top_k=top_k))


def lightrag_health() -> dict:
    """وضعیت موتور LightRAG برای اندپوینت سلامت و پایش عملیاتی."""
    entities = graph_entity_count()
    return {
        "engine": "lightrag-hku",
        "available": LIGHTRAG_AVAILABLE,
        "ready": is_ready(),
        "import_error": LIGHTRAG_IMPORT_ERROR,
        "init_error": _rag_init_error,
        "llm_model": LIGHTRAG_LLM_MODEL,
        "embed_model": LIGHTRAG_EMBED_MODEL,
        "embed_dim": LIGHTRAG_EMBED_DIM,
        "query_mode": LIGHTRAG_QUERY_MODE,
        "working_dir": LIGHTRAG_WORKING_DIR,
        "api_key_present": bool(_api_key()),
        "graph_entities": entities,
        "graph_empty": entities <= 0,
        "qdrant_fallback": {
            "enabled": True,
            "collection": QDRANT_FALLBACK_COLLECTION,
            "host": QDRANT_HOST,
            "port": QDRANT_PORT,
            "active": entities <= 0 or not is_ready(),
            **qdrant_fallback_state(),
        },
        "install_hint": "pip install lightrag-hku",
    }


__all__ = [
    "LIGHTRAG_AVAILABLE",
    "QDRANT_FALLBACK_COLLECTION",
    "get_rag",
    "graph_entity_count",
    "graph_is_empty",
    "ingest_texts",
    "ingest_texts_async",
    "is_ready",
    "lightrag_health",
    "qdrant_fallback_laws",
    "qdrant_fallback_state",
    "qdrant_retrieve",
    "rag_query",
    "rag_query_sync",
    "rag_retrieve",
    "run_coro_blocking",
]
