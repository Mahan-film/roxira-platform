"""Optional cross-encoder reranker for legal retrieval (track A5).

Flag ``SMARTJUDGE_RERANKER=off|local`` (default ``off``). When ``local``, the retrieval
layer fetches the top-N (default 20) candidates, this module rescores them with a small
multilingual cross-encoder and the caller keeps the top-K it needs.

Safety contract: this module never raises into the caller and never breaks chat. A
disabled flag, a missing dependency, a load failure, a scoring error or a timeout all
return the original order unchanged. Customer text stays on this host (local model only).

Env (names only, no secrets):
  SMARTJUDGE_RERANKER             off | local                      (default off)
  SMARTJUDGE_RERANKER_MODEL       HuggingFace id of a cross-encoder (default below)
  SMARTJUDGE_RERANKER_TOP_N       candidates to rescore             (default 20)
  SMARTJUDGE_RERANKER_MAX_LEN     max tokens per (query, passage)   (default 256)
  SMARTJUDGE_RERANKER_TIMEOUT_MS  budget for one rerank call       (default 1500)
  SMARTJUDGE_RERANKER_THREADS     torch CPU threads, 0 = leave      (default 0)

This is a local HuggingFace cross-encoder, not an LLM, so its id is not in
config/models.yaml (same as the query embedder id in lightrag_engine).
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import os
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

# ~118M params, 12-layer MiniLM, ~0.4 s / 20 passages on 4 CPU threads (measured on a Mac).
# BAAI/bge-reranker-v2-m3 is more accurate but ~3.3 s / 20 passages on the same CPU.
DEFAULT_MODEL = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"
_PIN_LEVELS = frozenset({"QDRANT_EXACT"})  # explicit "ماده N قانون X" lookups stay first

_lock = threading.Lock()
_model: Any = None
_load_failed = False
_model_factory: Optional[Callable[[str], Any]] = None  # test seam
_executor: Optional[concurrent.futures.ThreadPoolExecutor] = None
_busy = threading.Semaphore(1)  # one rerank at a time; extra callers fall back, never queue


def _int_env(name: str, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(os.getenv(name, str(default)))))
    except (TypeError, ValueError):
        return default


def enabled() -> bool:
    return os.getenv("SMARTJUDGE_RERANKER", "off").strip().lower() == "local"


def top_n() -> int:
    return _int_env("SMARTJUDGE_RERANKER_TOP_N", 20, 1, 100)


def candidate_count(limit: int) -> int:
    """How many candidates retrieval should fetch so that top-``limit`` can be reranked."""
    return max(int(limit), top_n())


def _load() -> Any:
    """Lazy, thread-safe model load. Returns None (and remembers) on failure."""
    global _model, _load_failed
    if _model is not None or _load_failed:
        return _model
    with _lock:
        if _model is not None or _load_failed:
            return _model
        name = os.getenv("SMARTJUDGE_RERANKER_MODEL", "").strip() or DEFAULT_MODEL
        try:
            if _model_factory is not None:
                _model = _model_factory(name)
            else:
                threads = _int_env("SMARTJUDGE_RERANKER_THREADS", 0, 0, 64)
                if threads:
                    import torch  # lazy: optional dependency

                    torch.set_num_threads(threads)
                from sentence_transformers import CrossEncoder  # lazy: optional dependency

                t0 = time.monotonic()
                _model = CrossEncoder(
                    name, max_length=_int_env("SMARTJUDGE_RERANKER_MAX_LEN", 256, 32, 512), device="cpu"
                )
                logger.info("reranker %s loaded in %.1fs", name, time.monotonic() - t0)
        except Exception as exc:  # noqa: BLE001 - never break chat
            logger.warning("reranker unavailable (%s): %s", name, exc)
            _load_failed = True
            _model = None
        return _model


def _row_text(row: Dict[str, Any]) -> str:
    title = str(row.get("title") or row.get("law_name") or "").strip()
    body = str(row.get("summary") or row.get("text") or "").strip()
    return f"{title}\n{body}".strip()


def _score(query: str, rows: List[Dict[str, Any]]) -> Optional[List[float]]:
    model = _load()
    if model is None:
        return None
    scores = model.predict([(query, _row_text(r)) for r in rows])
    out = [float(s) for s in list(scores)]
    return out if len(out) == len(rows) else None


def rerank(
    query: str, rows: Sequence[Dict[str, Any]], top_k: Optional[int] = None
) -> List[Dict[str, Any]]:
    """Reorder ``rows`` by cross-encoder relevance; return the first ``top_k`` (all if None).

    Falls back to the original order (still cut to ``top_k``) on any problem.
    """
    rows = list(rows)
    cut = len(rows) if top_k is None else max(0, int(top_k))
    if not enabled() or len(rows) < 2 or not (query or "").strip():
        return rows[:cut]
    pinned = [r for r in rows if r.get("match_level") in _PIN_LEVELS]
    rest = [r for r in rows if r.get("match_level") not in _PIN_LEVELS]
    pool, tail = rest[: top_n()], rest[top_n():]
    if len(pool) < 2:
        return rows[:cut]
    if not _busy.acquire(blocking=False):
        return rows[:cut]
    global _executor
    try:
        if _executor is None:
            _executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="rerank")
        fut = _executor.submit(_score, query, pool)
    except Exception as exc:  # noqa: BLE001 - never break chat
        _busy.release()
        logger.warning("reranker submit failed -> original order: %s", exc)
        return rows[:cut]
    # the slot is released when the worker finishes (even after a timeout), so jobs cannot pile up
    fut.add_done_callback(lambda _f: _busy.release())
    timeout = _int_env("SMARTJUDGE_RERANKER_TIMEOUT_MS", 1500, 50, 60000) / 1000.0
    try:
        scores = fut.result(timeout=timeout)
    except concurrent.futures.TimeoutError:
        logger.warning("reranker timeout after %.2fs -> original order", timeout)
        return rows[:cut]
    except Exception as exc:  # noqa: BLE001 - never break chat
        logger.warning("reranker failed -> original order: %s", exc)
        return rows[:cut]
    if scores is None:
        return rows[:cut]
    order = sorted(range(len(pool)), key=lambda i: (-scores[i], i))  # stable on ties
    return (pinned + [pool[i] for i in order] + tail)[:cut]


async def arerank(
    query: str, rows: Sequence[Dict[str, Any]], top_k: Optional[int] = None
) -> List[Dict[str, Any]]:
    """Async wrapper: runs ``rerank`` off the event loop. Never raises."""
    try:
        return await asyncio.to_thread(rerank, query, rows, top_k)
    except Exception as exc:  # noqa: BLE001
        logger.warning("reranker wrapper failed -> original order: %s", exc)
        rows = list(rows)
        return rows if top_k is None else rows[: max(0, int(top_k))]


def reset_for_tests(factory: Optional[Callable[[str], Any]] = None) -> None:
    global _model, _load_failed, _model_factory
    with _lock:
        _model, _load_failed, _model_factory = None, False, factory
