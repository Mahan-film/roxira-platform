"""Per-stage answer timing and one structured JSON log line per answer (T201).

Reuses the per-request dict that ``chat_fast.timing_var`` already carries (embed_ms,
qdrant_ms, sql_ms, retrieval_ms, ttft_ms, llm_ms), adds rerank / graph expansion /
verification stages plus the model and fallback flag, and emits one line at the end:

    {"event":"answer_timing","request_id":"...","retrieval_ms":..,"rerank_ms":..,...}

Privacy: no question text, no user id, no IP. The request id is sanitised and capped.
Never raises into the caller.
"""

from __future__ import annotations

import contextlib
import json
import re
import sys
import time
from typing import Any, Iterator, Optional

from . import chat_fast as _chat_fast

EVENT = "answer_timing"
_ID_RE = re.compile(r"[^A-Za-z0-9._-]")

# stage keys that are accumulated millisecond counters
MS_KEYS = (
    "embed_ms", "qdrant_ms", "sql_ms", "retrieval_ms", "graph_expansion_ms",
    "rerank_ms", "ttft_ms", "llm_ms", "verify_ms",
)


def _bucket() -> Optional[dict]:
    return _chat_fast.timing_var.get()


@contextlib.contextmanager
def stage(key: str) -> Iterator[None]:
    """Time a block into the current request bucket (adds up if the stage runs twice)."""
    t0 = time.perf_counter()
    try:
        yield
    finally:
        _chat_fast.timing_add(key, (time.perf_counter() - t0) * 1000)


def note_rerank_skipped() -> None:
    b = _bucket()
    if b is not None:
        b["rerank_skipped"] = True


def note_llm(model: Optional[str], *, attempts: int = 1, fallback: bool = False) -> None:
    """Record the model that answered and whether a fallback model/retry was needed."""
    b = _bucket()
    if b is None:
        return
    b["model"] = model or None
    b["llm_attempts"] = int(attempts or 0)
    b["fallback"] = bool(fallback)


def note_router_result(routed: Any) -> None:
    """From an ``llm_router.LLMResult``: more than one HTTP attempt means a retry or fallback."""
    try:
        attempts = int(getattr(routed, "attempts", 0) or 0)
        note_llm(getattr(routed, "model", None), attempts=attempts, fallback=attempts > 1)
    except Exception:  # noqa: BLE001 - observability must never break an answer
        pass


def note_stream_outcome(outcome: Any) -> None:
    """From ``chat_fast.StreamOutcome``: any model tried before the one that answered is a fallback."""
    try:
        attempts = list(getattr(outcome, "attempts", None) or [])
        note_llm(getattr(outcome, "model", None), attempts=len(attempts), fallback=len(attempts) > 1)
    except Exception:  # noqa: BLE001
        pass


def build_record(request_id: Optional[str], bucket: Optional[dict], total_ms: int,
                 tier: Optional[str] = None, collection: Optional[str] = None) -> dict:
    b = bucket or {}
    rec: dict = {
        "event": EVENT,
        "request_id": _ID_RE.sub("", str(request_id or ""))[:64] or None,
        "tier": tier,
        "collection": collection,
    }
    for key in MS_KEYS:
        rec[key] = b.get(key)
    rec["rerank_skipped"] = bool(b.get("rerank_skipped", False))
    rec["model"] = b.get("model")
    rec["fallback"] = bool(b.get("fallback", False))
    rec["llm_attempts"] = b.get("llm_attempts")
    rec["total_ms"] = int(total_ms)
    return rec


def emit(request_id: Optional[str], bucket: Optional[dict], total_ms: int,
         tier: Optional[str] = None, collection: Optional[str] = None) -> None:
    """Write one JSON line to stderr (docker logs). Never raises."""
    try:
        line = json.dumps(build_record(request_id, bucket, total_ms, tier, collection),
                          ensure_ascii=False, separators=(",", ":"))
        print(line, file=sys.stderr, flush=True)
    except Exception:  # noqa: BLE001
        pass
