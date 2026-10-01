"""Single entry point for every product-runtime LLM call (docs/STRATEGY.md §3b).

    result = await llm_router.complete("cheap", messages, sensitive=True,
                                       tenant="ghazi", user=phone, feature="consult",
                                       temperature=0, max_tokens=800)
    result.content, result.model, result.cost_usd

Tiers map to OpenRouter model lists read from the environment and sent as
OpenRouter's ``models: [...]`` fallback array, so a retired or rate-limited
model degrades to the next one instead of causing an outage:

    LLM_TIER_FREE    non-sensitive background work (crawler, SEO, tagging)
    LLM_TIER_CHEAP   default chat, classification, query rewriting
    LLM_TIER_STRONG  final legal drafting shown to the customer

Hard rules enforced here, not by callers:

* ``sensitive=True`` never reaches a ``:free`` endpoint. A ``free`` request is
  promoted to ``cheap``, any ``:free`` id is stripped from the list, and the
  request carries ``provider.data_collection = "deny"``.
* A free-tier 429 (daily/minute cap) falls through to ``cheap`` for
  non-sensitive calls. 408/429/5xx and transport errors are retried with
  exponential backoff (``Retry-After`` honoured).
* The ``cheap`` role disables hidden reasoning by default
  (``reasoning: {"enabled": false}``), because those tokens bill as output and
  can return empty answers on a small ``max_tokens``. Override with
  ``LLM_REASONING_CHEAP=default|off|low``. The ``strong`` role is untouched; a
  provider that rejects the field (HTTP 400) gets one retry without it.

Responses are cached in Redis (``LLM_CACHE_TTL_SECONDS``) only when the call is
deterministic (``temperature == 0``). Every call, cached or not, writes one
usage record (tenant, user, model actually used, tokens, cost) to a JSON log and,
when ``LLM_USAGE_DSN`` is set, to the ``llm_usage`` Postgres table. Run
``python -m output_apps.generated_modules.smartjudge.llm_router summary`` for a
per-day cost summary.

Secrets are read from the environment only. There is no default API key.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import random
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime
from typing import Any

import httpx

from . import model_registry

log = logging.getLogger("llm_router")
usage_log = logging.getLogger("llm_router.usage")

TIERS = ("free", "cheap", "strong")

# Fallback defaults, used only if config/models.yaml (the registry, W12) cannot
# be read — e.g. the file is missing or PyYAML is not installed. Kept in sync
# with config/models.yaml's free/cheap/strong roles by scripts/check_models.py;
# do not edit one without the other.
_FALLBACK_TIER_MODELS = {
    "free": "qwen/qwen3.8-27b:free,google/gemma-4-31b-it:free,"
    "nvidia/nemotron-3-super-120b-a12b:free",
    "cheap": "deepseek/deepseek-v4.1-flash,deepseek/deepseek-v4-flash-0731,"
    "qwen/qwen3.8-flash,google/gemini-3.1-flash-lite",
    "strong": "deepseek/deepseek-v4-pro,z-ai/glm-5.3,moonshotai/kimi-k3,google/gemini-3.8-flash",
}


def _default_tier_models() -> dict[str, str]:
    """Tier -> comma-joined model list, from config/models.yaml where possible."""
    out = dict(_FALLBACK_TIER_MODELS)
    for tier in TIERS:
        try:
            models = model_registry.role_models(tier)
        except model_registry.ModelRegistryError as exc:
            log.warning("model_registry unavailable for tier %r, using fallback: %s", tier, exc)
            continue
        if models:
            out[tier] = ",".join(models)
    return out


# Read once at import time (same as the old hardcoded dict); an env var
# (LLM_TIER_<TIER>) always overrides this per call, see tier_models() below.
DEFAULT_TIER_MODELS = _default_tier_models()

RETRYABLE_STATUS = frozenset({408, 429, 500, 502, 503, 504})

USAGE_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS llm_usage (
    id                BIGSERIAL PRIMARY KEY,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    tenant            TEXT,
    user_ref          TEXT,
    feature           TEXT,
    tier              TEXT NOT NULL,
    requested_models  TEXT[] NOT NULL,
    model             TEXT,
    sensitive         BOOLEAN NOT NULL,
    cached            BOOLEAN NOT NULL,
    status            TEXT NOT NULL,
    http_status       INTEGER,
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens     INTEGER NOT NULL DEFAULT 0,
    cost_usd          NUMERIC(14, 8) NOT NULL DEFAULT 0,
    latency_ms        INTEGER NOT NULL,
    attempts          INTEGER NOT NULL,
    generation_id     TEXT
);
CREATE INDEX IF NOT EXISTS llm_usage_created_at_idx ON llm_usage (created_at);
"""

