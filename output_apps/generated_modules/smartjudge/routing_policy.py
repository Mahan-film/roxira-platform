"""Off-peak scheduling and prompt reuse for the fleet dispatcher (issue #367).

Batch work waits for DeepSeek's discount window -- 19:30 to 03:30 Tehran, i.e. 16:00 to
00:00 UTC (docs/strategy/PRODUCT_DECISIONS_2026-11.md) -- while interactive work runs at
once. An identical prompt reuses the answer already on disk, so a retry or a repeated
review makes zero model calls.

Time and the cache file are injectable, so tests run on a fake clock with no network,
no keys and no writes outside the temp dir. This module never prints a secret.

    routing_policy.should_defer(now_utc)                 # True outside the window
    routing_policy.next_offpeak(now_utc)                 # when the window next opens (UTC)
    routing_policy.cache_get(routing_policy.cache_key(prompt))
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
from datetime import datetime, time, timedelta, timezone
from typing import Any

TEHRAN = timezone(timedelta(hours=3, minutes=30), "Tehran")
OFFPEAK_START = time(19, 30)  # Tehran local: the window opens
OFFPEAK_END = time(3, 30)     # Tehran local: the window closes the next morning


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _utc(moment: datetime | None) -> datetime:
    """Accept a naive datetime as UTC so a test clock cannot silently drift."""
    current = moment or now_utc()
    return current if current.tzinfo else current.replace(tzinfo=timezone.utc)


def in_offpeak(now: datetime | None = None) -> bool:
    """True when `now` is inside the discount window (16:00-00:00 UTC, 19:30-03:30 Tehran)."""
    local = _utc(now).astimezone(TEHRAN).time()
    return local >= OFFPEAK_START or local < OFFPEAK_END


def should_defer(now: datetime | None = None) -> bool:
    """True when a batch job should wait: the discount window is not open yet."""
    return not in_offpeak(now)


def next_offpeak(now: datetime | None = None) -> datetime:
    """The next opening of the window (19:30 Tehran = 16:00 UTC), returned in UTC."""
    local = _utc(now).astimezone(TEHRAN)
    start = local.replace(hour=OFFPEAK_START.hour, minute=OFFPEAK_START.minute, second=0, microsecond=0)
    if local.time() >= OFFPEAK_START:
        start += timedelta(days=1)
    return start.astimezone(timezone.utc)


def cache_path() -> pathlib.Path:
    """Where cached answers live; ROXIRA_LLM_CACHE overrides it (tests use a temp file)."""
    override = os.environ.get("ROXIRA_LLM_CACHE")
    return pathlib.Path(override) if override else pathlib.Path.home() / ".roxira" / "llm_cache.json"


def cache_key(prompt: str) -> str:
    """Stable key for a prompt: identical text maps to the same answer."""
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()


def _read(cache: pathlib.Path | str | None) -> dict[str, str]:
    path = pathlib.Path(cache) if cache else cache_path()
    try:
        data: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items()}


def cache_get(key: str, cache: pathlib.Path | str | None = None) -> str | None:
    """The cached answer for `key`, or None. An unknown/unreadable file is a miss, never an error."""
    return _read(cache).get(key)


def cache_put(key: str, answer: str, cache: pathlib.Path | str | None = None) -> None:
    """Store `answer` under `key`. Caching must never break a call, so write errors are swallowed."""
    path = pathlib.Path(cache) if cache else cache_path()
    data = _read(path)
    data[key] = answer
    try:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass
