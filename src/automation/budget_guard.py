"""OpenRouter spend guard for W9 research CLI runs (live-run readiness).

Owner requirement: a live `tech_radar`/`project-brief` run must never blow
through its budget. This reads OpenRouter's account-level usage via
``GET /api/v1/key`` before a run starts and again before every subsequent
paid step, so a run aborts *before* the next completion call would push
spend past ``--max-usd`` — not only after the money is already gone.

``GET /api/v1/key`` returns account metadata (current usage, limit), not a
completion, so calling it costs nothing.

``snapshot_fn`` is injectable specifically so unit tests / offline runs never
make a real HTTP call (see src/automation/test_tech_radar_live_ready.py).
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field

import httpx

from src.automation.provider_base import get_env_var

logger = logging.getLogger("roxira.tech_radar.budget_guard")

OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key"


class BudgetGuardError(RuntimeError):
    """Usage could not be verified. Callers of a live run should treat this
    as fatal when --max-usd was explicitly requested: an unverifiable cap
    is not a satisfied cap."""


class BudgetExceeded(BudgetGuardError):
    def __init__(self, spent_usd: float, cap_usd: float, context: str) -> None:
        self.spent_usd = spent_usd
        self.cap_usd = cap_usd
        self.context = context
        super().__init__(
            f"OpenRouter spend ${spent_usd:.4f} would exceed --max-usd ${cap_usd:.4f} "
            f"(checked {context}); aborting before the next paid call."
        )


def fetch_openrouter_usage(timeout: float = 15.0) -> float:
    """Return the account's total OpenRouter usage in USD via GET /api/v1/key."""
    api_key = get_env_var("OPENROUTER_API_KEY")
    if not api_key:
        raise BudgetGuardError(
            "OPENROUTER_API_KEY is not set; cannot verify OpenRouter spend for --max-usd"
        )
    try:
        response = httpx.get(
            OPENROUTER_KEY_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:  # network/HTTP/parse boundary
        raise BudgetGuardError(f"could not read OpenRouter usage: {exc}") from exc

    data = payload.get("data") if isinstance(payload, dict) else None
    data = data if isinstance(data, dict) else payload
    usage = data.get("usage") if isinstance(data, dict) else None
    if usage is None:
        raise BudgetGuardError(
            f"OpenRouter GET /api/v1/key response had no 'usage' field: {payload!r}"
        )
    try:
        return float(usage)
    except (TypeError, ValueError) as exc:
        raise BudgetGuardError(f"OpenRouter usage value was not numeric: {usage!r}") from exc


@dataclass
class BudgetGuard:
    """Aborts a run before OpenRouter spend exceeds ``max_usd``.

    Usage:
        guard = BudgetGuard(max_usd=1.5)
        guard.start()                      # records the baseline usage
        ...
        guard.check("before final synthesis")   # raises BudgetExceeded past cap
    """

    max_usd: float | None
    snapshot_fn: Callable[[], float] = field(default=fetch_openrouter_usage)
    _baseline_usd: float | None = field(default=None, init=False, repr=False)

    @property
    def enabled(self) -> bool:
        return self.max_usd is not None

    def start(self) -> None:
        """Record the usage baseline. Raises BudgetGuardError if usage can't
        be read — a live run with an explicit --max-usd should not proceed
        unmetered."""
        if not self.enabled:
            return
        self._baseline_usd = self.snapshot_fn()
        logger.info(
            "budget guard armed: cap=$%.4f baseline_usage=$%.4f",
            self.max_usd,
            self._baseline_usd,
        )

    def check(self, context: str) -> None:
        """Call this before each paid step. Raises BudgetExceeded once the
        delta since start() would exceed max_usd."""
        if not self.enabled:
            return
        if self._baseline_usd is None:
            # start() was never called (caller misuse) — fail closed rather
            # than silently run unmetered.
            self.start()
        current = self.snapshot_fn()
        spent = current - (self._baseline_usd or 0.0)
        if spent > self.max_usd:  # type: ignore[operator]
            raise BudgetExceeded(spent, self.max_usd, context)  # type: ignore[arg-type]

    def spent_so_far(self) -> float | None:
        """Best-effort current spend since start(); None if disabled, not
        started, or usage can't currently be read."""
        if not self.enabled or self._baseline_usd is None:
            return None
        try:
            return self.snapshot_fn() - self._baseline_usd
        except BudgetGuardError:
            return None
