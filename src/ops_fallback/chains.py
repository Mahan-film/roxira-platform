"""Pure, injectable fallback engine. Stdlib only, no I/O, no import side effects.

The attempts trail holds step names and status codes only; never keys, URLs or
request bodies.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

RETRYABLE_STATUS = frozenset({401, 402, 403, 408, 429, 432, 500, 502, 503, 504})


class StepFailure(Exception):
    """Raised by a `call` to report a failed step with an optional status code."""

    def __init__(self, status: int | None = None, label: str = "error") -> None:
        super().__init__(label)
        self.status = status
        self.label = label


class AllStepsFailed(Exception):
    def __init__(self, attempts: list[dict[str, Any]]) -> None:
        super().__init__("all fallback steps failed")
        self.attempts = attempts


def default_is_retryable(status: int | None) -> bool:
    """None (timeout / network error / unknown) and listed codes are retryable."""
    return status is None or status in RETRYABLE_STATUS


@dataclass
class Cooldown:
    """In-memory circuit breaker: `threshold` consecutive failures open a step
    for `seconds`. Clock is injectable for tests."""

    threshold: int = 3
    seconds: float = 60.0
    clock: Callable[[], float] = time.monotonic
    _fails: dict[str, int] = field(default_factory=dict)
    _open_until: dict[str, float] = field(default_factory=dict)

    def is_open(self, name: str) -> bool:
        until = self._open_until.get(name)
        if until is None:
            return False
        if self.clock() >= until:
            del self._open_until[name]
            self._fails[name] = 0
            return False
        return True

    def record_failure(self, name: str) -> None:
        n = self._fails.get(name, 0) + 1
        self._fails[name] = n
        if n >= self.threshold:
            self._open_until[name] = self.clock() + self.seconds

    def record_success(self, name: str) -> None:
        self._fails[name] = 0
        self._open_until.pop(name, None)


def run_with_fallback(
    steps: Sequence[str],
    call: Callable[[str], Any],
    *,
    is_retryable: Callable[[int | None], bool] = default_is_retryable,
    cooldown: Cooldown | None = None,
) -> dict[str, Any]:
    """Try `call(step)` for each step in order.

    `call` returns a result, or raises StepFailure(status). Any other exception
    is treated as status None (retryable by default). A non-retryable failure
    stops the chain. Returns {"result", "step", "attempts"}; raises
    AllStepsFailed(attempts) when nothing succeeded.
    """
    attempts: list[dict[str, Any]] = []
    for name in steps:
        if cooldown is not None and cooldown.is_open(name):
            attempts.append({"step": name, "status": "cooldown"})
            continue
        try:
            result = call(name)
        except StepFailure as exc:
            status: int | None = exc.status
        except Exception:
            status = None
        else:
            if cooldown is not None:
                cooldown.record_success(name)
            attempts.append({"step": name, "status": "ok"})
            return {"result": result, "step": name, "attempts": attempts}
        if cooldown is not None:
            cooldown.record_failure(name)
        attempts.append({"step": name, "status": status if status is not None else "error"})
        if not is_retryable(status):
            break
    raise AllStepsFailed(attempts)
