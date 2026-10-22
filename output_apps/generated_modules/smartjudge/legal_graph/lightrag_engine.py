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
import math
import os
import re
import threading
import time
from pathlib import Path
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
# Default is ``iran_laws_v2``: 5083 articles embedded with BAAI/bge-m3 (the same model
# the query embedder uses) and a superset of the 17 laws in ``iran_laws_mistral_v1``.
# ``iran_laws_mistral_v1`` vectors are NOT bge-m3 vectors (measured cosine(bge(text),
# stored) ~ 0.0 on prod 2026-10-10), so querying it with the bge-m3 embedder returns
# near-random neighbours even though the dimension (1024) matches. Pairing is therefore
# explicit: collection -> embedder, see ``_COLLECTION_EMBEDDERS``.
QDRANT_DEFAULT_COLLECTION = "iran_laws_v2"
_COLLECTION_EMBEDDERS = {
    "iran_laws_v2": "BAAI/bge-m3",
    "iran_laws_v3": "BAAI/bge-m3",  # v2 vectors copied as-is + new laws embedded with bge-m3 (2026-10-11 audit)
    "iran_laws_bge_m3": "BAAI/bge-m3",
    "iran_rulings_v1": "BAAI/bge-m3",  # unity + Administrative Court board rulings (ekhtebar), see rulings_retrieval.py
    "iran_laws_mistral_v1": "mistral-embed",  # not loadable here (no Mistral embed client)
}


def _resolve_collection(env_value: str, embed_model: str) -> str:
    """Return a collection whose known embedder matches the query embedder.

    A known-mismatched collection (e.g. ``iran_laws_mistral_v1`` with bge-m3 queries) is
    replaced by ``LIGHTRAG_QDRANT_BGE_COLLECTION`` (default ``iran_laws_v2``) with a loud
    warning, unless ``LIGHTRAG_QDRANT_ALLOW_EMBED_MISMATCH=1``.
    """
    name = (env_value or "").strip() or QDRANT_DEFAULT_COLLECTION
    wanted = _COLLECTION_EMBEDDERS.get(name)
    if wanted and wanted != embed_model and os.environ.get("LIGHTRAG_QDRANT_ALLOW_EMBED_MISMATCH") != "1":
        replacement = os.environ.get("LIGHTRAG_QDRANT_BGE_COLLECTION", QDRANT_DEFAULT_COLLECTION)
        logger.warning(
            "Qdrant collection %s was built with %s but the query embedder is %s; using %s instead",
            name, wanted, embed_model, replacement,
        )
        return replacement
    return name


QDRANT_FALLBACK_COLLECTION = _resolve_collection(
    os.environ.get("LIGHTRAG_QDRANT_COLLECTION", ""),
    os.environ.get("LIGHTRAG_QDRANT_EMBED_MODEL", "BAAI/bge-m3"),
)
QDRANT_FALLBACK_TIMEOUT = float(os.environ.get("LIGHTRAG_QDRANT_TIMEOUT", "4"))
# کش منفی کوتاه: اگر همهٔ میزبان‌های Qdrant پاسخ ندادند، تا این مدت دوباره کاوش
# نمی‌کنیم تا مسیر پرس‌وجوی صوتی/بلادرنگ به‌خاطر سرویس خواب‌رفته کند نشود.
QDRANT_RETRY_COOLDOWN = float(os.environ.get("LIGHTRAG_QDRANT_RETRY_COOLDOWN", "30"))
# پالایش قوانین منسوخ: به‌صورت پیشفرض فقط نقاطی برگردانده می‌شوند که
# ``is_active == True`` هستند تا هرگز به قانون ملغی استناد نشود. نقاط قدیمی که
# این فیلد را ندارند با ``is_empty`` تحمل می‌شوند تا بازیابی دچار رگرسیون نشود.
QDRANT_ACTIVE_ONLY = os.environ.get("LIGHTRAG_QDRANT_ACTIVE_ONLY", "1") != "0"
QDRANT_TOLERATE_MISSING_ACTIVE = (
    os.environ.get("LIGHTRAG_QDRANT_TOLERATE_MISSING_ACTIVE", "1") != "0"
)
GRAPH_FILE_NAME = "graph_chunk_entity_relation.graphml"
LIGHTRAG_SYNC_TIMEOUT = float(os.environ.get("LIGHTRAG_SYNC_TIMEOUT", "120"))
_QDRANT_HOST_CANDIDATES: Tuple[str, ...] = tuple(
    dict.fromkeys([QDRANT_HOST, "qdrant_prod", "qdrant", "127.0.0.1", "localhost"])
)


def _qdrant_targets() -> List[Tuple[str, str, Dict[str, str]]]:
    """(label, base_url, headers): local hosts, then the optional Qdrant Cloud clusters
    (QDRANT_CLOUD_URL then QDRANT_CLOUD_URL_2..4, only those set). Reads only; the cloud
    replicas are tried in order after every local host failed to connect."""
    return _qcloud.targets(_QDRANT_HOST_CANDIDATES, QDRANT_PORT)

# مدل embedding پرس‌وجو برای جست‌وجوی برداری واقعی روی Qdrant — همان مدل و
# نرمال‌سازی‌ای که `scripts/w6_ingest_dotic.py` هنگام تزریق استفاده کرده
# (`BAAI/bge-m3`، `normalize_embeddings=True`، بردار بدون نام/unnamed،
# ۱۰۲۴بعدی، cosine). اگر مدل بارگذاری نشود (نصب نبودن sentence_transformers،
# نبود دانلود محلی و…) یا ابعاد کالکشن با ابعاد مدل نخواند، به‌صورت خودکار به
# مسیر scroll (پنجرهٔ کوچک، `QDRANT_SCAN_LIMIT`) تنزل می‌کنیم.
QDRANT_EMBED_MODEL_NAME = os.environ.get("LIGHTRAG_QDRANT_EMBED_MODEL", "BAAI/bge-m3")
# تعداد کاندیدهایی که از جست‌وجوی برداری واقعی گرفته می‌شود و سپس با
# هم‌پوشانی واژگانی/article_no محلی (همان `_rank_payloads`) رتبه‌بندی نهایی
# می‌شوند.
QDRANT_VECTOR_TOPK = int(os.environ.get("LIGHTRAG_QDRANT_VECTOR_TOPK", "20"))
# کلید اضطراری عملیاتی: خاموش‌کردن جست‌وجوی برداری بدون ریدیپلوی، در صورتی که
# روی کالکشنی خاص (مثلاً به‌خاطر کیفیت پایین embedding، نگاه کنید به §۸ سند
# W6) نتیجهٔ بدتری نسبت به مسیر scroll بدهد. پیش‌فرض روشن است — طبق تصمیم هاب
# مبنی بر استفاده از جست‌وجوی برداری واقعی هر جا ابعاد سازگار باشد.
QDRANT_VECTOR_SEARCH_ENABLED = os.environ.get("LIGHTRAG_QDRANT_VECTOR_SEARCH_ENABLED", "1") != "0"

# ── مسیر ترکیبی dense + sparse (BM25) — آزمایشی، پیش‌فرض خاموش ───────────────
# با ``SMARTJUDGE_HYBRID_SPARSE=1`` جست‌وجوی برداری با Query API و دو prefetch
# (dense و sparse «bm25») و ادغام RRF انجام می‌شود. اگر کالکشن بردار sparse نداشته
# باشد یا هر خطایی رخ دهد، بی‌صدا به مسیر dense فعلی تنزل می‌کنیم؛ پیش‌فرض خاموش
# یعنی هیچ تغییری در رفتار سروینگ. توکنایزر مشترک: ``legal_tokenize``.
HYBRID_SPARSE_ENV = "SMARTJUDGE_HYBRID_SPARSE"
HYBRID_SPARSE_VECTOR = os.environ.get("SMARTJUDGE_HYBRID_SPARSE_VECTOR", "bm25")
HYBRID_DENSE_PREFETCH = int(os.environ.get("SMARTJUDGE_HYBRID_DENSE_PREFETCH", "30"))
HYBRID_SPARSE_PREFETCH = int(os.environ.get("SMARTJUDGE_HYBRID_SPARSE_PREFETCH", "30"))