DAILY_SUMMARY_SQL = """
SELECT created_at::date                         AS day,
       COALESCE(tenant, '-')                     AS tenant,
       tier,
       model,
       count(*)                                  AS calls,
       count(*) FILTER (WHERE cached)            AS cache_hits,
       count(*) FILTER (WHERE status <> 'ok')    AS errors,
       sum(prompt_tokens)                        AS prompt_tokens,
       sum(completion_tokens)                    AS completion_tokens,
       round(sum(cost_usd), 6)                   AS cost_usd
FROM llm_usage
WHERE created_at >= %(since)s
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC, cost_usd DESC;
"""


class LLMRouterError(RuntimeError):
    """Raised when every model and retry for a call has failed."""

    def __init__(self, message: str, *, status: int | None = None, tier: str | None = None):
        super().__init__(message)
        self.status = status
        self.tier = tier


@dataclass
class LLMResult:
    content: str
    model: str
    tier: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0
    cost_usd: float = 0.0
    cached: bool = False
    attempts: int = 0
    generation_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


# ---------------------------------------------------------------------------
# Configuration (read on every call so env changes and tests need no reload)
# ---------------------------------------------------------------------------

def _env_bool(key: str, default: bool) -> bool:
    val = os.environ.get(key, "").strip().lower()
    if not val:
        return default
    return val in ("1", "true", "yes", "on")


def _env_float(key: str, default: float) -> float:
    try:
        return float(os.environ.get(key, "").strip() or default)
    except ValueError:
        return default


def router_enabled() -> bool:
    """Feature flag for migrated call sites. Off unless LLM_ROUTER_ENABLED=1."""
    return _env_bool("LLM_ROUTER_ENABLED", False)


def is_free_model(model_id: str) -> bool:
    return model_id.endswith(":free") or model_id == "openrouter/free"


def tier_models(tier: str) -> list[str]:
    raw = os.environ.get(f"LLM_TIER_{tier.upper()}", "").strip() or DEFAULT_TIER_MODELS[tier]
    seen: list[str] = []
    for m in raw.split(","):
        m = m.strip()
        if m and m not in seen:
            seen.append(m)
    return seen


# Hidden "thinking" tokens on the cheap providers are billed as output and can
# eat the whole max_tokens budget, returning empty answers (issue #134, verified
# 2026-09-29 on deepseek/deepseek-v4-flash and v4.1-flash). Disable them for the
# cheap role by default; override per tier with
# LLM_REASONING_CHEAP=default|off|low. The strong tier is never changed.
REASONING_MODES = ("default", "off", "low")
DEFAULT_REASONING_CHEAP = "off"


def reasoning_param(tier: str) -> dict[str, Any] | None:
    """OpenRouter ``reasoning`` body field for ``tier``, or None to omit it.

    ``default`` omits the field (provider default), ``off`` sends
    ``{"enabled": false}``, ``low`` sends ``{"enabled": true, "effort": "low"}``.
    Only the ``cheap`` role is affected; every other tier is left untouched.
    """
    if tier != "cheap":
        return None
    mode = os.environ.get("LLM_REASONING_CHEAP", "").strip().lower() or DEFAULT_REASONING_CHEAP
    if mode == "default":
        return None
    if mode == "low":
        return {"enabled": True, "effort": "low"}
    if mode != "off":
        log.warning("unknown LLM_REASONING_CHEAP=%r; using 'off'", mode)
    return {"enabled": False}


OPENROUTER_MAX_MODELS = 3


