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
import json
import os
from typing import Any

from src.automation.provider_base import _ENV_CACHE, _load_env_file

_ROUTER_ENV_LOADED = False

# Zero-network, zero-cost offline mode (W9 live-run readiness): set
# ROXIRA_OFFLINE_TEST=1 and every call_llm() call below returns a canned,
# schema-shaped response instead of importing llm_router / calling
# OpenRouter at all. Used by `tech_radar --offline-test` and by
# src/automation/test_tech_radar_live_ready.py to exercise the full
# search -> crawl -> rerank -> synthesize pipeline in CI with zero spend and
# no API keys required.
OFFLINE_ENV_VAR = "ROXIRA_OFFLINE_TEST"

# A superset payload covering every JSON schema used across tech_radar.py /
# project_brief.py / translate.py (daily-radar report, project-brief layer,
# project-brief final reconciliation, and repair-pass partial payloads) so an
# offline run can reach a genuine SUCCESS status end to end, not just avoid
# crashing.
_OFFLINE_JSON_PAYLOAD: dict[str, Any] = {
    "executive_summary": "این یک خلاصه آفلاین آزمایشی است (ROXIRA_OFFLINE_TEST=1).",
    "summary": "این یک خلاصه لایه‌ای آفلاین آزمایشی است.",
    "key_findings": ["یافته آفلاین نمونه ۱", "یافته آفلاین نمونه ۲"],
    "emerging_technologies": [
        {
            "name": "OfflineFixtureTech",
            "category": "test-fixture",
            "maturity": "growing",
            "description": "خروجی ثابت حالت آفلاین.",
            "why_it_matters": "برای آزمون بدون هزینه.",
            "adoption_signal": "fixture",
        }
    ],
    "top_github_repositories": [
        {
            "name": "offline/fixture-repo",
            "url": "https://github.com/offline/fixture-repo",
            "stars": "0",
            "language": "Python",
            "description": "fixture",
            "why_relevant": "fixture",
        }
    ],
    "pros_cons": [
        {
            "technology": "OfflineFixtureTech",
            "pros": ["fixture pro"],
            "cons": ["fixture con"],
            "best_for": "offline testing",
        }
    ],
    "suggested_commands": [{"purpose": "fixture install", "command": "echo offline-fixture"}],
    "risks_and_caveats": ["این خروجی از حالت آفلاین (ROXIRA_OFFLINE_TEST) تولید شده و صرفاً برای آزمون است."],
    "recommendations": ["fixture recommendation"],
    "confidence": 0.5,
    "alternatives": [
        {
            "name": "OfflineFixtureOption",
            "maturity": "growing",
            "license": "MIT",
            "adoption_score": 5,
            "risks": ["fixture risk"],
            "monthly_cost_usd_estimate": "0",
            "why": "fixture",
        }
    ],
    "recommended": "OfflineFixtureOption",
    "recommendation_reason": "fixture reason",
    "cross_layer_risks": ["fixture cross-layer risk"],
    "total_monthly_cost_usd_estimate": "0",
    "build_order": ["backend", "frontend"],
    "open_questions_for_owner": ["fixture open question"],
}


def _offline_response(prompt: str, json_mode: bool) -> dict[str, Any]:
    if json_mode:
        content = json.dumps(_OFFLINE_JSON_PAYLOAD, ensure_ascii=False)
    else:
        # translate_query() etc. just need short, deterministic, non-empty
        # text back — echo the last non-empty line of the prompt.
        lines = [line for line in prompt.strip().splitlines() if line.strip()]
        tail = lines[-1] if lines else "offline-fixture"
        content = f"[offline] {tail}"
    return {
        "status": "SUCCESS",
        "model": "offline/fixture",
        "content": content,
        "cost_usd": 0.0,
        "cached": False,
        "tier": "offline",
        "prompt_tokens": 0,
        "completion_tokens": 0,
    }


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

    When ROXIRA_OFFLINE_TEST=1 is set, this returns a canned response
    immediately: no environment loading, no OPENROUTER_API_KEY requirement,
    no import of llm_router, no network call at all.
    """
    if os.environ.get(OFFLINE_ENV_VAR) == "1":
        return _offline_response(prompt, json_mode)

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
        llm_router.set_http_client(None)
        try:
            return await llm_router.complete(
                tier,
                messages,
                sensitive=False,
                tenant="tech_radar",
                feature=feature,
                timeout=timeout,
                **params,
            )
        finally:
            client = llm_router._http_client
            llm_router.set_http_client(None)
            if client is not None:
                await client.aclose()

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
    if os.environ.get(OFFLINE_ENV_VAR) == "1":
        return
    _ensure_router_env()
    from output_apps.generated_modules.smartjudge import llm_router

    await llm_router.flush_usage()