def hybrid_sparse_enabled() -> bool:
    """آیا مسیر ترکیبی dense+sparse فعال است؟ (پیش‌فرض خاموش — صفر تغییر رفتار)"""
    return os.environ.get(HYBRID_SPARSE_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


# ── سرویس مشترک embedding (HuggingFace TEI) ─────────────────────────────────
# وقتی ``EMBEDDING_URL`` تنظیم است، بردارهای پرس‌وجو از سرویس مشترک TEI گرفته
# می‌شوند (همان BAAI/bge-m3، نرمال‌شده، cosine 1.0) و دیگر هیچ نسخهٔ محلی
# sentence-transformers / BAAI/bge-m3 در این فرایند بارگذاری نمی‌شود. در نبود
# این متغیر، مسیر فعلی sentence-transformers دست‌نخورده باقی می‌ماند.
EMBEDDING_URL_ENV = "EMBEDDING_URL"
EMBEDDING_HTTP_BATCH_SIZE = int(os.environ.get("EMBEDDING_HTTP_BATCH_SIZE", "16"))
EMBEDDING_HTTP_TIMEOUT = float(os.environ.get("EMBEDDING_HTTP_TIMEOUT", "30"))
EMBEDDING_HTTP_RETRIES = int(os.environ.get("EMBEDDING_HTTP_RETRIES", "2"))

# ── بک‌اند embedding پرس‌وجو: Cloudflare Workers AI (انتخابی) ────────────────
# با ``EMBED_BACKEND=cf`` بردار پرس‌وجو از Workers AI با مدل ``@cf/baai/bge-m3``
# گرفته می‌شود — همان مدل ۱۰۲۴بعدی و L2-نرمال‌شدهٔ TEI. پیش‌فرض ``tei`` است
# (هیچ تغییری تا وقتی توکن مالک تنظیم نشود و تست parity قبول نشود). در هر خطا،
# پاسخ غیر۲۰۰، ابعاد نادرست یا نبود متغیر محیطی، یک هشدار (بدون توکن) ثبت و به
# مسیر TEI/local تنزل می‌کنیم.
EMBED_BACKEND_ENV = "EMBED_BACKEND"
CF_ACCOUNT_ID_ENV = "CF_ACCOUNT_ID"
CF_AI_TOKEN_ENV = "CF_AI_TOKEN"
CF_EMBED_MODEL = "@cf/baai/bge-m3"
CF_EMBED_DIM = 1024
CF_EMBED_URL_TEMPLATE = (
    "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/" + CF_EMBED_MODEL
)
CF_EMBED_TIMEOUT = float(os.environ.get("CF_EMBED_TIMEOUT", "3"))

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
    "article_label",
    "law_name",
)
_TOKEN_RE = re.compile(r"[\w\u0600-\u06FF]+", re.UNICODE)
from . import qdrant_cloud as _qcloud  # noqa: E402  (optional read-only cloud replica)
from . import retrieval_boost as _rb  # noqa: E402  (pure helpers, no circular import)
from .. import legal_tokenize as _lt  # noqa: E402  (shared sparse tokenizer, stdlib only)
from .. import reranker as _reranker  # noqa: E402  (optional cross-encoder, flag-gated, never raises)
_ENACTED_DESPITE_TITLE = (
    "لایحه اصلاحی قانون تجارت",
    "لایحه قانونی اصلاح قسمتی از قانون تجارت",
    "لایحه قانونی استقلال کانون وکلای دادگستری",
)

# مسیر اصلی اکنون جست‌وجوی برداری واقعی است (پایین‌تر: ``_try_vector_search``)؛
# این ثابت فقط برای مسیر اضطراری scroll به کار می‌رود — وقتی مدل embedding
# بارگذاری نشود یا ابعاد کالکشن با مدل نخواند. عمداً کوچک نگه داشته شده
# (نه کل کالکشن) چون هزینهٔ latency/حافظهٔ هر پرس‌وجوی چت را بالا می‌برد؛
# نسخهٔ قبلی این عدد را برای رفع W6b موقتاً تا ۶۰۰۰ (کل کالکشن) بالا برده
# بود که هاب آن را به‌عنوان راه‌حل موقت نپذیرفت (نگاه کنید به §۸ سند W6).
QDRANT_SCAN_LIMIT = int(os.environ.get("LIGHTRAG_QDRANT_SCAN_LIMIT", "200"))


def _payload_text(payload: Dict[str, Any]) -> str:
    parts: List[str] = []
    for key in _PAYLOAD_TEXT_KEYS:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())
    return " ".join(parts)


def _payload_article_no(payload: Dict[str, Any]) -> Optional[str]:
    """شمارهٔ مادهٔ خام از هر شکل payload (schema-tolerant).

    ``iran_laws_v2`` فیلد ``article_no`` صریح دارد (مثلاً ``"218-mokarrar"``)؛
    کالکشن قدیمی این فیلد را ندارد، اما شمارهٔ ماده معمولاً در ``title``/
    ``text`` به شکل «ماده N» تعبیه شده. هر دو حالت اینجا نگاشت می‌شوند تا
    بقیهٔ پایپ‌لاین (و eval) همیشه شمارهٔ مادهٔ قابل‌اتکا ببینند.
    """
    raw = payload.get("article_no") or payload.get("article_number")
    if raw:
        match = re.match(r"\s*([0-9\u06F0-\u06F9\u0660-\u0669]+)", str(raw))
        if match:
            return normalize_digits(match.group(1)).lstrip("0") or "0"
    for key in ("article_label", "title", "text"):
        value = payload.get(key)
        if not isinstance(value, str):
            continue
        match = re.search(r"ماده\s*\(?\s*([0-9۰-۹٠-٩]{1,4})", value)
        if match:
            return normalize_digits(match.group(1)).lstrip("0") or "0"
    return None


def normalize_digits(text: str) -> str:
    """تبدیل ارقام فارسی/عربی به ASCII (سازگار با ``dual_retrieval.normalize_digits``)."""
    persian = "\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9"
    arabic = "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669"
    ascii_digits = "0123456789"
    table = str.maketrans(persian + arabic, ascii_digits + ascii_digits)
    return (text or "").translate(table)


def _tokens(text: str) -> set:
    # normalised (ي/ك, hamza, ZWNJ, digits) and stop-word free; see retrieval_boost.
    return _rb.tokens(text)


def _payload_to_row(
    payload: Dict[str, Any], match_level: str = "QDRANT_FALLBACK", score: int = 0
) -> Dict[str, Any]:
    """یک payload خام Qdrant را به قرارداد ثابت ردیف قانونی تبدیل میکند.

    schema-tolerant: کالکشن قدیمی «title» تخت دارد؛ iran_laws_v2 هم «title»
    تخت میسازد (`w6_ingest_dotic.py`) اما اگر نبود، از law_name/article_label
    ساخته میشود تا هرگز به «سند حقوقی N» عمومی (که شمارهٔ ماده را برای eval
    قابلتشخیص نمیکند) سقوط نکنیم.
    """
    raw_id = payload.get("id") or payload.get("uid") or payload.get("article_no")
    law_name = payload.get("law_name")
    article_label = payload.get("article_label")
    text = _payload_text(payload)
    title = (
        payload.get("title")
        or (f"{law_name} - {article_label}" if law_name and article_label else None)
        or payload.get("name")
        or payload.get("article")
        or (f"سند حقوقی {raw_id}" if raw_id else "سند حقوقی")
    )
    article_no = _payload_article_no(payload)
    row = {
        "title": str(title),
        "category": str(
            payload.get("category")
            or payload.get("collection")
            or law_name
            or payload.get("law_type")
            or QDRANT_FALLBACK_COLLECTION
        ),
        "summary": (text or json.dumps(payload, ensure_ascii=False))[:1200],
        "match_level": match_level,
        "source": f"qdrant:{QDRANT_FALLBACK_COLLECTION}",
        "score": score,
        # cosine similarity of the vector hit (None for scroll/exact/boost rows); used by
        # source_filter so a strong semantic hit is not dropped by the token cutoff.
        "vector_score": payload.get("_vector_score"),
        # مسیر مستقیم و قابل‌اتکای شمارهٔ ماده برای مصرف‌کننده‌های پایین‌دست
        # (مثل eval_legal_rag.py) که نباید همیشه با regex متن را بکاوند.
        "article_no": article_no,
        "law_name": law_name,
        "is_bill": "لایحه" in str(law_name or "") and not any(
            enacted_name in str(law_name or "")
            for enacted_name in _ENACTED_DESPITE_TITLE
        ),
    }
    # Lawyer answer 2026-10-13 (item 2): implicitly repealed / contested articles stay in the corpus
    # and are flagged so the answer can carry a warning (see legal_notes.py).
    if payload.get("repeal_status"):
        row["repeal_status"] = str(payload["repeal_status"])
    return row


def _mustcite_keys(
    query: str, scored: Sequence[Tuple[int, int, Dict[str, Any], str]]
) -> List[int]:
    """Payload ids whose article number or law name is named in the question.

    Explicit article numbers come first, then the other articles of a named law; returns
    ``[]`` when the question names neither an article nor a recognizable law. Opt-in via
    ``retrieval_boost.mustcite_boost_enabled()`` (see ``_rank_payloads``).
    """
    parsed = _parse_article_query(query)
    article_nos = {str(n) for n in (parsed or {}).get("article_nos") or []}
    law_name = recognize_law_name(query)
    if not article_nos and not law_name:
        return []
    law_norm = _normalize_law_text(law_name) if law_name else None
    article_keys: List[int] = []
    law_keys: List[int] = []
    for _overlap, _neg_index, payload, _text in scored:
        payload_law = _normalize_law_text(payload.get("law_name"))
        payload_no = _payload_article_no(payload)
        matches_law = law_norm is None or payload_law == law_norm
        if article_nos and payload_no in article_nos and matches_law:
            article_keys.append(id(payload))
        elif law_norm and payload_law == law_norm:
            law_keys.append(id(payload))
    keys: List[int] = []
    seen: set = set()
    for key in article_keys + law_keys:
        if key not in seen:
            seen.add(key)
            keys.append(key)
    return keys


