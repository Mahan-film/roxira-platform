"""Drafting ladder in llm_router: fixed paid-first order, per-model timeout, total budget,
fallback on 5xx / timeout / empty / invalid JSON. No network: OpenRouter is an httpx.MockTransport."""

import asyncio
import json

import httpx
import pytest

from output_apps.generated_modules.smartjudge import llm_router, model_registry

MESSAGES = [{"role": "user", "content": "پرونده"}]
PRO, FLASH, FREE = model_registry.role_models("drafting")


def ok_body(model, content='{"a": 1}'):
    return {
        "id": "gen-1",
        "model": model,
        "choices": [{"message": {"role": "assistant", "content": content}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.001},
    }


class Script:
    """model id -> list of behaviours: (status, body) or 'timeout' or ('sleep', seconds)."""

    def __init__(self, plan):
        self.plan = {k: list(v) for k, v in plan.items()}
        self.requests = []

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.requests.append(body)
        step = self.plan[body["model"]].pop(0)
        if step == "timeout":
            raise httpx.ReadTimeout("slow", request=request)
        if step[0] == "sleep":
            await asyncio.sleep(step[1])
            return httpx.Response(200, json=ok_body(body["model"]))
        return httpx.Response(step[0], json=step[1])


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    for key in ("LLM_TIER_DRAFTING", "LLM_DRAFTING_ALLOW_FREE_LAST", "LLM_DRAFTING_ATTEMPT_TIMEOUT",
                "LLM_DRAFTING_TOTAL_BUDGET", "SMARTJUDGE_LLM_GATEWAY", "KEYPOOL_MASTER_KEY",
                "LLM_SENSITIVE_DENY_DATA_COLLECTION", "LLM_USAGE_DSN"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setenv("LLM_USAGE_LOG_PATH", str(tmp_path / "usage.jsonl"))
    llm_router.set_redis_client(None)
    yield
    llm_router.set_http_client(None)


def use(script):
    llm_router.set_http_client(httpx.AsyncClient(transport=httpx.MockTransport(script)))
    return script


def run(coro):
    async def wrapper():
        try:
            return await coro
        finally:
            await llm_router.flush_usage()

    return asyncio.run(wrapper())


def draft(**kw):
    return llm_router.complete("drafting", MESSAGES, sensitive=True, temperature=0.2, **kw)


def test_ladder_order_comes_from_registry_and_is_paid_first():
    assert llm_router.drafting_models() == [PRO, FLASH, FREE]
    assert PRO == "deepseek/deepseek-v4-pro" and FREE.endswith(":free")


def test_first_model_answers_and_gateway_is_never_used(monkeypatch):
    # a configured free-first gateway must not be consulted for drafting
    monkeypatch.setenv("SMARTJUDGE_LLM_GATEWAY", "http://gateway.invalid/v1")
    monkeypatch.setenv("KEYPOOL_MASTER_KEY", "k")
    script = use(Script({PRO: [(200, ok_body(PRO))]}))
    result = run(draft())
    assert result.model == PRO and result.content
    assert [r["model"] for r in script.requests] == [PRO]
    assert "models" not in script.requests[0]  # one model per request: no OpenRouter-side reordering
    assert script.requests[0]["provider"] == {"data_collection": "deny"}


@pytest.mark.parametrize("failure", ["timeout", (503, {"error": {"message": "x"}}), (200, ok_body("x", ""))])
def test_failure_moves_to_next_model(failure):
    script = use(Script({PRO: [failure], FLASH: [(200, ok_body(FLASH))]}))
    result = run(draft())
    assert result.model == FLASH
    assert [r["model"] for r in script.requests] == [PRO, FLASH]


def test_invalid_json_answer_moves_to_next_model():
    script = use(Script({PRO: [(200, ok_body(PRO, "not json at all"))], FLASH: [(200, ok_body(FLASH))]}))
    result = run(draft(accept=lambda c: c.strip().startswith("{")))
    assert result.model == FLASH
    assert len(script.requests) == 2


def test_free_model_is_last_resort_without_data_collection_deny():
    script = use(
        Script({PRO: [(502, {"error": {"message": "x"}})], FLASH: ["timeout"], FREE: [(200, ok_body(FREE))]})
    )
    result = run(draft())
    assert result.model == FREE
    assert [r["model"] for r in script.requests] == [PRO, FLASH, FREE]
    assert "provider" not in script.requests[2]  # data_collection=deny would 404 on a free endpoint
    assert script.requests[0]["provider"] == {"data_collection": "deny"}


def test_free_last_resort_can_be_switched_off(monkeypatch):
    monkeypatch.setenv("LLM_DRAFTING_ALLOW_FREE_LAST", "0")
    assert llm_router.drafting_models() == [PRO, FLASH]


def test_env_override_keeps_order_and_only_allows_free_last(monkeypatch):
    monkeypatch.setenv("LLM_TIER_DRAFTING", f"{FREE},x/paid-1,y/paid-2")
    assert llm_router.drafting_models() == ["x/paid-1", "y/paid-2"]  # a free id before the end is dropped
    monkeypatch.setenv("LLM_TIER_DRAFTING", f"x/paid-1,{FREE}")
    assert llm_router.drafting_models() == ["x/paid-1", FREE]


def test_all_models_failing_raises_router_error_with_status():
    err = (503, {"error": {"message": "x"}})
    use(Script({PRO: [err], FLASH: [err], FREE: [err]}))
    with pytest.raises(llm_router.LLMRouterError) as exc:
        run(draft())
    assert exc.value.status == 503 and exc.value.tier == "drafting"


def test_per_model_timeout_is_enforced_and_falls_through():
    script = use(Script({PRO: [("sleep", 2.0)], FLASH: [(200, ok_body(FLASH))]}))
    result = run(draft(timeout=0.2))
    assert result.model == FLASH
    assert [r["model"] for r in script.requests] == [PRO, FLASH]


def test_total_budget_stops_the_ladder(monkeypatch):
    monkeypatch.setattr(llm_router, "_MIN_ATTEMPT_SECONDS", 0.0)
    script = use(Script({PRO: [("sleep", 3.0)], FLASH: [("sleep", 3.0)], FREE: [("sleep", 3.0)]}))
    with pytest.raises(llm_router.LLMRouterError):
        run(llm_router.complete_ladder(MESSAGES, sensitive=True, attempt_timeout=0.3, total_budget=0.5))
    assert len(script.requests) <= 2  # budget gone before the third model


def test_defaults_match_the_agreed_budget():
    assert llm_router.drafting_attempt_timeout() == 60.0
    assert llm_router.drafting_total_budget() == 150.0


def test_rejects_model_and_provider_params():
    for bad in ({"model": "x"}, {"models": ["x"]}, {"provider": {}}):
        with pytest.raises(ValueError):
            run(llm_router.complete_ladder(MESSAGES, sensitive=True, **bad))
