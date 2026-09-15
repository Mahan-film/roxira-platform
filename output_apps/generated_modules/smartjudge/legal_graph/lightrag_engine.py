"""
موتور گراف دانش حقوقی بر پایهٔ LightRAG — لایهٔ بازیابی دوسطحی هستهٔ SmartJudge.

نصب موتور:  pip install lightrag-hku

معماری بازیابی سه‌لایه (هر لایه در نبود لایهٔ قبلی فعال می‌شود):
  لایهٔ ۱ — LightRAG (گراف موجودیت/رابطه + برداری، حالت hybrid/mix)
  لایهٔ ۲ — دو بازیابی SQL بومی (`src.legal_intelligence.dual_retrieval`)
  لایهٔ ۳ — پاسخ قالبی امن (`_fallback_knowledge_graph`)

خروجی همهٔ لایه‌ها یک قرارداد ثابت است: (laws, precedents).
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import threading
from typing import Any, Callable, List, Optional, Tuple

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


def ingest_texts(texts: List[str], on_progress: Optional[Callable[[str], None]] = None) -> dict:
    """
    درج اسناد حقوقی (مواد قانونی، آرای وحدت رویه، دکترین) در گراف دانش.
    عملیات همگام است و باید از بیرون در Thread/Background اجرا شود.
    """
    rag = get_rag()
    if rag is None:
        return {"status": "UNAVAILABLE", "inserted": 0, "error": LIGHTRAG_IMPORT_ERROR or _rag_init_error}

    async def _run() -> int:
        await _initialize_storages(rag)
        count = 0
        for index, text in enumerate(texts):
            payload = (text or "").strip()
            if not payload:
                continue
            insert = rag.ainsert if hasattr(rag, "ainsert") else rag.insert
            result = insert(payload)
            if asyncio.iscoroutine(result):
                await result
            count += 1
            if on_progress:
                on_progress(f"{index + 1}/{len(texts)}")
        return count

    try:
        inserted = asyncio.run(_run())
        return {"status": "SUCCESS", "inserted": inserted, "error": None}
    except Exception as exc:  # noqa: BLE001
        logger.warning("LightRAG ingest failed: %s", exc)
        return {"status": "ERROR", "inserted": 0, "error": f"{type(exc).__name__}: {exc}"}


def rag_query(query_text: str, mode: Optional[str] = None, top_k: int = 6) -> Optional[str]:
    """پرس‌وجوی متنی از گراف دانش؛ در نبود موتور، None برمی‌گردد (تنزل به لایهٔ SQL)."""
    rag = get_rag()
    if rag is None or not query_text.strip():
        return None

    async def _run() -> str:
        await _initialize_storages(rag)
        query = rag.aquery if hasattr(rag, "aquery") else rag.query
        param = QueryParam(mode=mode or LIGHTRAG_QUERY_MODE, top_k=top_k)
        result = query(query_text, param=param)
        if asyncio.iscoroutine(result):
            result = await result
        return str(result or "").strip()

    try:
        return asyncio.run(_run()) or None
    except Exception as exc:  # noqa: BLE001
        logger.warning("LightRAG query failed: %s", exc)
        return None


def lightrag_health() -> dict:
    """وضعیت موتور LightRAG برای اندپوینت سلامت و پایش عملیاتی."""
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
        "install_hint": "pip install lightrag-hku",
    }


__all__ = [
    "LIGHTRAG_AVAILABLE",
    "get_rag",
    "ingest_texts",
    "is_ready",
    "lightrag_health",
    "rag_query",
]