def _rank_payloads(payloads: Sequence[Dict[str, Any]], query: str, limit: int) -> List[Dict[str, Any]]:
    """رتبه‌بندی واژگانی نقاط Qdrant تا مرتبط‌ترین مواد اول برگردند."""
    tokens = _tokens(query)
    scored: List[Tuple[int, int, Dict[str, Any], str]] = []
    for index, payload in enumerate(payloads):
        if not isinstance(payload, dict):
            continue
        if payload.get("is_active") is False:  # قانون منسوخ هرگز بازیابی نمی‌شود
            continue
        text = _payload_text(payload)
        overlap = _rb.lexical_overlap(query, text) if tokens else 0
        scored.append((overlap, -index, payload, text))
    lexical_order = sorted(scored, key=lambda item: (item[0], item[1]), reverse=True)

    # Hybrid: fuse the vector order (input order = cosine rank) with the lexical order
    # by RRF so neither a lexical coincidence nor a weak embedding alone decides.
    by_key = {id(item[2]): item for item in scored}
    vector_keys = [id(item[2]) for item in sorted(scored, key=lambda i: i[1], reverse=True)]
    lexical_keys = [id(item[2]) for item in lexical_order]
    has_vec = any(item[2].get("_vector_score") is not None for item in scored)
    # Opt-in (SMARTJUDGE_MUSTCITE_BOOST=1): articles/laws named in the question enter the
    # fusion as a strong ranking, so the must-cite provision is returned first.
    mustcite_keys = _mustcite_keys(query, scored) if _rb.mustcite_boost_enabled() else []
    if mustcite_keys:
        fused = _rb.rrf_merge(
            [(1.0, vector_keys), (0.5, lexical_keys), (_rb.MUSTCITE_WEIGHT, mustcite_keys)]
        )
    else:
        fused = (
            _rb.rrf_merge([(1.0, vector_keys), (0.5, lexical_keys)]) if has_vec else lexical_keys
        )

    rows: List[Dict[str, Any]] = []
    for key in fused[: max(1, limit)]:
        overlap, _, payload, _text = by_key[key]
        rows.append(_payload_to_row(payload, score=overlap))
    return rows


def _scroll_body(limit: int, active_only: Optional[bool] = None) -> Dict[str, Any]:
    # مسیر اضطراری (نه اصلی): سقف کوچک و ثابت ``QDRANT_SCAN_LIMIT``، مستقل از
    # ``limit`` درخواستی، تا هزینهٔ هر پرس‌وجو کران‌دار بماند وقتی جست‌وجوی
    # برداری واقعی ممکن نبود. نگاه کنید به توضیح بالای ``QDRANT_SCAN_LIMIT``.
    body: Dict[str, Any] = {"limit": QDRANT_SCAN_LIMIT, "with_payload": True, "with_vector": False}
    point_filter = active_point_filter(active_only)
    if point_filter:
        body["filter"] = point_filter
    return body


def active_point_filter(active_only: Optional[bool] = None) -> Optional[Dict[str, Any]]:
    """Qdrant filter that hides repealed law (``is_active != true``).

    Returns ``None`` when the caller explicitly opts out. Legacy points ingested
    before the ``is_active`` field existed are tolerated via ``is_empty`` unless
    ``LIGHTRAG_QDRANT_TOLERATE_MISSING_ACTIVE=0`` forces a strict match.
    """
    enabled = QDRANT_ACTIVE_ONLY if active_only is None else bool(active_only)
    if not enabled:
        return None
    if QDRANT_TOLERATE_MISSING_ACTIVE:
        condition: Dict[str, Any] = {
            "should": [
                {"key": "is_active", "match": {"value": True}},
                {"is_empty": {"key": "is_active"}},
            ]
        }
    else:
        condition = {"key": "is_active", "match": {"value": True}}
    return {"must": [condition]}


