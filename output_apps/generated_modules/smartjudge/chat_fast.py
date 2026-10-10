"""Latency helpers for the Smart Judge chat path (pure, no network, unit-testable).

Holds: per-request sub-timings, a small TTL cache, SSE framing, source payload
trimming, parallel retrieval orchestration and the stream-with-fast-fallback loop.
Model ids never appear here; callers pass them in from config/models.yaml.
"""
from __future__ import annotations

import asyncio
import contextvars
import json
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable, Optional

# ---------------------------------------------------------------------------
# Sub-timings ([CHAT-TIMING] embed_ms / qdrant_ms / sql_ms / ttft_ms / llm_ms)
# ---------------------------------------------------------------------------
timing_var: "contextvars.ContextVar[Optional[dict]]" = contextvars.ContextVar("chat_timing", default=None)


def timing_add(key: str, ms: float) -> None:
    """Accumulate ``ms`` into the current request's bucket (safe from worker threads)."""
    bucket = timing_var.get()
    if bucket is not None:
        bucket[key] = round(bucket.get(key, 0) + ms)


# ---------------------------------------------------------------------------
# TTL cache
# ---------------------------------------------------------------------------
class TTLCache:
    def __init__(self, ttl: float = 600.0, max_entries: int = 512, clock: Callable[[], float] = time.monotonic):
        self.ttl = ttl
        self.max_entries = max_entries
        self._clock = clock
        self._data: "OrderedDict[Any, tuple[float, Any]]" = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: Any) -> Any:
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            if self._clock() - item[0] > self.ttl:
                self._data.pop(key, None)
                return None
            self._data.move_to_end(key)
            return item[1]

    def set(self, key: Any, value: Any) -> None:
        with self._lock:
            self._data[key] = (self._clock(), value)
            self._data.move_to_end(key)
            while len(self._data) > self.max_entries:
                self._data.popitem(last=False)


# ---------------------------------------------------------------------------
# SSE framing
# ---------------------------------------------------------------------------
def sse_frame(event: str, data: Any) -> str:
    """One Server-Sent-Events frame. JSON is single-line (ensure_ascii=False keeps Persian compact)."""
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


# ---------------------------------------------------------------------------
# Payload / prompt trimming
# ---------------------------------------------------------------------------
_KEEP_FIELDS = ("title", "category", "law_name", "article_no", "number", "subject", "binding_effect", "match_level")


def _short(text: Any, limit: int) -> str:
    s = " ".join(str(text or "").split())
    return s if len(s) <= limit else s[: max(0, limit - 1)].rstrip() + "…"


def trim_sources(rows: Any, *, excerpt_chars: int = 220, max_rows: int = 6) -> list:
    """Response form of statutory_basis / unified_precedents: no full ``summary`` text."""
    out: list = []
    for row in list(rows or [])[:max_rows]:
        if not isinstance(row, dict):
            out.append(row)
            continue
        item = {k: row[k] for k in _KEEP_FIELDS if row.get(k) not in (None, "")}
        excerpt = _short(row.get("summary"), excerpt_chars)
        if excerpt:
            item["excerpt"] = excerpt
        out.append(item)
    return out


def context_lines(rows: Any, *, top_k: int = 4, summary_chars: int = 500) -> str:
    """Prompt form: top-k rows, summaries truncated, to cut prompt tokens."""
    lines = []
    for row in list(rows or [])[:top_k]:
        if isinstance(row, dict):
            lines.append(f"- {row.get('title')}: {_short(row.get('summary'), summary_chars)}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Parallel retrieval orchestration
# ---------------------------------------------------------------------------
async def parallel_retrieve(
    qdrant_fn: Callable[[], Awaitable[Any]],
    sql_fn: Optional[Callable[[], Awaitable[Any]]],
) -> tuple:
    """Run the vector and SQL searches concurrently.

    Returns ``(qdrant_result, sql_result, qdrant_exc, sql_exc)``; one failing branch
    never cancels or hides the other. Records qdrant_ms / sql_ms sub-timings.
    """
    async def _timed(fn, key):
        t0 = time.perf_counter()
        try:
            return await fn()
        finally:
            timing_add(key, (time.perf_counter() - t0) * 1000)

    jobs = [_timed(qdrant_fn, "qdrant_ms")]
    if sql_fn is not None:
        jobs.append(_timed(sql_fn, "sql_ms"))
    res = await asyncio.gather(*jobs, return_exceptions=True)
    q = res[0]
    s = res[1] if len(res) > 1 else None
    q_exc = q if isinstance(q, BaseException) else None
    s_exc = s if isinstance(s, BaseException) else None
    return (None if q_exc else q), (None if s_exc else s), q_exc, s_exc


# ---------------------------------------------------------------------------
# Streaming with fast fallback
# ---------------------------------------------------------------------------
@dataclass
class StreamOutcome:
    text: str = ""
    model: Optional[str] = None
    ttft_ms: Optional[int] = None
    interrupted: bool = False
    failures: list = field(default_factory=list)  # [(model, http_status|None, kind)]
    attempts: list = field(default_factory=list)  # [(model, "ok"|"timeout"|"empty"|"error:<Type>")]


async def stream_with_fallback(
    plan: list,
    opener: Callable[[str], AsyncIterator[str]],
    on_delta: Optional[Callable[[str], Any]] = None,
    *,
    total_timeout: float = 40.0,
) -> StreamOutcome:
    """Try ``plan`` = [(model, first_token_timeout_s), ...] in order.

    A model that produces no first token within its timeout (or errors / is empty
    before the first token) is abandoned immediately and the next, faster model is
    tried -- instead of waiting for a long total timeout. Once text has started,
    a later error ends the answer as ``interrupted`` (no silent restart, which
    would duplicate text the user already saw).
    """
    out = StreamOutcome()
    deadline = time.monotonic() + total_timeout
    for model, ttft_timeout in plan:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            out.attempts.append((model, "timeout"))
            break
        t0 = time.perf_counter()
        agen = opener(model)
        status = "ok"
        try:
            try:
                first = await asyncio.wait_for(agen.__anext__(), min(ttft_timeout, remaining))
            except StopAsyncIteration:
                status = "empty"
                continue
            except asyncio.TimeoutError:
                status = "timeout"
                out.failures.append((model, None, "timeout"))
                continue
            except Exception as exc:  # noqa: BLE001 - provider/network error before first token
                status = f"error:{type(exc).__name__}"
                out.failures.append((model, getattr(exc, "status", None), classify_attempt(status, exc)))
                continue
            out.ttft_ms = round((time.perf_counter() - t0) * 1000)
            out.model = model
            out.text = first
            if on_delta:
                r = on_delta(first)
                if asyncio.iscoroutine(r):
                    await r
            try:
                async for piece in agen:
                    out.text += piece
                    if on_delta:
                        r = on_delta(piece)
                        if asyncio.iscoroutine(r):
                            await r
                    if time.monotonic() > deadline:
                        out.interrupted = True
                        break
            except Exception as exc:  # noqa: BLE001
                out.interrupted = True
                status = f"error:{type(exc).__name__}"
            return out
        finally:
            out.attempts.append((model, status))
            try:
                await agen.aclose()
            except Exception:  # noqa: BLE001
                pass
    return out


# ---------------------------------------------------------------------------
# Failure classification / LLM-unavailable contract
# ---------------------------------------------------------------------------
LLM_UNAVAILABLE_MESSAGE = "سرویس پاسخ‌گویی موقتاً در دسترس نیست؛ چند دقیقه دیگر دوباره تلاش کنید."


class LLMProviderError(RuntimeError):
    """Raised by the opener for a non-2xx / in-stream provider error (never carries prompt text)."""

    def __init__(self, status: Optional[int], model: str, detail: str = ""):
        super().__init__(f"{model} -> HTTP {status}")
        self.status = status
        self.model = model
        self.detail = detail[:120]


def classify_status(status: Optional[int], detail: str = "") -> str:
    """quota (402/403 key limit, 429) | auth (401) | timeout | upstream (5xx) | error."""
    d = (detail or "").lower()
    if status in (402, 429) or "limit exceeded" in d or "insufficient" in d or "credit" in d:
        return "quota"
    if status == 403:
        return "quota" if "limit" in d else "auth"
    if status == 401:
        return "auth"
    if status in (408, 504):
        return "timeout"
    if status is not None and status >= 500:
        return "upstream"
    return "error"


def classify_attempt(status_text: str, exc: Optional[BaseException] = None) -> str:
    if isinstance(exc, LLMProviderError):
        return classify_status(exc.status, exc.detail)
    if status_text == "timeout":
        return "timeout"
    return "error"


def llm_unavailable_log(provider: str, status: Any, model: Any, kind: str) -> str:
    return f"[LLM-UNAVAILABLE] provider={provider} status={status} model={model} kind={kind}"


def llm_unavailable_body() -> dict:
    return {"status": "ERROR", "code": "LLM_UNAVAILABLE", "message": LLM_UNAVAILABLE_MESSAGE}
