"""Sync bridge from src/automation (plain scripts) to the async product-runtime
LLM router (output_apps/generated_modules/smartjudge/llm_router.py).

docs/STRATEGY.md §3b and the W9 Phase-B brief both require that *every* LLM
call, including background research tooling, goes through the one tiered
router with OpenRouter fallbacks, Redis caching and a usage log — never a
bespoke direct client. This module is the only place in src/automation that
is allowed to import llm_router; tech_radar.py and project_brief.py call
`call_llm()` instead of talking to OpenRouter themselves.

Budget policy for research tooling (owner brief): use `free`/`cheap` tiers for
everything (query translation, per-source scoring, per-layer synthesis); the
`strong` tier is reserved for the single final project-brief synthesis call.
Research prompts never carry customer/case data, so `sensitive=False` always.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from src.automation.provider_base import _ENV_CACHE, _load_env_file

_ROUTER_ENV_LOADED = False


def _ensure_router_env() -> None:
    """llm_router reads os.environ directly; make sure a repo .env is visible.

    provider_base's get_env_var() falls back to a private cache that plain
    os.environ.get() calls (used throughout llm_router.py) never see. Copy the
    file-loaded values into the real environment once, without ever
    overwriting a value the process/host already set.
    """
    global _ROUTER_ENV_LOADED
    if _ROUTER_ENV_LOADED:
        return
    _ROUTER_ENV_LOADED = True
    _load_env_file()
    for key, value in _ENV_CACHE.items():
        os.environ.setdefault(key, value)


def call_llm(
    tier: str,
    prompt: str,
    system_prompt: str,
    *,
    temperature: float = 0.2,
    max_tokens: int = 2000,
    json_mode: bool = False,
    feature: str | None = None,
    timeout: float | None = None,
) -> dict[str, Any]:
    """Run one research-tooling completion through llm_router.complete.

    Returns a dict shaped like the old OpenAICompatibleClient.chat() result
    ({"status": "SUCCESS"/"ERROR", "content", "model", "cost_usd", ...}) so
    existing tech_radar.py parsing logic barely changes, but every call now
    goes through the tier/fallback/cache/usage-log machinery instead of a
    hardcoded model and a bare urllib POST.
    """
    _ensure_router_env()
    from output_apps.generated_modules.smartjudge import llm_router

    params: dict[str, Any] = {"temperature": temperature, "max_tokens": max_tokens}
    if json_mode:
        params["response_format"] = {"type": "json_object"}

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": prompt},
    ]

    async def _run() -> llm_router.LLMResult:
        return await llm_router.complete(
            tier,
            messages,
            sensitive=False,
            tenant="tech_radar",
            feature=feature,
            timeout=timeout,
            **params,
        )

    try:
        result = asyncio.run(_run())
    except llm_router.LLMRouterError as exc:
        return {"status": "ERROR", "error": str(exc), "tier": tier}
    except Exception as exc:  # network isolation boundary
        return {"status": "ERROR", "error": f"{type(exc).__name__}: {exc}", "tier": tier}

    if not result.content:
        return {"status": "ERROR", "error": "empty completion content", "tier": tier, "model": result.model}

    return {
        "status": "SUCCESS",
        "model": result.model,
        "content": result.content,
        "cost_usd": result.cost_usd,
        "cached": result.cached,
        "tier": tier,
        "prompt_tokens": result.prompt_tokens,
        "completion_tokens": result.completion_tokens,
    }


async def flush() -> None:
    """Wait for pending usage-log writes. Call once at the end of a CLI run."""
    _ensure_router_env()
    from output_apps.generated_modules.smartjudge import llm_router

    await llm_router.flush_usage()
