"""Multi-key discovery and per-key cooldown for the voice and embedding providers (leaf module).

The owner holds 3-4 keys per provider (docs/STRATEGY.md, PR #834) and wants every one of them
used, as fallback and concurrently. This module only answers two questions:

  * which key slots are set? ``env_slots("GROQ_API_KEY")`` reads ``GROQ_API_KEY`` then
    ``GROQ_API_KEY_2`` .. ``_4`` (and an optional comma-separated list env), skipping unset ones;
  * which slot should go next? ``COOLDOWNS`` remembers a 429 / 5xx / auth failure per slot for a
    short while, so the next request starts on a healthy key instead of re-hitting a busy one.

A slot is identified by its env var NAME (``"GROQ_API_KEY_2"``, ``"ASSEMBLYAI_API_KEYS[1]"``),
never by its value: cooldown tables, logs and health reports only ever carry names. Every slot is
optional and inert when unset.

Pure stdlib, no imports from the rest of the package (no circular imports).
"""
from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

MAX_SLOTS = 4

# Seconds a slot sits out after a failure. Auth errors mean a revoked/expired key: sit out longer.
COOLDOWN_RATE_LIMIT_S = 60.0
COOLDOWN_SERVER_ERROR_S = 30.0
COOLDOWN_AUTH_S = 600.0
COOLDOWN_NETWORK_S = 15.0
MAX_RETRY_AFTER_S = 900.0


@dataclass(frozen=True)
class KeySlot:
    name: str  # env var name (or "LIST_ENV[i]"); safe to log
    value: str  # the secret; never log, never repr

    def __repr__(self) -> str:  # dataclass repr would print the key
        return f"KeySlot({self.name!r})"


def env_slots(
    base: str,
    *,
    max_slots: int = MAX_SLOTS,
    list_env: str = "",
    env: Optional[Mapping[str, str]] = None,
) -> List[KeySlot]:
    """Set key slots for ``base``: ``base``, ``base_2`` .. ``base_<max_slots>``, then ``list_env``.

    Duplicated values (the same key pasted into two slots) are kept once, under the first name.
    """
    source = os.environ if env is None else env
    out: List[KeySlot] = []
    seen: set = set()

    def add(name: str, value: str) -> None:
        value = (value or "").strip()
        if value and value not in seen:
            seen.add(value)
            out.append(KeySlot(name, value))

    for index in range(1, max_slots + 1):
        name = base if index == 1 else f"{base}_{index}"
        add(name, source.get(name, ""))
    if list_env:
        for index, value in enumerate((source.get(list_env, "") or "").split(","), start=1):
            add(f"{list_env}[{index}]", value)
    return out


def merge_slots(*groups: Iterable[KeySlot]) -> List[KeySlot]:
    """Concatenate slot lists, keeping the first slot for a repeated value."""
    out: List[KeySlot] = []
    seen: set = set()
    for group in groups:
        for slot in group:
            if slot.value and slot.value not in seen:
                seen.add(slot.value)
                out.append(slot)
    return out


def cooldown_for_status(status: int, retry_after: Optional[str] = None) -> float:
    """Cooldown seconds for an HTTP status; 0 means the key itself is fine (e.g. 400, 422)."""
    if status == 429:
        try:
            hinted = float(retry_after) if retry_after else 0.0
        except ValueError:
            hinted = 0.0
        return min(max(hinted, COOLDOWN_RATE_LIMIT_S), MAX_RETRY_AFTER_S)
    if status in (401, 402, 403):
        return COOLDOWN_AUTH_S
    if status >= 500:
        return COOLDOWN_SERVER_ERROR_S
    return 0.0


class Cooldowns:
    """Thread-safe ``(provider, slot name) -> cooled-until`` table (monotonic clock)."""

    def __init__(self) -> None:
        self._until: Dict[Tuple[str, str], float] = {}
        self._reason: Dict[Tuple[str, str], str] = {}
        self._lock = threading.Lock()

    def cooling(self, provider: str, slot: str, now: Optional[float] = None) -> bool:
        t = time.monotonic() if now is None else now
        with self._lock:
            return self._until.get((provider, slot), 0.0) > t

    def fail(self, provider: str, slot: str, seconds: float, reason: str = "", now: Optional[float] = None) -> None:
        if seconds <= 0:
            return
        t = time.monotonic() if now is None else now
        with self._lock:
            key = (provider, slot)
            self._until[key] = max(self._until.get(key, 0.0), t + seconds)
            self._reason[key] = reason

    def ok(self, provider: str, slot: str) -> None:
        with self._lock:
            self._until.pop((provider, slot), None)
            self._reason.pop((provider, slot), None)

    def order(self, provider: str, slots: Sequence[KeySlot], now: Optional[float] = None) -> List[KeySlot]:
        """Healthy slots first (original order), cooling ones last: a last resort, never dropped."""
        healthy = [s for s in slots if not self.cooling(provider, s.name, now)]
        cooling = [s for s in slots if self.cooling(provider, s.name, now)]
        return healthy + cooling

    def snapshot(self, now: Optional[float] = None) -> List[Dict[str, object]]:
        """Slots currently cooling, for health endpoints. Names and reasons only, no values."""
        t = time.monotonic() if now is None else now
        with self._lock:
            rows = [
                {"provider": p, "slot": s, "seconds_left": round(until - t, 1), "reason": self._reason.get((p, s), "")}
                for (p, s), until in self._until.items()
                if until > t
            ]
        return sorted(rows, key=lambda r: (str(r["provider"]), str(r["slot"])))

    def reset(self) -> None:
        with self._lock:
            self._until.clear()
            self._reason.clear()


COOLDOWNS = Cooldowns()