def _resolve_models(tier: str, sensitive: bool) -> tuple[str, list[str]]:
    if tier not in TIERS:
        raise ValueError(f"unknown LLM tier {tier!r}; expected one of {TIERS}")
    if sensitive and tier == "free":
        log.warning("sensitive call requested tier=free; promoting to cheap")
        tier = "cheap"
    models = tier_models(tier)
    if sensitive:
        dropped = [m for m in models if is_free_model(m)]
        if dropped:
            log.warning("dropping :free models from sensitive call: %s", dropped)
        models = [m for m in models if not is_free_model(m)]
    if not models:
        raise LLMRouterError(f"no usable models configured for tier {tier!r}", tier=tier)
    return tier, models[:OPENROUTER_MAX_MODELS]


# ---------------------------------------------------------------------------
# Shared clients
# ---------------------------------------------------------------------------

_http_client: httpx.AsyncClient | None = None
_redis_client: Any = None
_redis_disabled = False
_usage_table_ready = False
_background: set[asyncio.Task] = set()


def set_http_client(client: httpx.AsyncClient | None) -> None:
    """Inject an httpx client (tests pass one built on httpx.MockTransport)."""
    global _http_client
    _http_client = client


def set_redis_client(client: Any) -> None:
    """Inject a redis.asyncio-compatible client, or None to run without a cache."""
    global _redis_client, _redis_disabled
    _redis_client = client
    _redis_disabled = client is None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        timeout = _env_float("LLM_TIMEOUT_SECONDS", 60.0)
        _http_client = httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=5.0))
    return _http_client


def _redis_url() -> str:
    url = os.environ.get("REDIS_URL", "").strip()
    if url:
        return url
    host = os.environ.get("REDIS_HOST", "").strip()
    if host:
        return f"redis://{host}:{os.environ.get('REDIS_PORT', '6379').strip()}/0"
    return ""


def _get_redis() -> Any:
    global _redis_client, _redis_disabled
    if _redis_client is not None or _redis_disabled:
        return _redis_client
    url = _redis_url()
    if not url:
        _redis_disabled = True
        return None
    try:
        import redis.asyncio as aioredis

        _redis_client = aioredis.from_url(url, socket_timeout=0.5, socket_connect_timeout=0.5)
    except Exception as exc:  # library missing or bad URL: run without cache
        log.warning("redis cache disabled: %s", exc)
        _redis_disabled = True
    return _redis_client


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

def _cache_ttl() -> int:
    return int(_env_float("LLM_CACHE_TTL_SECONDS", 86400))


def _is_cacheable(params: dict[str, Any]) -> bool:
    # A missing temperature means the provider default (usually 1.0), so only an
    # explicit temperature of 0 is deterministic enough to cache.
    temp = params.get("temperature")
    return temp is not None and float(temp) <= 0 and _cache_ttl() > 0 and not params.get("stream")


def cache_key(models: list[str], messages: list[dict], params: dict[str, Any]) -> str:
    blob = json.dumps(
        {"models": models, "messages": messages, "params": params},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return "llm:v1:" + hashlib.sha256(blob.encode("utf-8")).hexdigest()


async def _cache_get(key: str) -> dict | None:
    r = _get_redis()
    if r is None:
        return None
    try:
        raw = await r.get(key)
        return json.loads(raw) if raw else None
    except Exception as exc:
        log.warning("redis get failed: %s", exc)
        return None


async def _cache_set(key: str, value: dict) -> None:
    r = _get_redis()
    if r is None:
        return
    try:
        await r.set(key, json.dumps(value, ensure_ascii=False), ex=_cache_ttl())
    except Exception as exc:
        log.warning("redis set failed: %s", exc)


# ---------------------------------------------------------------------------
# Usage log
# ---------------------------------------------------------------------------

async def _write_usage(record: dict[str, Any]) -> None:
    line = json.dumps(record, ensure_ascii=False, default=str)
    usage_log.info(line)
    path = os.environ.get("LLM_USAGE_LOG_PATH", "").strip()
    if path:
        try:
            await asyncio.to_thread(_append_line, path, line)
        except Exception as exc:
            log.warning("usage log write failed: %s", exc)
    dsn = os.environ.get("LLM_USAGE_DSN", "").strip()
    if dsn:
        try:
            await _insert_usage_row(dsn, record)
        except Exception as exc:
            log.warning("usage row insert failed: %s", exc)


def _append_line(path: str, line: str) -> None:
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")


async def _insert_usage_row(dsn: str, rec: dict[str, Any]) -> None:
    global _usage_table_ready
    import psycopg

    async with await psycopg.AsyncConnection.connect(dsn, autocommit=True) as conn:
        if not _usage_table_ready:
            await conn.execute(USAGE_TABLE_DDL)
            _usage_table_ready = True
        await conn.execute(
            """
            INSERT INTO llm_usage (tenant, user_ref, feature, tier, requested_models, model,
                sensitive, cached, status, http_status, prompt_tokens, completion_tokens,
                cached_tokens, cost_usd, latency_ms, attempts, generation_id)
            VALUES (%(tenant)s, %(user)s, %(feature)s, %(tier)s, %(requested_models)s,
                %(model)s, %(sensitive)s, %(cached)s, %(status)s, %(http_status)s,
                %(prompt_tokens)s, %(completion_tokens)s, %(cached_tokens)s, %(cost_usd)s,
                %(latency_ms)s, %(attempts)s, %(generation_id)s)
            """,
            rec,
        )


def _log_usage_background(record: dict[str, Any]) -> None:
    task = asyncio.get_running_loop().create_task(_write_usage(record))
    _background.add(task)
    task.add_done_callback(_background.discard)


async def flush_usage() -> None:
    """Wait for pending usage writes (tests and graceful shutdown)."""
    if _background:
        await asyncio.gather(*list(_background), return_exceptions=True)


# ---------------------------------------------------------------------------
# HTTP call with retries
# ---------------------------------------------------------------------------

class _CallFailed(Exception):
    def __init__(self, message: str, status: int | None):
        super().__init__(message)
        self.status = status


def _headers() -> dict[str, str]:
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise LLMRouterError("OPENROUTER_API_KEY is not set")
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": os.environ.get("LLM_APP_REFERER", "https://ghazihoushmand.ir"),
        "X-Title": os.environ.get("LLM_APP_TITLE", "Roxira SmartJudge"),
    }


def _retry_delay(attempt: int, resp: httpx.Response | None) -> float:
    cap = _env_float("LLM_RETRY_MAX_DELAY", 8.0)
    if resp is not None:
        ra = resp.headers.get("retry-after")
        if ra:
            try:
                return min(cap, max(0.0, float(ra)))
            except ValueError:
                pass
    base = _env_float("LLM_RETRY_BASE_DELAY", 0.5)
    return min(cap, base * (2 ** attempt)) * (0.5 + random.random() / 2)


async def _post_with_retries(
    body: dict[str, Any],
    *,
    fail_fast_on_429: bool,
    timeout: float | None,
    max_retries: int | None,
) -> tuple[dict[str, Any], int]:
    """POST to /chat/completions. Returns (json, attempts) or raises _CallFailed."""
    url = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
    url += "/chat/completions"
    headers = _headers()
    if max_retries is None:
        max_retries = int(_env_float("LLM_MAX_RETRIES", 2))
    post_kw: dict[str, Any] = {}
    if timeout is not None:
        post_kw["timeout"] = httpx.Timeout(timeout, connect=min(timeout, 5.0))
    client = _get_http_client()
    last_status: int | None = None
    last_msg = ""
    for attempt in range(max_retries + 1):
        resp: httpx.Response | None = None
        try:
            resp = await client.post(url, json=body, headers=headers, **post_kw)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_status, last_msg = None, f"{type(exc).__name__}: {exc}"
        else:
            data: dict[str, Any] = {}
            try:
                data = resp.json()
            except ValueError:
                pass
            err = data.get("error") if isinstance(data, dict) else None
            if resp.status_code == 200 and not err:
                return data, attempt + 1
            status = resp.status_code
            if err and status == 200:
                # OpenRouter can report an upstream failure inside a 200 body.
                code = err.get("code") if isinstance(err, dict) else None
                status = code if isinstance(code, int) else 502
            last_status = status
            last_msg = json.dumps(err, ensure_ascii=False)[:300] if err else resp.text[:300]
            if status not in RETRYABLE_STATUS:
                raise _CallFailed(f"HTTP {status}: {last_msg}", status)
            if status == 429 and fail_fast_on_429:
                raise _CallFailed(f"HTTP 429: {last_msg}", 429)
        if attempt < max_retries:
            await asyncio.sleep(_retry_delay(attempt, resp))
    raise _CallFailed(f"retries exhausted, last error: {last_msg}", last_status)