def _only_active(payloads: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Defence-in-depth: drop repealed rows even if the server ignored the filter."""
    return [row for row in payloads if isinstance(row, dict) and row.get("is_active") is not False]


# ── جست‌وجوی برداری واقعی روی Qdrant (نه scroll) ─────────────────────────────
# مدل و تنظیمات دقیقاً همان چیزی است که `scripts/w6_ingest_dotic.py` هنگام
# تزریق استفاده کرده: `BAAI/bge-m3` (sentence-transformers، محلی/CPU)،
# `normalize_embeddings=True`، بردار بدون نام (unnamed vector). بارگذاری مدل
# فقط یک‌بار و تنبل انجام می‌شود (singleton سطح ماژول) چون خودِ بارگذاری چند
# ثانیه طول می‌کشد ولی encode یک پرس‌وجوی تکی بعد از آن سریع است.
_embedder_lock = threading.Lock()
_embedder_instance: Any = None
_embedder_load_failed = False


def _get_query_embedder() -> Any:
    """بارگذاری تنبل و یک‌بارهٔ مدل embedding پرس‌وجو؛ در شکست، ``None`` (بدون استثنا)."""
    global _embedder_instance, _embedder_load_failed
    if _embedder_instance is not None:
        return _embedder_instance
    if _embedder_load_failed:
        return None
    with _embedder_lock:
        if _embedder_instance is not None:
            return _embedder_instance
        if _embedder_load_failed:
            return None
        try:
            from sentence_transformers import SentenceTransformer  # لازی، وابستهٔ اختیاری

            logger.info("Loading query embedder %s for Qdrant search ...", QDRANT_EMBED_MODEL_NAME)
            _embedder_instance = SentenceTransformer(QDRANT_EMBED_MODEL_NAME)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Qdrant query embedder unavailable (%s) -> scroll fallback: %s",
                QDRANT_EMBED_MODEL_NAME,
                exc,
            )
            _embedder_load_failed = True
            return None
    return _embedder_instance


try:  # latency helpers (query-embedding cache + [CHAT-TIMING] embed_ms)
    from .. import chat_fast as _chat_fast
except Exception:  # noqa: BLE001 - never block engine import
    try:
        from output_apps.generated_modules.smartjudge import chat_fast as _chat_fast
    except Exception:  # noqa: BLE001
        _chat_fast = None

_embed_cache = _chat_fast.TTLCache(ttl=600.0, max_entries=512) if _chat_fast else None


def embedding_url() -> str:
    """آدرس سرویس مشترک embedding از محیط (بدون اسلش انتهایی)؛ تهی یعنی خاموش."""
    return os.environ.get(EMBEDDING_URL_ENV, "").strip().rstrip("/")


def _embed_post_json(url: str, payload: Dict[str, Any], timeout: float) -> Any:
    """POST یک JSON و بازگرداندن پاسخ پارس‌شده (urllib؛ در تست‌ها mock می‌شود)."""
    import urllib.request

    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8") or "[]")


def _embed_texts_http(texts: List[str]) -> List[List[float]]:
    """embed چند متن از سرویس مشترک TEI: دسته‌های حداکثر ۱۶تایی، ۲ تلاش مجدد."""
    url = f"{embedding_url()}/embed"
    vectors: List[List[float]] = []
    for start in range(0, len(texts), EMBEDDING_HTTP_BATCH_SIZE):
        chunk = list(texts[start : start + EMBEDDING_HTTP_BATCH_SIZE])
        payload = {"inputs": chunk, "normalize": True}
        result: Any = None
        last_exc: Optional[BaseException] = None
        for attempt in range(EMBEDDING_HTTP_RETRIES + 1):
            try:
                result = _embed_post_json(url, payload, EMBEDDING_HTTP_TIMEOUT)
                break
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt < EMBEDDING_HTTP_RETRIES:
                    time.sleep(min(2.0**attempt, 5.0))
        if result is None:
            raise last_exc or RuntimeError("embedding service returned no result")
        vectors.extend([[float(x) for x in vector] for vector in result])
    return vectors


def embed_backend() -> str:
    """بک‌اند embedding پرس‌وجو: ``cf`` یا پیش‌فرض ``tei``."""
    return os.environ.get(EMBED_BACKEND_ENV, "").strip().lower() or "tei"


def _l2_normalise(vector: Sequence[float]) -> List[float]:
    """بردار را L2-نرمال می‌کند (TEI با ``normalize=true`` همین را برمی‌گرداند)."""
    norm = math.sqrt(sum(float(x) * float(x) for x in vector))
    if norm <= 0.0:
        return [float(x) for x in vector]
    return [float(x) / norm for x in vector]


def _extract_cf_vectors(payload: Any) -> List[List[float]]:
    """بردارها را از پاسخ Workers AI بیرون می‌کشد — هم ``data`` و هم ``response``.

    شکل قطعی در مستندات ambiguous است، پس هر دو کلید، هم داخل ``result`` و هم در
    سطح بالای پاسخ بررسی می‌شود.
    """
    if not isinstance(payload, dict):
        return []
    for container in (payload.get("result"), payload):
        if not isinstance(container, dict):
            continue
        for key in ("data", "response"):
            value = container.get(key)
            if isinstance(value, list) and all(isinstance(vector, list) for vector in value):
                return [[float(x) for x in vector] for vector in value]
    return []


def _cf_account_id() -> str:
    return os.environ.get(CF_ACCOUNT_ID_ENV, "").strip()


def _cf_ai_token() -> str:
    return os.environ.get(CF_AI_TOKEN_ENV, "").strip()


def _cf_post_json(
    url: str, payload: Dict[str, Any], timeout: float, token: str
) -> Tuple[int, Any]:
    """POST امضاشده به Workers AI؛ ``(status, parsed)`` (در تست‌ها mock می‌شود)."""
    import urllib.request

    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        status = int(getattr(response, "status", 200) or 200)
        raw = response.read().decode("utf-8") or "{}"
    return status, json.loads(raw)


def _embed_texts_cf(texts: List[str]) -> List[List[float]]:
    """embed پرس‌وجو از Cloudflare Workers AI (``@cf/baai/bge-m3``، L2-نرمال‌شده).

    نبود متغیر محیطی، خطای شبکه/مهلت، پاسخ غیر۲۰۰، تعداد نادرست و ابعاد نامنطبق
    همگی با استثنا اعلام می‌شوند تا فراخوان به مسیر TEI/local تنزل کند. توکن هرگز
    لاگ نمی‌شود.
    """
    account = _cf_account_id()
    token = _cf_ai_token()
    if not account or not token:
        raise RuntimeError("CF backend selected but CF_ACCOUNT_ID/CF_AI_TOKEN are unset")
    url = CF_EMBED_URL_TEMPLATE.format(account=account)
    status, payload = _cf_post_json(url, {"text": list(texts)}, CF_EMBED_TIMEOUT, token)
    if status != 200:
        raise RuntimeError(f"CF embed returned HTTP {status}")
    vectors = _extract_cf_vectors(payload)
    if len(vectors) != len(texts):
        raise RuntimeError(f"CF embed returned {len(vectors)} vectors for {len(texts)} texts")
    for vector in vectors:
        if len(vector) != CF_EMBED_DIM:
            raise RuntimeError(f"CF embed dims {len(vector)} != {CF_EMBED_DIM}")
    return [_l2_normalise(vector) for vector in vectors]


def _embed_cache_key(text: str) -> str:
    """کلید کش: متن پرس‌وجوی نرمال‌شده (فاصله/خط‌های تکراری یکی‌شده)."""
    return " ".join(str(text).split())


def _embed_query_cf(text: str) -> Optional[List[float]]:
    """بردار پرس‌وجو از CF؛ در هر خطا ``None`` (یک هشدار، بدون توکن)."""
    try:
        return _embed_texts_cf([text])[0]
    except Exception as exc:  # noqa: BLE001
        logger.warning("Cloudflare embedding backend unavailable -> TEI fallback: %s", exc)
        return None


def warm_up_embedder() -> bool:
    """Load the embedder and run one encode so the first user request is not cold."""
    return _embed_query_sync("warm up") is not None


async def warm_up_embedder_async() -> bool:
    return await asyncio.to_thread(warm_up_embedder)


def _embed_query_sync(text: str) -> Optional[List[float]]:
    """رشته را embed می‌کند؛ در نبود مدل/سرویس یا شکست، ``None``.

    با ``EMBED_BACKEND=cf`` ابتدا Cloudflare Workers AI امتحان می‌شود و در هر خطا
    (یک هشدار، بدون توکن) به مسیر زیر تنزل می‌کند. با ``EMBEDDING_URL`` بردار از
    سرویس مشترک TEI گرفته می‌شود (بدون بارگذاری مدل محلی)؛ در غیر این صورت دقیقاً
    مسیر فعلی sentence-transformers اجرا می‌شود.
    """
    key = _embed_cache_key(text)
    if _embed_cache is not None:
        hit = _embed_cache.get(key)
        if hit is not None:
            return list(hit)
    if embed_backend() == "cf":
        t0 = time.perf_counter()
        result = _embed_query_cf(text)
        if result is not None:
            if _chat_fast is not None:
                _chat_fast.timing_add("embed_ms", (time.perf_counter() - t0) * 1000)
            if _embed_cache is not None:
                _embed_cache.set(key, result)
            return result
    if embedding_url():
        try:
            t0 = time.perf_counter()
            result = _embed_texts_http([text])[0]
            if _chat_fast is not None:
                _chat_fast.timing_add("embed_ms", (time.perf_counter() - t0) * 1000)
            if _embed_cache is not None:
                _embed_cache.set(key, result)
            return result
        except Exception as exc:  # noqa: BLE001
            logger.warning("Shared embedding service failed -> scroll fallback: %s", exc)
            return None
    model = _get_query_embedder()
    if model is None:
        return None
    try:
        t0 = time.perf_counter()
        vector = model.encode([text], normalize_embeddings=True, show_progress_bar=False)[0]
        result = [float(x) for x in vector]
        if _chat_fast is not None:
            _chat_fast.timing_add("embed_ms", (time.perf_counter() - t0) * 1000)
        if _embed_cache is not None:
            _embed_cache.set(key, result)
        return result
    except Exception as exc:  # noqa: BLE001
        logger.warning("Query embedding failed -> scroll fallback: %s", exc)
        return None


# کش ابعاد بردار هر کالکشن (بعد از اولین تشخیص موفق، ثابت می‌ماند چون بدون
# بازسازی کالکشن ابعاد عوض نمی‌شود). مقدار منفی/None یعنی هنوز نامشخص است —
# دوباره تلاش می‌شود، نه این‌که برای همیشه fallback فرض شود.
_collection_vector_dim_cache: Dict[str, int] = {}
_collection_vector_dim_lock = threading.Lock()


async def _qdrant_collection_vector_size(collection: str) -> Optional[int]:
    """اندازهٔ بردار کالکشن (``config.params.vectors.size``) یا ``None`` در شکست/عدم قطعیت."""
    cached = _collection_vector_dim_cache.get(collection)
    if cached:
        return cached
    try:
        import httpx  # وابستهٔ اختیاری؛ نبودش یعنی جست‌وجوی برداری ممکن نیست
    except ImportError:
        return None
    async with httpx.AsyncClient(timeout=QDRANT_FALLBACK_TIMEOUT) as client:
        for host, base, hdrs in _qdrant_targets():
            _qcloud.note_failover(host)
            url = f"{base}/collections/{collection}"
            try:
                response = await client.get(url, headers=hdrs)
            except Exception as exc:  # noqa: BLE001
                logger.debug("qdrant collection-info host %s unreachable: %s", host, exc)
                continue
            if getattr(response, "status_code", 0) != 200:
                return None
            try:
                payload = response.json()
            except Exception:  # noqa: BLE001
                return None
            vectors_cfg = (
                (((payload or {}).get("result") or {}).get("config") or {}).get("params", {})
                .get("vectors")
            )
            size: Optional[int] = None
            if isinstance(vectors_cfg, dict):
                if isinstance(vectors_cfg.get("size"), int):
                    size = vectors_cfg["size"]
                else:
                    # named vectors: هیوریستیک — اولین بردار نام‌دار را می‌خوانیم.
                    for named in vectors_cfg.values():
                        if isinstance(named, dict) and isinstance(named.get("size"), int):
                            size = named["size"]
                            break
            if size:
                with _collection_vector_dim_lock:
                    _collection_vector_dim_cache[collection] = size
            return size
    return None


# کش وجود بردار sparse «bm25» در کالکشن (بعد از اولین تشخیص موفق ثابت می‌ماند).
_collection_sparse_cache: Dict[str, bool] = {}
_collection_sparse_lock = threading.Lock()


async def _qdrant_collection_has_sparse(
    collection: str, name: str = HYBRID_SPARSE_VECTOR
) -> bool:
    """آیا کالکشن بردار sparse نام‌دار ``name`` دارد؟ در شکست/عدم قطعیت ``False``.

    ``False`` یعنی مسیر ترکیبی بی‌صدا به dense تنزل می‌کند (خواستهٔ وظیفه: اگر
    کالکشن بردار sparse ندارد، همان رفتار فعلی dense بدون هیچ خطایی حفظ شود).
    """
    key = f"{collection}\x1f{name}"
    cached = _collection_sparse_cache.get(key)
    if cached is not None:
        return cached
    try:
        import httpx
    except ImportError:
        return False
    async with httpx.AsyncClient(timeout=QDRANT_FALLBACK_TIMEOUT) as client:
        for host, base, hdrs in _qdrant_targets():
            _qcloud.note_failover(host)
            url = f"{base}/collections/{collection}"
            try:
                response = await client.get(url, headers=hdrs)
            except Exception as exc:  # noqa: BLE001
                logger.debug("qdrant sparse-probe host %s unreachable: %s", host, exc)
                continue
            if getattr(response, "status_code", 0) != 200:
                return False
            try:
                payload = response.json()
            except Exception:  # noqa: BLE001
                return False
            sparse_cfg = (
                (((payload or {}).get("result") or {}).get("config") or {}).get("params", {})
                .get("sparse_vectors")
            )
            has = isinstance(sparse_cfg, dict) and name in sparse_cfg
            with _collection_sparse_lock:
                _collection_sparse_cache[key] = has
            return has
    return False


def build_hybrid_query_body(
    dense_vector: Sequence[float],
    sparse_vector: Dict[str, Any],
    *,
    dense_limit: int = HYBRID_DENSE_PREFETCH,
    sparse_limit: int = HYBRID_SPARSE_PREFETCH,
    limit: int = 10,
    point_filter: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """بدنهٔ خالص درخواست Query API: دو prefetch (dense + sparse «bm25») و ادغام RRF.

    بدون I/O تا تست واحد ساختار درخواست را بسنجد (بدون شبکه).
    """
    dense_prefetch: Dict[str, Any] = {
        "query": [float(x) for x in dense_vector],
        "limit": max(1, dense_limit),
    }
    sparse_prefetch: Dict[str, Any] = {
        "query": sparse_vector,
        "using": HYBRID_SPARSE_VECTOR,
        "limit": max(1, sparse_limit),
    }
    if point_filter:
        dense_prefetch["filter"] = point_filter
        sparse_prefetch["filter"] = point_filter
    body: Dict[str, Any] = {
        "prefetch": [dense_prefetch, sparse_prefetch],
        "query": {"fusion": "rrf"},
        "limit": max(1, limit),
        "with_payload": True,
        "with_vector": False,
    }
    if point_filter:
        body["filter"] = point_filter
    return body


def _extract_query_points(response: Any) -> List[Dict[str, Any]]:
    """نقاط پاسخ ``points/query`` (هم ``result.points`` و هم ``result`` فهرست را می‌پذیرد)."""
    try:
        if getattr(response, "status_code", 0) != 200:
            return []
        payload = response.json()
    except Exception:  # noqa: BLE001
        return []
    result = (payload or {}).get("result")
    if isinstance(result, dict):
        return result.get("points") or []
    if isinstance(result, list):
        return result
    return []


async def _qdrant_hybrid_search_httpx(
    vector: List[float],
    text: str,
    collection: str,
    limit: int,
    active_only: Optional[bool] = None,
) -> Optional[List[Dict[str, Any]]]:
    """جست‌وجوی ترکیبی dense+sparse با RRF؛ ``None`` یعنی شکست (تنزل به dense)."""
    global _qdrant_last_reachable
    indices, values = _lt.query_sparse_vector(text)
    if not indices:
        return None
    body = build_hybrid_query_body(
        vector,
        {"indices": indices, "values": values},
        dense_limit=HYBRID_DENSE_PREFETCH,
        sparse_limit=HYBRID_SPARSE_PREFETCH,
        limit=max(1, limit),
        point_filter=active_point_filter(active_only),
    )
    try:
        import httpx
    except ImportError:
        return None
    async with httpx.AsyncClient(timeout=QDRANT_FALLBACK_TIMEOUT) as client:
        for host, base, hdrs in _qdrant_targets():
            _qcloud.note_failover(host)
            url = f"{base}/collections/{collection}/points/query"
            try:
                response = await client.post(url, json=body, headers=hdrs)
            except Exception as exc:  # noqa: BLE001
                logger.debug("qdrant hybrid-search host %s unreachable: %s", host, exc)
                continue
            _qdrant_last_reachable = True
            if getattr(response, "status_code", 0) != 200:
                logger.info(
                    "Qdrant hybrid query HTTP %s on %s -> dense fallback",
                    response.status_code,
                    url,
                )
                return None
            points = _extract_query_points(response)
            return [
                {**p["payload"], "_vector_score": p.get("score")}
                for p in points
                if isinstance(p, dict) and isinstance(p.get("payload"), dict)
            ]
    return None


async def _qdrant_vector_search_httpx(
    vector: List[float], collection: str, limit: int, active_only: Optional[bool] = None
) -> Optional[List[Dict[str, Any]]]:
    """جست‌وجوی برداری واقعی (`points/search`)؛ ``None`` یعنی خودِ جست‌وجو شکست خورد
    (باید به scroll تنزل کرد)؛ لیست خالی یعنی جست‌وجو موفق بود ولی نتیجه‌ای نداشت
    (fallback لازم نیست، این یک نتیجهٔ معتبر صفر است)."""
    global _qdrant_last_reachable
    body: Dict[str, Any] = {
        "vector": vector,
        "limit": max(1, limit),
        "with_payload": True,
        "with_vector": False,
    }
    point_filter = active_point_filter(active_only)
    if point_filter:
        body["filter"] = point_filter
    try:
        import httpx
    except ImportError:
        return None
    async with httpx.AsyncClient(timeout=QDRANT_FALLBACK_TIMEOUT) as client:
        for host, base, hdrs in _qdrant_targets():
            _qcloud.note_failover(host)
            url = f"{base}/collections/{collection}/points/search"
            try:
                response = await client.post(url, json=body, headers=hdrs)
            except Exception as exc:  # noqa: BLE001
                logger.debug("qdrant vector-search host %s unreachable: %s", host, exc)
                continue
            _qdrant_last_reachable = True
            if getattr(response, "status_code", 0) != 200:
                logger.warning("Qdrant vector search HTTP %s on %s", response.status_code, url)
                return None
            try:
                payload = response.json()
            except Exception:  # noqa: BLE001
                return None
            points = (payload or {}).get("result") or []
            rows = [
                {**p["payload"], "_vector_score": p.get("score")}
                for p in points
                if isinstance(p, dict) and isinstance(p.get("payload"), dict)
            ]
            return rows
    return None


async def _try_vector_search(
    text: str, limit: int, active_only: Optional[bool] = None
) -> Optional[List[Dict[str, Any]]]:
    """مسیر اصلی: embed پرس‌وجو + `points/search`. در هر مانعی (مدل، ابعاد
    ناسازگار، شبکه، یا خاموش‌بودن دستی با ``QDRANT_VECTOR_SEARCH_ENABLED``)
    ``None`` برمی‌گرداند تا کالر به scroll تنزل کند."""
    if not QDRANT_VECTOR_SEARCH_ENABLED:
        return None
    vector = await asyncio.to_thread(_embed_query_sync, text)
    if vector is None:
        return None
    dim = await _qdrant_collection_vector_size(QDRANT_FALLBACK_COLLECTION)
    if dim is not None and dim != len(vector):
        logger.info(
            "Qdrant vector dim mismatch (collection=%s dim=%d, query dim=%d) -> scroll fallback",
            QDRANT_FALLBACK_COLLECTION,
            dim,
            len(vector),
        )
        return None
    top_k = max(limit, QDRANT_VECTOR_TOPK)
    # مسیر ترکیبی (SMARTJUDGE_HYBRID_SPARSE=1، پیش‌فرض خاموش): dense + sparse با RRF.
    # اگر کالکشن بردار sparse «bm25» نداشته باشد یا جست‌وجو شکست بخورد، بی‌صدا به
    # همان مسیر dense فعلی تنزل می‌کنیم — پس رفتار پیش‌فرض دقیقاً بدون تغییر است.
    if hybrid_sparse_enabled():
        has_sparse = await _qdrant_collection_has_sparse(
            QDRANT_FALLBACK_COLLECTION, HYBRID_SPARSE_VECTOR
        )
        if has_sparse:
            hybrid = await _qdrant_hybrid_search_httpx(
                vector, text, QDRANT_FALLBACK_COLLECTION, top_k, active_only
            )
            if hybrid is not None:
                return hybrid
    return await _qdrant_vector_search_httpx(vector, QDRANT_FALLBACK_COLLECTION, top_k, active_only)


_qdrant_failed_at: float = 0.0
#: آیا آخرین کاوش، پاسخ HTTP از Qdrant دریافت کرد؟ (تمایز «خالی» از «خاموش»)
_qdrant_last_reachable: bool = False


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


async def _qdrant_scroll_httpx(query: str, limit: int, active_only: Optional[bool] = None) -> List[Dict[str, Any]]:
    import httpx  # وابستگی اختیاری؛ در نبود آن مسیر urllib فعال می‌شود

    global _qdrant_last_reachable
    body = _scroll_body(limit, active_only)
    async with httpx.AsyncClient(timeout=QDRANT_FALLBACK_TIMEOUT) as client:
        for host, base, hdrs in _qdrant_targets():
            _qcloud.note_failover(host)
            url = f"{base}/collections/{QDRANT_FALLBACK_COLLECTION}/points/scroll"
            try:
                response = await client.post(url, json=body, headers=hdrs)
            except Exception as exc:  # noqa: BLE001
                logger.debug("qdrant host %s unreachable: %s", host, exc)
                continue
            _qdrant_last_reachable = True
            rows = _extract_points(response)
            if rows:
                logger.info("Qdrant fallback hit %s (%d points)", url, len(rows))
            return rows
    return []


def _qdrant_scroll_urllib(query: str, limit: int, active_only: Optional[bool] = None) -> List[Dict[str, Any]]:
    """مسیر بدون httpx (فقط stdlib) برای محیط‌های حداقلی."""
    import urllib.error
    import urllib.request

    global _qdrant_last_reachable
    body = json.dumps(_scroll_body(limit, active_only)).encode("utf-8")
    for host, base, hdrs in _qdrant_targets():
        _qcloud.note_failover(host)
        url = f"{base}/collections/{QDRANT_FALLBACK_COLLECTION}/points/scroll"
        request = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json", **hdrs}, method="POST"
        )
        try:
            with urllib.request.urlopen(request, timeout=QDRANT_FALLBACK_TIMEOUT) as response:
                payload = json.loads(response.read().decode("utf-8") or "{}")
        except Exception as exc:  # noqa: BLE001
            logger.debug("qdrant (urllib) host %s unreachable: %s", host, exc)
            continue
        _qdrant_last_reachable = True
        points = ((payload or {}).get("result") or {}).get("points") or []
        rows = [p.get("payload") for p in points if isinstance(p.get("payload"), dict)]
        return rows
    return []


# ── پیش‌قدم قطعی: «ماده N قانون X» را با فیلتر payload پیدا کن (W25-1) ───────
# مسئله (بررسی زندهٔ ۲۰۲۶-۰۹-۳۰): پرس‌وجوی «ماده ۱۰ قانون مدنی» مادهٔ ۱۰۱۰ را
# برمی‌گرداند چون جست‌وجوی برداری به شباهت واژگانی/عددی حساس است. این پیش‌قدم
# الگوی «ماده/مواد N [قانون X]» را پارس می‌کند و اگر نام قانون شناخته شود، با
# فیلتر payload (``law_name`` + ``article_no`` + ``is_active``) مستقیماً روی
# همان کالکشن Qdrant scroll می‌زند و مادهٔ دقیق را نتیجهٔ اول برمی‌گرداند؛ اگر
# قانونی نام برده نشده باشد فقط با ``article_no`` فیلتر می‌کند و حداکثر ۳
# کاندید از قوانین مختلف را با نام قانون برمی‌گرداند. در نبود تطابق، ``None``
# برمی‌گرداند تا مسیر برداری موجود دست‌نخورده ادامه یابد. مجموعهٔ پیش‌فرض
# کالکشن تغییر نمی‌کند (همان ``LIGHTRAG_QDRANT_COLLECTION``).
_LIGHTRAG_LAW_NAMES_FILE = os.environ.get("LIGHTRAG_LAW_NAMES_FILE", "").strip()
_LAW_NAMES_FILE = (
    Path(_LIGHTRAG_LAW_NAMES_FILE)
    if _LIGHTRAG_LAW_NAMES_FILE
    else Path(__file__).resolve().parents[4] / "data" / "legal" / "dotic_articles_2026-09-22.jsonl"
)
# نام‌های کامل/مخفف → ``law_name`` دقیق در کالکشن. عمداً هیچ نام تک‌کلمه‌ای
# («مدنی»، «تجارت»، «چک») نیست: این‌ها تکهٔ نام قوانین بلندتر (مسئولیت مدنی،
# تجارت الکترونیکی، اجرای احکام مدنی) هستند و باعث نسبت‌دادن اشتباه می‌شدند.
_LAW_NAME_ALIASES: Tuple[Tuple[str, str], ...] = (
    ("لایحه اصلاحی قانون تجارت", "لایحه اصلاحی قانون تجارت"),
    ("قانون آیین دادرسی کیفری", "قانون آیین دادرسی کیفری"),
    ("قانون آیین دادرسی مدنی", "قانون آیین دادرسی مدنی"),
    ("قانون مجازات اسلامی", "قانون مجازات اسلامی"),
    ("قانون صدور چک", "قانون صدور چک (اصلاحی ۱۳۹۷)"),
    ("قانون شوراهای حل اختلاف", "قانون شوراهای حل اختلاف و دادگاه‌های صلح مصوب ۱۴۰۲"),
    ("قانون تجارت", "قانون تجارت"),
    ("قانون مدنی", "قانون مدنی"),
    ("آیین دادرسی کیفری", "قانون آیین دادرسی کیفری"),
    ("آیین دادرسی مدنی", "قانون آیین دادرسی مدنی"),
    ("ق.آ.د.ک", "قانون آیین دادرسی کیفری"),
    ("ق.آ.د.م", "قانون آیین دادرسی مدنی"),
    ("مجازات اسلامی", "قانون مجازات اسلامی"),
    ("صدور چک", "قانون صدور چک (اصلاحی ۱۳۹۷)"),
    ("شوراهای حل اختلاف", "قانون شوراهای حل اختلاف و دادگاه‌های صلح مصوب ۱۴۰۲"),
    ("ق.م", "قانون مدنی"),
)

# واژه‌هایی که ادامهٔ نام قانون نیستند (پایان عبارت نام قانون را نشان می‌دهند).
_LAW_PHRASE_STOP_WORDS = frozenset(
    {
        "ماده", "مواد", "مصوب", "اصلاحی", "اصلاحیه", "چیست", "چه", "را", "و", "یا", "در",
        "از", "به", "که", "می", "است", "آیا", "بر", "طبق", "برای", "با", "این", "آن",
        "ایران", "جمهوری", "اسلامی‌ایران", "مکرر", "تبصره", "بند", "چند", "کدام", "چگونه",
        "چطور",
    }
)
_LAW_PREFIX_WORDS = ("قانون", "لایحه")
_LAW_MENTION_RE = re.compile(r"(?:^|\s)(?:قانون|لایحه)\s+([^\s]+)")

_known_law_names_cache: Optional[List[str]] = None


def _normalize_law_text(text: str) -> str:
    """یکسان‌سازی متن برای تطبیق نام قانون (ارقام، ی/ک، نیم‌فاصله، پرانتز)."""
    normalized = normalize_digits(text or "")
    normalized = (
        normalized.replace("\u200c", " ")
        .replace("ي", "ی")
        .replace("ك", "ک")
        .replace("(", " ")
        .replace(")", " ")
        .replace("،", " ")
    )
    return re.sub(r"\s+", " ", normalized).strip()


def _known_law_names() -> List[str]:
    """نام‌های قانون یکتا از فایل corpus (best-effort؛ در نبود فایل، تهی)."""
    global _known_law_names_cache
    if _known_law_names_cache is not None:
        return _known_law_names_cache
    names: List[str] = []
    try:
        with _LAW_NAMES_FILE.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    name = json.loads(line).get("law_name")
                except Exception:  # noqa: BLE001 - خطوط بدشکل را رد کن
                    continue
                if isinstance(name, str) and name.strip():
                    names.append(name.strip())
    except Exception as exc:  # noqa: BLE001 - نبود فایل نباید چیزی را بشکند
        logger.debug("law-name corpus unavailable (%s): %s", _LAW_NAMES_FILE, exc)
    _known_law_names_cache = list(dict.fromkeys(names))
    return _known_law_names_cache


def _law_tokens(text: str) -> List[str]:
    """توکن‌های متن نرمال‌شده؛ نقطه‌گذاری کناری («؟» «.» «:») حذف می‌شود."""
    tokens = [t.strip("؟?!.:;\"'«»[]") for t in _normalize_law_text(text).split(" ")]
    return [t for t in tokens if t]


def _is_stop_token(token: str) -> bool:
    return token in _LAW_PHRASE_STOP_WORDS or token.isdigit()


def _is_fragment_match(tokens: List[str], start: int, end: int) -> bool:
    """آیا تطبیق [start, end) فقط تکه‌ای از نام بلندتر «قانون X …» است؟"""
    # ادامهٔ نام بعد از تطبیق («قانون تجارت الکترونیکی»).
    if end < len(tokens):
        nxt = tokens[end]
        if not _is_stop_token(nxt) and nxt not in _LAW_PREFIX_WORDS:
            return True
    # کلمات دیگرِ «قانون X …» قبل از تطبیق («قانون اجرای احکام مدنی»).
    if tokens[start] not in _LAW_PREFIX_WORDS and not tokens[start].startswith("ق."):
        idx = start - 1
        gap = 0
        while idx >= 0 and tokens[idx] not in _LAW_PREFIX_WORDS and not _is_stop_token(tokens[idx]):
            gap += 1
            idx -= 1
        if idx >= 0 and tokens[idx] in _LAW_PREFIX_WORDS and gap > 0:
            return True
    return False


def _find_phrase(tokens: List[str], phrase: List[str]) -> Optional[Tuple[int, int]]:
    """اولین جای توکن‌به‌توکن (نه زیررشته) که ``phrase`` تکهٔ نام بلندتر نیست."""
    size = len(phrase)
    for start in range(0, len(tokens) - size + 1):
        if tokens[start : start + size] == phrase and not _is_fragment_match(
            tokens, start, start + size
        ):
            return start, start + size
    return None


def mentions_law_phrase(text: str) -> bool:
    """آیا متن «قانون <نام>» یا «لایحه <نام>» را می‌گوید (نام واقعی، نه واژهٔ توقف)؟"""
    for match in _LAW_MENTION_RE.finditer(_normalize_law_text(text)):
        word = match.group(1).strip("؟?!.:;\"'«»[]")
        if word and not _is_stop_token(word):
            return True
    return False


def recognize_law_name(text: str) -> Optional[str]:
    """بلندترین نام قانون (از میان نام‌های واقعی corpus و aliasها) را پیدا کن.

    تطبیق توکن‌به‌توکن است و تکهٔ نام بلندتر («قانون مسئولیت مدنی»، «قانون تجارت
    الکترونیکی»، «قانون اجرای احکام مدنی») رد می‌شود.
    """
    tokens = _law_tokens(text)
    if not tokens:
        return None
    best_len = -1
    best_name: Optional[str] = None
    candidates: List[Tuple[str, str]] = list(_LAW_NAME_ALIASES)
    candidates.extend((name, name) for name in _known_law_names())
    for alias, canonical in candidates:
        phrase = _law_tokens(alias)
        if not phrase:
            continue
        needle_len = len(_normalize_law_text(alias))
        if needle_len > best_len and _find_phrase(tokens, phrase):
            best_len = needle_len
            best_name = canonical
    if best_name is None:
        # «لایحه اصلاحی» تنها، فقط وقتی قانون دیگری نام برده نشده.
        bill = _law_tokens("لایحه اصلاحی")
        if not mentions_law_phrase(text) and _find_phrase(tokens, bill):
            return "لایحه اصلاحی قانون تجارت"
    return best_name


_MAX_ARTICLE_NOS = 5


def _parse_article_query(text: str) -> Optional[Dict[str, Any]]:
    """الگوهای «ماده N»، «ماده N قانون X» و «مواد N و M …» را پارس می‌کند."""
    normalized = normalize_digits(text or "")
    article_nos: List[str] = []
    mokarrar = False
    plural = re.search(r"مواد\s*(.+)$", normalized)
    if plural:
        tail = plural.group(1)
        # سال‌های بعد از «مصوب» (مثلاً «مصوب ۱۳۹۲») شمارهٔ ماده نیستند.
        tail = re.sub(r"مصوب\s*[0-9]{1,4}(?:\s*/\s*[0-9]{1,2}){0,2}", " ", tail)
        article_nos = [n.lstrip("0") or "0" for n in re.findall(r"[0-9]{1,4}", tail)]
        mokarrar = bool(re.search(r"مکرر|مكرر", tail))
    if not article_nos:
        single = re.search(r"ماده\s*\(?\s*([0-9]{1,4})\s*(مکرر|مكرر)?", normalized)
        if single:
            article_nos = [single.group(1).lstrip("0") or "0"]
            mokarrar = bool(single.group(2))
    if not article_nos:
        return None
    return {
        "article_nos": list(dict.fromkeys(article_nos))[:_MAX_ARTICLE_NOS],
        "mokarrar": mokarrar,
        "law_name": recognize_law_name(text),
        "mentions_law": mentions_law_phrase(text),
    }


def _exact_article_point_filter(
    law_name: Optional[str], article_no: Any, mokarrar: bool = False,
    active_only: Optional[bool] = None,
) -> Dict[str, Any]:
    """فیلتر Qdrant برای مادهٔ دقیق: ``article_no`` (+ ``law_name``) و فعال‌بودن."""
    must: List[Dict[str, Any]] = []
    active = active_point_filter(active_only)
    if active:
        must.extend(active.get("must", []))
    numbers = [article_no] if isinstance(article_no, str) else list(article_no)
    article_values: List[str] = []
    for number in numbers:
        article_values.append(number)
        if mokarrar:
            article_values.append(f"{number}-mokarrar")
    must.append({"key": "article_no", "match": {"any": list(dict.fromkeys(article_values))}})
    if law_name:
        must.append({"key": "law_name", "match": {"value": law_name}})
    return {"must": must}


async def _scroll_by_point_filter(point_filter: Dict[str, Any], limit: int) -> List[Dict[str, Any]]:
    """scroll با فیلتر دلخواه payload؛ هرگز استثنا پرتاب نمی‌کند."""
    global _qdrant_last_reachable
    try:
        import httpx
    except ImportError:
        return await asyncio.to_thread(
            _scroll_by_point_filter_urllib, point_filter, limit, QDRANT_FALLBACK_COLLECTION
        )
    body = {
        "limit": max(1, int(limit)),
        "with_payload": True,
        "with_vector": False,
        "filter": point_filter,
    }
    async with httpx.AsyncClient(timeout=QDRANT_FALLBACK_TIMEOUT) as client:
        for host, base, hdrs in _qdrant_targets():
            _qcloud.note_failover(host)
            url = f"{base}/collections/{QDRANT_FALLBACK_COLLECTION}/points/scroll"
            try:
                response = await client.post(url, json=body, headers=hdrs)
            except Exception as exc:  # noqa: BLE001
                logger.debug("qdrant exact-scroll host %s unreachable: %s", host, exc)
                continue
            _qdrant_last_reachable = True
            return _extract_points(response)
    return []


def _scroll_by_point_filter_urllib(
    point_filter: Dict[str, Any], limit: int, collection: str
) -> List[Dict[str, Any]]:
    """مسیر بدون httpx (فقط stdlib) برای scroll فیلترشده."""
    import urllib.request

    global _qdrant_last_reachable
    body = json.dumps(
        {
            "limit": max(1, int(limit)),
            "with_payload": True,
            "with_vector": False,
            "filter": point_filter,
        }
    ).encode("utf-8")
    for host, base, hdrs in _qdrant_targets():
        _qcloud.note_failover(host)
        url = f"{base}/collections/{collection}/points/scroll"
        request = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json", **hdrs}, method="POST"
        )
        try:
            with urllib.request.urlopen(request, timeout=QDRANT_FALLBACK_TIMEOUT) as response:
                payload = json.loads(response.read().decode("utf-8") or "{}")
        except Exception as exc:  # noqa: BLE001
            logger.debug("qdrant exact-scroll (urllib) host %s unreachable: %s", host, exc)
            continue
        _qdrant_last_reachable = True
        points = ((payload or {}).get("result") or {}).get("points") or []
        return [p.get("payload") for p in points if isinstance(p.get("payload"), dict)]
    return []


def _dedupe_article_payloads(
    payloads: Sequence[Dict[str, Any]], limit: int, per_law: bool = False
) -> List[Dict[str, Any]]:
    """یک payload به‌ازای هر (قانون، ماده) — یا هر قانون وقتی ``per_law``."""
    rows: List[Dict[str, Any]] = []
    seen: set = set()
    for payload in payloads:
        if not isinstance(payload, dict) or payload.get("is_active") is False:
            continue
        law = str(payload.get("law_name") or "")
        article = str(_payload_article_no(payload) or "")
        key = law if per_law else (law, article)
        if key in seen:
            continue
        seen.add(key)
        rows.append(payload)
        if len(rows) >= max(1, limit):
            break
    return rows


async def exact_article_lookup(
    query: str, limit: int = 3, active_only: Optional[bool] = None
) -> Optional[List[Dict[str, Any]]]:
    """جست‌وجوی قطعی ماده با فیلتر payload پیش از جست‌وجوی برداری (W25-1).

    خروجی ``None`` یعنی الگوی ماده شناسایی نشد یا چیزی تطبیق نداد — کالر باید
    به مسیر برداری موجود تنزل کند. در غیر این صورت، فهرست ردیف‌های قانونی با
    ``match_level == "QDRANT_EXACT"`` برگردانده می‌شود.
    """
    parsed = _parse_article_query(query)
    if not parsed or not parsed["article_nos"]:
        return None

    article_nos = list(parsed["article_nos"])[:_MAX_ARTICLE_NOS]
    mokarrar = bool(parsed.get("mokarrar"))
    law_name = parsed.get("law_name")

    def _order(payloads: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        rank = {n: i for i, n in enumerate(article_nos)}

        def key(p: Dict[str, Any]) -> int:
            no = str(_payload_article_no(p) or "").split("-")[0]
            return rank.get(no, len(rank))

        return sorted(payloads, key=key)  # پایدار: ترتیب ماده‌های درخواستی

    if law_name:
        point_filter = _exact_article_point_filter(
            law_name, article_nos, mokarrar=mokarrar, active_only=active_only
        )
        wanted = max(1, limit, len(article_nos))
        payloads = _only_active(await _scroll_by_point_filter(point_filter, wanted * 2))
        if not payloads:
            return None
        selected = _dedupe_article_payloads(_order(payloads), wanted)
        return [_payload_to_row(p, match_level="QDRANT_EXACT") for p in selected]

    # قانونی نام برده شده ولی شناخته نشد → مسیر برداری اجرا شود.
    if parsed.get("mentions_law"):
        return None

    # قانونی نام برده نشده → فقط article_no، حداکثر ۳ کاندید از قوانین مختلف.
    point_filter = _exact_article_point_filter(
        None, article_nos, mokarrar=mokarrar, active_only=active_only
    )
    payloads = _only_active(await _scroll_by_point_filter(point_filter, 30 * len(article_nos)))
    if not payloads:
        return None
    selected: List[Dict[str, Any]] = []
    for number in article_nos:
        group = [
            p for p in payloads if str(_payload_article_no(p) or "").split("-")[0] == number
        ]
        selected.extend(_dedupe_article_payloads(group, 3, per_law=True))
    if not selected:
        return None
    return [_payload_to_row(p, match_level="QDRANT_EXACT") for p in selected]


QDRANT_KEYWORD_BOOST_ENABLED = os.environ.get("LIGHTRAG_KEYWORD_BOOST", "1") != "0"
_BOOST_PER_RULE = 3


async def keyword_boost_laws(
    query: str, active_only: Optional[bool] = None
) -> List[Dict[str, Any]]:
    """Retrieval boost for common topics (appeal deadlines, cheque, lease, custody, ...).

    For every ``retrieval_boost.KEYWORD_RULES`` entry fired by ``query`` with a concrete
    article list, scroll those ``article_no`` values by payload filter, keep only rows of
    the named law(s) and return the best few (query-token overlap, then article order) as
    ``KEYWORD_BOOST`` rows. These rows are corpus text found by a lookup hint; the map
    itself is never emitted as answer text. Never raises.
    """
    rules = [r for r in _rb.keyword_targets(query) if r.articles]
    if not rules or not QDRANT_KEYWORD_BOOST_ENABLED:
        return []
    out: List[Dict[str, Any]] = []
    for rule in rules:
        point_filter = _exact_article_point_filter(None, [str(n) for n in rule.articles], active_only=active_only)
        try:
            payloads = _only_active(await _scroll_by_point_filter(point_filter, 40 * len(rule.articles)))
        except Exception as exc:  # noqa: BLE001
            logger.debug("keyword boost scroll failed: %s", exc)
            continue
        cands = [p for p in payloads if _rb.law_matches(p.get("law_name"), rule.law_fragments)]
        def _order_key(p: Dict[str, Any]) -> Tuple[int, int, int]:
            try:
                no = int(str(_payload_article_no(p) or "0").split("-")[0])
            except ValueError:
                no = 0
            return (0 if no in rule.priority else 1, -_rb.lexical_overlap(query, _payload_text(p)), no)

        for p in _dedupe_article_payloads(sorted(cands, key=_order_key), _BOOST_PER_RULE + len(rule.priority)):
            out.append(
                _payload_to_row(
                    p, match_level="KEYWORD_BOOST", score=_rb.lexical_overlap(query, _payload_text(p))
                )
            )
    return out


async def qdrant_fallback_laws(
    query: str, limit: int = 5, active_only: Optional[bool] = None
) -> List[Dict[str, Any]]:
    """Hybrid legal retrieval; with SMARTJUDGE_RERANKER=local the top-N candidates are
    rescored by a cross-encoder and cut to ``limit`` (the single rerank wiring point)."""
    if not _reranker.enabled():
        return await _qdrant_fallback_laws_impl(query, limit, active_only)
    want = max(1, int(limit))
    rows = await _qdrant_fallback_laws_impl(query, _reranker.candidate_count(want), active_only)
    return await _reranker.arerank(query, rows, top_k=want)


async def _qdrant_fallback_laws_impl(
    query: str, limit: int = 5, active_only: Optional[bool] = None
) -> List[Dict[str, Any]]:
    """
    بازیابی مواد قانونی از Qdrant (پیش‌فرض ``iran_laws_bge_m3``) وقتی گراف محلی
    خالی است. هرگز استثنا پرتاب نمی‌کند؛ در نبود سرویس، فهرست خالی برمی‌گرداند.
    در نبود سرویس یک کش منفی کوتاه فعال می‌شود تا تأخیر پرس‌وجوهای بعدی صفر بماند.

    ``active_only`` به‌صورت پیش‌فرض فعال است: پالایهٔ ``is_active == True`` روی
    Qdrant اعمال می‌شود تا هرگز به قانون منسوخ استناد نشود.
    """
    global _qdrant_failed_at, _qdrant_last_reachable
    text = (query or "").strip()
    if not text:
        return []
    if _qdrant_probe_suppressed():
        logger.debug("Qdrant fallback skipped (negative cache active)")
        return []

    desired = max(1, int(limit))
    _qdrant_last_reachable = False

    # Opt-in (SMARTJUDGE_QUERY_REWRITE=1): the vector/lexical branches use the canonical-term
    # extended text; the exact-article lookup keeps the original so "ماده N" still parses.
    search_text = _rb.rewrite_query(text) if _rb.query_rewrite_enabled() else text

    # پیش‌قدم قطعی (W25-1): «ماده N قانون X» را با فیلتر payload پیدا کن تا
    # جست‌وجوی برداری اشتباهاً مادهٔ دیگری (مثلاً ۱۰۱۰ برای ۱۰) را برنگرداند.
    # exact lookup and vector search are independent: run them concurrently.
    exact_res, rest_res, boost_res = await asyncio.gather(
        exact_article_lookup(text, limit=desired, active_only=active_only),
        _qdrant_vector_or_scroll_laws(search_text, desired, active_only),
        keyword_boost_laws(search_text, active_only=active_only),
        return_exceptions=True,
    )
    boost_rows = [] if isinstance(boost_res, BaseException) else list(boost_res or [])
    if isinstance(exact_res, BaseException):
        logger.debug("exact article lookup failed: %s", exact_res)
        exact_rows = None
    else:
        exact_rows = exact_res
    if isinstance(rest_res, BaseException):
        raise rest_res
    rest = rest_res
    if boost_rows:
        # hybrid merge: weighted RRF over [vector/lexical order, keyword-boost order]; the
        # boosted rows are real corpus articles, so they compete on rank, not by fiat.
        rows_by_key: Dict[Tuple[str, str], Dict[str, Any]] = {}
        for row in list(rest) + boost_rows:
            rows_by_key.setdefault((str(row.get("law_name") or ""), str(row.get("article_no") or "")), row)
        keyed = lambda rows: [(str(r.get("law_name") or ""), str(r.get("article_no") or "")) for r in rows]  # noqa: E731
        order = _rb.rrf_merge([(1.0, keyed(rest)), (1.2, keyed(boost_rows))])
        # a row that is in both lists keeps the boost label so the cutoff trusts it
        boosted_keys = set(keyed(boost_rows))
        rest = []
        for key in order:
            row = rows_by_key[key]
            if key in boosted_keys and row.get("match_level") != "KEYWORD_BOOST":
                row = {**row, "match_level": "KEYWORD_BOOST"}
            rest.append(row)
        rest = rest[: max(desired, 4)]
        if not exact_rows:
            _qdrant_failed_at = 0.0
    if not exact_rows:
        return rest
    # ردیف‌های دقیق اول، سپس نتایج معمول تا سقف limit (یکتا بر اساس قانون+ماده).
    _qdrant_failed_at = 0.0
    merged: List[Dict[str, Any]] = []
    seen: set = set()
    for row in list(exact_rows) + list(rest):
        key = (str(row.get("law_name") or ""), str(row.get("article_no") or ""))
        if key in seen:
            continue
        seen.add(key)
        merged.append(row)
        if len(merged) >= desired:
            break
    return merged


async def _qdrant_vector_or_scroll_laws(
    text: str, desired: int, active_only: Optional[bool]
) -> List[Dict[str, Any]]:
    """مسیر موجود: جست‌وجوی برداری و در نبودش scroll (رفتار بدون تغییر)."""
    global _qdrant_failed_at, _qdrant_last_reachable

    # مسیر اصلی: جست‌وجوی برداری واقعی روی حدود QDRANT_VECTOR_TOPK کاندید،
    # سپس همان رتبه‌بندی واژگانی/article_no محلی روی همین کاندیدها.
    # ``None`` یعنی مسیر برداری ممکن نبود (مدل/ابعاد/شبکه) -> تنزل به scroll.
    vector_payloads = await _try_vector_search(text, desired, active_only)
    if vector_payloads is not None:
        _qdrant_failed_at = 0.0
        if not vector_payloads:
            return []
        return _rank_payloads(_only_active(vector_payloads), text, desired)

    try:
        payloads = await _qdrant_scroll_httpx(text, desired, active_only)
    except ImportError:
        payloads = await asyncio.to_thread(_qdrant_scroll_urllib, text, desired, active_only)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Qdrant fallback failed: %s", exc)
        payloads = []

    if not payloads:
        if _qdrant_last_reachable:
            # سرویس پاسخ داد ولی نتیجه‌ای نبود (مثلاً همه مواد منسوخ/پالایش‌شده) —
            # این «خطا» نیست و نباید کش منفی را فعال کند.
            _qdrant_failed_at = 0.0
            return []
        _qdrant_failed_at = time.monotonic()
        logger.warning(
            "Qdrant fallback unavailable on %s -> negative cache %ss",
            ",".join(_QDRANT_HOST_CANDIDATES[:3]),
            QDRANT_RETRY_COOLDOWN,
        )
        return []

    _qdrant_failed_at = 0.0
    return _rank_payloads(_only_active(payloads), text, desired)


def _format_qdrant_answer(laws: Sequence[Dict[str, Any]]) -> Optional[str]:
    if not laws:
        return None
    parts = []
    for row in laws:
        title = str(row.get("title") or "سند حقوقی")
        summary = str(row.get("summary") or "").strip()
        parts.append(f"{title}: {summary}" if summary else title)
    return "\n".join(parts).strip() or None


async def qdrant_retrieve(
    query: str, limit: int = 5, active_only: Optional[bool] = None
) -> Dict[str, Any]:
    """
    بازیابی مستقیم برداری از Qdrant (``iran_laws_bge_m3``) — بدون دخالت گراف.

    برای اندپوینت ``POST /api/v1/apps/judge/query`` که می‌خواهد مستقل از وضعیت
    گراف محلی، صرفاً از پایگاه برداری بپرسد. هرگز استثنا پرتاب نمی‌کند.
    ``active_only`` (پیش‌فرض روشن) قوانین منسوخ را از نتیجه حذف می‌کند.
    """
    text = (query or "").strip()
    if not text:
        return {"source": "empty", "answer": None, "laws": [], "collection": None}
    laws = await qdrant_fallback_laws(text, limit=max(1, int(limit)), active_only=active_only)
    return {
        "source": "qdrant-fallback" if laws else "unavailable",
        "answer": _format_qdrant_answer(laws),
        "laws": laws,
        "collection": QDRANT_FALLBACK_COLLECTION if laws else None,
        "active_only": QDRANT_ACTIVE_ONLY if active_only is None else bool(active_only),
    }


async def rag_query(
    query_text: str,
    mode: Optional[str] = None,
    top_k: int = 6,
    allow_qdrant_fallback: bool = True,
    active_only: Optional[bool] = None,
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
        laws = await qdrant_fallback_laws(text, limit=max(1, min(top_k, 5)), active_only=active_only)
        return _format_qdrant_answer(laws)
    return None


async def rag_retrieve(
    query_text: str, limit: int = 5, mode: Optional[str] = None, active_only: Optional[bool] = None
) -> Dict[str, Any]:
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
        laws = await qdrant_fallback_laws(text, limit=limit, active_only=active_only)
        return {
            "source": "lightrag-empty-answer" if laws else "graph-empty",
            "answer": _format_qdrant_answer(laws),
            "laws": laws,
            "entities": entities,
            "collection": QDRANT_FALLBACK_COLLECTION if laws else None,
        }

    laws = await qdrant_fallback_laws(text, limit=limit, active_only=active_only)
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
    "exact_article_lookup",
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
    "warm_up_embedder",
    "warm_up_embedder_async",
    "rag_query",
    "rag_query_sync",
    "rag_retrieve",
    "recognize_law_name",
    "run_coro_blocking",
]
