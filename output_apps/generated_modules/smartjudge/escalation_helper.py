"""Opt-in wrapper around llm_router.complete with quality-gated escalation.

Disabled unless SMARTJUDGE_ESCALATION=1; when disabled it is a plain
llm_router.complete call on the first tier, so existing behaviour is unchanged.
llm_router.py and the endpoints are not modified. See docs/ops/ESCALATION.md.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any

from src.ops_fallback.escalation import arun_with_escalation


def escalation_enabled() -> bool:
    return os.environ.get("SMARTJUDGE_ESCALATION") == "1"


async def complete_with_escalation(
    tiers: list[str],
    messages: list[dict[str, Any]],
    gate: Callable[[str], tuple[bool, list[str]]],
    *,
    sensitive: bool,
    max_cost_usd: float,
    complete: Callable[..., Any] | None = None,
    **kwargs: Any,
) -> Any:
    """Flag off: the LLMResult of one plain call on tiers[0].
    Flag on: the engine dict ({result, tier_used, attempts, est_usd, ok, stopped}).
    """
    if complete is None:
        from output_apps.generated_modules.smartjudge import llm_router

        complete = llm_router.complete
    if not escalation_enabled():
        return await complete(tiers[0], messages, sensitive=sensitive, **kwargs)

    async def _call(tier: str, _ids: list[str]) -> Any:
        return await complete(tier, messages, sensitive=sensitive, **kwargs)

    return await arun_with_escalation(
        tiers,
        _call,
        lambda r: gate(getattr(r, "content", "") or ""),
        max_cost_usd=max_cost_usd,
        sensitive=sensitive,
        cost_of=lambda r, _t: getattr(r, "cost_usd", None),
    )
