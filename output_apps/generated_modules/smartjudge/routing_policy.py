"""Cost-saving routing policy (issue #288; docs/strategy/PRODUCT_DECISIONS_2026-11.md section 5).

Pure helpers, no network and no secrets. Numbers come from ``routing:`` in config/models.yaml.

    key = cache_key("recon_classify", messages)        # exact cache on the normalised request
    cache.get(key) / cache.put(key, text)
    escalate(confidence)                               # True -> try the next, stronger tier
    for batch in micro_batches(lines): ...             # 25-50 bank lines per call
    is_offpeak(now) / next_offpeak(now)                # DeepSeek 50% window, ~20:00 Tehran
    budget.charge(tenant, task, tokens)                # raises BudgetExceeded
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from collections import OrderedDict
from datetime import datetime, time as dtime, timedelta, timezone
from typing import Any, Iterable, Iterator, Sequence

try:
    from . import model_registry
except ImportError:  # imported as a top-level module (scripts put the package dir on sys.path)
    import model_registry  # type: ignore[no-redef]


def settings(path=None) -> dict[str, Any]:
    data = model_registry.load(path) if path is None else model_registry._load_uncached(path)
    return data.get("routing") or {}


# ---- cache -------------------------------------------------------------------------------------

_WS = re.compile(r"\s+")


def normalise(text: str) -> str:
    """Collapse whitespace and unify Arabic/Persian letter variants and digits so equal requests share a key."""
    t = text.replace("ي", "ی").replace("ك", "ک")
    t = t.translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789"))
    t = t.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    return _WS.sub(" ", t).strip()


def cache_key(task: str, messages: Sequence[dict[str, str]], tenant: str = "") -> str:
    """Stable key. The tenant is part of the key so one tenant's answer is never served to another."""
    payload = json.dumps([task, tenant, [(m.get("role", ""), normalise(str(m.get("content", "")))) for m in messages]],
                         ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class ResponseCache:
    def __init__(self, ttl_hours: float | None = None, max_entries: int | None = None, clock=time.time):
        cfg = settings().get("cache") or {}
        self.ttl = 3600.0 * float(ttl_hours if ttl_hours is not None else cfg.get("ttl_hours", 24))
        self.max = int(max_entries if max_entries is not None else cfg.get("max_entries", 5000))
        self._clock = clock
        self._data: OrderedDict[str, tuple[float, str]] = OrderedDict()

    def get(self, key: str) -> str | None:
        item = self._data.get(key)
        if item is None:
            return None
        if self._clock() - item[0] > self.ttl:
            del self._data[key]
            return None
        self._data.move_to_end(key)
        return item[1]

    def put(self, key: str, text: str) -> None:
        if not text.strip():
            return  # never cache an empty answer
        self._data[key] = (self._clock(), text)
        self._data.move_to_end(key)
        while len(self._data) > self.max:
            self._data.popitem(last=False)


# ---- escalation, batching ----------------------------------------------------------------------

def escalate(confidence: float | None) -> bool:
    """True when the answer is not trusted enough: missing confidence also escalates (fail safe)."""
    threshold = float(settings().get("escalate_below_confidence", 0.80))
    return confidence is None or confidence < threshold


def micro_batches(items: Sequence[Any], size: int | None = None) -> Iterator[list[Any]]:
    """Chunks of 25-50 items (config ``batch_lines``). The last chunk is merged into the previous one if it
    would be smaller than the minimum, so no call carries a handful of lines."""
    cfg = settings().get("batch_lines") or {}
    lo, hi = int(cfg.get("min", 25)), int(cfg.get("max", 50))
    n = max(lo, min(hi, size or hi))
    chunks = [list(items[i:i + n]) for i in range(0, len(items), n)]
    if len(chunks) > 1 and len(chunks[-1]) < lo and len(chunks[-2]) + len(chunks[-1]) <= hi:
        chunks[-2].extend(chunks.pop())
    yield from chunks


# ---- off-peak window ---------------------------------------------------------------------------

def _hm(value: str) -> dtime:
    h, m = value.split(":")
    return dtime(int(h), int(m))


def is_offpeak(now: datetime | None = None) -> bool:
    cfg = settings().get("offpeak_utc") or {"start": "16:00", "end": "00:00"}
    t = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).time()
    start, end = _hm(cfg["start"]), _hm(cfg["end"])
    return start <= t < end if start < end else (t >= start or t < end)


def next_offpeak(now: datetime | None = None) -> datetime:
    """Start of the next off-peak window (now, if already inside one)."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if is_offpeak(now):
        return now
    start = _hm((settings().get("offpeak_utc") or {"start": "16:00"})["start"])
    cand = now.replace(hour=start.hour, minute=start.minute, second=0, microsecond=0)
    return cand if cand > now else cand + timedelta(days=1)


def should_defer(task: str, now: datetime | None = None) -> bool:
    """Batch tasks wait for the discount window; interactive tasks never do."""
    return task in (settings().get("offpeak_tasks") or []) and not is_offpeak(now)


# ---- token budgets -----------------------------------------------------------------------------

class BudgetExceeded(RuntimeError):
    pass


class TokenBudget:
    """Per-tenant and per-task token counters for one UTC day (in memory; the caller persists if needed)."""

    def __init__(self, clock=time.time):
        self._clock = clock
        self._day = ""
        self._tenant: dict[str, int] = {}
        self._task: dict[str, int] = {}

    def _roll(self) -> None:
        day = datetime.fromtimestamp(self._clock(), timezone.utc).strftime("%Y-%m-%d")
        if day != self._day:
            self._day, self._tenant, self._task = day, {}, {}

    def charge(self, tenant: str, task: str, tokens: int) -> None:
        cfg = settings().get("token_budgets") or {}
        self._roll()
        t_cap = cfg.get("tenant_daily")
        k_cap = (cfg.get("task_daily") or {}).get(task)
        if t_cap is not None and self._tenant.get(tenant, 0) + tokens > int(t_cap):
            raise BudgetExceeded(f"tenant {tenant!r} daily token budget {t_cap} reached")
        if k_cap is not None and self._task.get(task, 0) + tokens > int(k_cap):
            raise BudgetExceeded(f"task {task!r} daily token budget {k_cap} reached")
        self._tenant[tenant] = self._tenant.get(tenant, 0) + tokens
        self._task[task] = self._task.get(task, 0) + tokens