async def _post_with_reasoning_fallback(
    body: dict[str, Any],
    *,
    fail_fast_on_429: bool,
    timeout: float | None,
    max_retries: int | None,
) -> tuple[dict[str, Any], int]:
    """POST, and if a provider rejects the ``reasoning`` field (HTTP 400) retry
    once with it stripped. Returns (json, attempts), including the rejected try."""
    try:
        return await _post_with_retries(
            body, fail_fast_on_429=fail_fast_on_429, timeout=timeout, max_retries=max_retries
        )
    except _CallFailed as exc:
        if exc.status != 400 or "reasoning" not in body:
            raise
        log.warning("provider rejected the reasoning field (HTTP 400); retrying once without it")
        stripped = {k: v for k, v in body.items() if k != "reasoning"}
        data, attempts = await _post_with_retries(
            stripped, fail_fast_on_429=fail_fast_on_429, timeout=timeout, max_retries=max_retries
        )
        return data, attempts + 1


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def complete(
    tier: str,
    messages: list[dict[str, Any]],
    *,
    sensitive: bool,
    tenant: str | None = None,
    user: str | None = None,
    feature: str | None = None,
    timeout: float | None = None,
    max_retries: int | None = None,
    **params: Any,
) -> LLMResult:
    """Run one chat completion through the tiered OpenRouter router.

    ``sensitive`` has no default on purpose: every caller must decide whether
    the prompt carries customer data. ``params`` are passed to OpenRouter
    as-is (temperature, max_tokens, response_format, ...). ``model``/``models``
    are rejected so callers cannot bypass the tier lists. ``timeout`` (seconds
    per attempt) and ``max_retries`` override LLM_TIMEOUT_SECONDS and
    LLM_MAX_RETRIES for latency-sensitive callers such as voice.
    """
    if "model" in params or "models" in params:
        raise ValueError("pass a tier, not model/models; configure models via LLM_TIER_*")
    if params.get("stream"):
        raise ValueError("streaming is not supported by llm_router.complete")

    requested_tier = tier
    tier, models = _resolve_models(tier, sensitive)
    t0 = time.monotonic()
    base = {
        "tenant": tenant,
        "user": user,
        "feature": feature,
        "sensitive": sensitive,
        "requested_tier": requested_tier,
    }

    key = cache_key(models, messages, params) if _is_cacheable(params) else None
    if key:
        hit = await _cache_get(key)
        if hit:
            result = LLMResult(**{**hit, "cached": True, "attempts": 0, "cost_usd": 0.0})
            _log_usage_background(_usage_record(base, result, models, t0, "ok", None))
            return result

    total_attempts = 0
    while True:
        body: dict[str, Any] = {**params, "models": models, "messages": messages}
        reasoning = reasoning_param(tier)
        if reasoning is not None:
            body["reasoning"] = reasoning
        if sensitive and _env_bool("LLM_SENSITIVE_DENY_DATA_COLLECTION", True):
            provider = dict(body.get("provider") or {})
            provider.setdefault("data_collection", "deny")
            body["provider"] = provider
        can_fall_through = tier == "free" and not sensitive
        try:
            data, attempts = await _post_with_reasoning_fallback(
                body, fail_fast_on_429=can_fall_through, timeout=timeout, max_retries=max_retries
            )
            total_attempts += attempts
        except _CallFailed as exc:
            total_attempts += 1
            if can_fall_through and exc.status == 429:
                log.warning("free tier rate-limited; falling through to cheap")
                tier, models = _resolve_models("cheap", sensitive)
                continue
            failed = LLMResult(content="", model="", tier=tier, attempts=total_attempts)
            _log_usage_background(_usage_record(base, failed, models, t0, "error", exc.status))
            raise LLMRouterError(str(exc), status=exc.status, tier=tier) from exc
        break

    result = _parse_result(data, tier, total_attempts)
    _log_usage_background(_usage_record(base, result, models, t0, "ok", 200))
    if key and result.content:
        cached = asdict(result)
        cached.pop("raw", None)
        await _cache_set(key, cached)
    return result


def _parse_result(data: dict[str, Any], tier: str, attempts: int) -> LLMResult:
    choices = data.get("choices") or []
    content = ""
    if choices:
        content = ((choices[0].get("message") or {}).get("content") or "").strip()
    usage = data.get("usage") or {}
    details = usage.get("prompt_tokens_details") or {}
    return LLMResult(
        content=content,
        model=data.get("model") or "",
        tier=tier,
        prompt_tokens=int(usage.get("prompt_tokens") or 0),
        completion_tokens=int(usage.get("completion_tokens") or 0),
        cached_tokens=int(details.get("cached_tokens") or 0),
        # OpenRouter reports cost in credits; 1 credit = 1 USD.
        cost_usd=float(usage.get("cost") or 0.0),
        attempts=attempts,
        generation_id=data.get("id"),
        raw=data,
    )


def _usage_record(
    base: dict[str, Any],
    result: LLMResult,
    models: list[str],
    t0: float,
    status: str,
    http_status: int | None,
) -> dict[str, Any]:
    return {
        "ts": datetime.now(UTC).isoformat(),
        **base,
        "tier": result.tier,
        "requested_models": models,
        "model": result.model or None,
        "cached": result.cached,
        "status": status,
        "http_status": http_status,
        "prompt_tokens": result.prompt_tokens,
        "completion_tokens": result.completion_tokens,
        "cached_tokens": result.cached_tokens,
        "cost_usd": result.cost_usd,
        "latency_ms": int((time.monotonic() - t0) * 1000),
        "attempts": result.attempts,
        "generation_id": result.generation_id,
    }


# ---------------------------------------------------------------------------
# Daily summary
# ---------------------------------------------------------------------------

def summarize_jsonl(path: str, since: date) -> list[dict[str, Any]]:
    """Same aggregation as DAILY_SUMMARY_SQL, over a LLM_USAGE_LOG_PATH file."""
    rows: dict[tuple, dict[str, Any]] = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            day = rec.get("ts", "")[:10]
            if not day or day < since.isoformat():
                continue
            k = (day, rec.get("tenant") or "-", rec.get("tier"), rec.get("model"))
            row = rows.setdefault(k, {
                "day": day, "tenant": k[1], "tier": k[2], "model": k[3], "calls": 0,
                "cache_hits": 0, "errors": 0, "prompt_tokens": 0, "completion_tokens": 0,
                "cost_usd": 0.0,
            })
            row["calls"] += 1
            row["cache_hits"] += int(bool(rec.get("cached")))
            row["errors"] += int(rec.get("status") != "ok")
            row["prompt_tokens"] += int(rec.get("prompt_tokens") or 0)
            row["completion_tokens"] += int(rec.get("completion_tokens") or 0)
            row["cost_usd"] = round(row["cost_usd"] + float(rec.get("cost_usd") or 0), 6)
    return sorted(rows.values(), key=lambda r: (r["day"], r["cost_usd"]), reverse=True)


def _main(argv: list[str]) -> int:
    import argparse
    from datetime import timedelta

    ap = argparse.ArgumentParser(prog="llm_router")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("summary", help="per-day cost by tenant/tier/model")
    s.add_argument("--days", type=int, default=7)
    args = ap.parse_args(argv)

    since = datetime.now(UTC).date() - timedelta(days=args.days - 1)
    dsn = os.environ.get("LLM_USAGE_DSN", "").strip()
    path = os.environ.get("LLM_USAGE_LOG_PATH", "").strip()
    if dsn:
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(dsn) as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(DAILY_SUMMARY_SQL, {"since": since})
            rows = cur.fetchall()
    elif path:
        rows = summarize_jsonl(path, since)
    else:
        print("set LLM_USAGE_DSN or LLM_USAGE_LOG_PATH", file=sys.stderr)
        return 2
    for row in rows:
        print(json.dumps(row, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
