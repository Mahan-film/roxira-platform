"""Unit tests for llm_router. No network: OpenRouter is an httpx.MockTransport."""

import asyncio
import json
from datetime import UTC, datetime

import httpx
import pytest

from output_apps.generated_modules.smartjudge import llm_router

MESSAGES = [{"role": "user", "content": "ماده ۱۰ قانون مدنی"}]  # noqa: RUF001


class FakeRedis:
    def __init__(self):
        self.store = {}

    async def get(self, key):
        return self.store.get(key)

    async def set(self, key, value, ex=None):
        self.store[key] = value


def ok_body(model="deepseek/deepseek-v4.1-flash", content="پاسخ", cost=0.00012):
    return {
        "id": "gen-1",
        "model": model,
        "choices": [{"message": {"role": "assistant", "content": content}}],
        "usage": {
            "prompt_tokens": 100,
            "completion_tokens": 20,
            "cost": cost,
            "prompt_tokens_details": {"cached_tokens": 40},
        },
    }


class Upstream:
    """Scripted OpenRouter: each request pops the next (status, body, headers)."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.requests.append(body)
        status, payload, headers = self.responses.pop(0)
        return httpx.Response(status, json=payload, headers=headers or {})


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    for key in ("LLM_TIER_FREE", "LLM_TIER_CHEAP", "LLM_TIER_STRONG", "LLM_USAGE_DSN",
                "REDIS_URL", "REDIS_HOST", "LLM_ROUTER_ENABLED",
                "LLM_REASONING_CHEAP",
                "LLM_SENSITIVE_DENY_DATA_COLLECTION"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setenv("LLM_TIER_FREE", "a/free-1:free,b/free-2:free")
    monkeypatch.setenv("LLM_TIER_CHEAP", "c/cheap-1,d/cheap-2")
    monkeypatch.setenv("LLM_TIER_STRONG", "e/strong-1")
    monkeypatch.setenv("LLM_RETRY_BASE_DELAY", "0")
    monkeypatch.setenv("LLM_RETRY_MAX_DELAY", "0")
    monkeypatch.setenv("LLM_MAX_RETRIES", "2")
    monkeypatch.setenv("LLM_USAGE_LOG_PATH", str(tmp_path / "usage.jsonl"))
    llm_router.set_redis_client(None)
    yield tmp_path
    llm_router.set_http_client(None)
    llm_router.set_redis_client(None)


def use(upstream: Upstream) -> Upstream:
    llm_router.set_http_client(httpx.AsyncClient(transport=httpx.MockTransport(upstream)))
    return upstream


def run(coro):
    async def wrapper():
        try:
            return await coro
        finally:
            await llm_router.flush_usage()

    return asyncio.run(wrapper())


def usage_lines(tmp_path):
    path = tmp_path / "usage.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_sends_tier_models_as_fallback_array_and_parses_usage(env):
    up = use(Upstream((200, ok_body(model="d/cheap-2"), None)))
    res = run(llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0.3,
                                  tenant="t1", user="u1", feature="test"))
    body = up.requests[0]
    assert body["models"] == ["c/cheap-1", "d/cheap-2"]
    assert "model" not in body
    assert body["messages"] == MESSAGES
    assert body["temperature"] == 0.3
    assert "provider" not in body
    assert res.content == "پاسخ"
    assert res.model == "d/cheap-2"
    assert (res.prompt_tokens, res.completion_tokens, res.cached_tokens) == (100, 20, 40)
    assert res.cost_usd == pytest.approx(0.00012)
    [rec] = usage_lines(env)
    assert rec["tenant"] == "t1" and rec["user"] == "u1" and rec["feature"] == "test"
    assert rec["model"] == "d/cheap-2" and rec["status"] == "ok"
    assert rec["cost_usd"] == pytest.approx(0.00012)


def test_sensitive_never_routes_to_free_models(env):
    up = use(Upstream((200, ok_body(), None)))
    res = run(llm_router.complete("free", MESSAGES, sensitive=True, temperature=0.3))
    body = up.requests[0]
    assert body["models"] == ["c/cheap-1", "d/cheap-2"]
    assert not any(m.endswith(":free") for m in body["models"])
    assert body["provider"]["data_collection"] == "deny"
    assert res.tier == "cheap"


def test_sensitive_strips_free_ids_from_any_tier(env, monkeypatch):
    monkeypatch.setenv("LLM_TIER_STRONG", "x/leak:free,e/strong-1,openrouter/free")
    up = use(Upstream((200, ok_body(), None)))
    run(llm_router.complete("strong", MESSAGES, sensitive=True, temperature=0.3))
    assert up.requests[0]["models"] == ["e/strong-1"]


def test_sensitive_with_only_free_models_fails_closed(env, monkeypatch):
    monkeypatch.setenv("LLM_TIER_CHEAP", "a/only:free")
    up = use(Upstream())
    with pytest.raises(llm_router.LLMRouterError):
        run(llm_router.complete("cheap", MESSAGES, sensitive=True, temperature=0.3))
    assert up.requests == []


def test_free_tier_429_falls_through_to_cheap(env):
    up = use(Upstream(
        (429, {"error": {"code": 429, "message": "free-models-per-day"}}, None),
        (200, ok_body(model="c/cheap-1"), None),
    ))
    res = run(llm_router.complete("free", MESSAGES, sensitive=False, temperature=0.3))
    assert up.requests[0]["models"] == ["a/free-1:free", "b/free-2:free"]
    assert up.requests[1]["models"] == ["c/cheap-1", "d/cheap-2"]
    assert res.tier == "cheap" and res.model == "c/cheap-1"


def test_non_free_429_is_retried_then_raises(env):
    err = (429, {"error": {"code": 429, "message": "rate limited"}}, None)
    up = use(Upstream(err, err, err))
    with pytest.raises(llm_router.LLMRouterError) as info:
        run(llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0.3))
    assert info.value.status == 429
    assert len(up.requests) == 3
    assert usage_lines(env)[-1]["status"] == "error"


def test_5xx_is_retried_with_backoff(env):
    up = use(Upstream(
        (503, {"error": {"code": 503, "message": "down"}}, None),
        (502, {"error": {"code": 502, "message": "bad gateway"}}, None),
        (200, ok_body(), None),
    ))
    res = run(llm_router.complete("strong", MESSAGES, sensitive=True, temperature=0.3))
    assert len(up.requests) == 3
    assert res.attempts == 3


def test_transport_error_is_retried(env):
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ConnectError("boom", request=request)
        return httpx.Response(200, json=ok_body())

    llm_router.set_http_client(httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    res = run(llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0.3))
    assert calls["n"] == 2 and res.content == "پاسخ"


def test_4xx_is_not_retried(env):
    up = use(Upstream((400, {"error": {"code": 400, "message": "bad model"}}, None)))
    with pytest.raises(llm_router.LLMRouterError) as info:
        run(llm_router.complete("strong", MESSAGES, sensitive=False, temperature=0.3))
    assert info.value.status == 400
    assert len(up.requests) == 1


def test_error_inside_200_body_is_treated_as_failure(env):
    up = use(Upstream(
        (200, {"error": {"code": 502, "message": "upstream"}}, None),
        (200, ok_body(), None),
    ))
    res = run(llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0.3))
    assert len(up.requests) == 2 and res.content == "پاسخ"


def test_retry_after_header_is_honoured(monkeypatch):
    monkeypatch.setenv("LLM_RETRY_MAX_DELAY", "8")
    resp = httpx.Response(429, headers={"Retry-After": "3"})
    assert llm_router._retry_delay(0, resp) == 3.0
    resp = httpx.Response(429, headers={"Retry-After": "120"})
    assert llm_router._retry_delay(0, resp) == 8.0


def test_deterministic_calls_are_cached(env):
    redis = FakeRedis()
    llm_router.set_redis_client(redis)
    up = use(Upstream((200, ok_body(), None)))
    first = run(llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0))
    second = run(llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0))
    assert len(up.requests) == 1
    assert not first.cached and second.cached
    assert second.content == first.content and second.model == first.model
    assert second.cost_usd == 0.0
    recs = usage_lines(env)
    assert [r["cached"] for r in recs] == [False, True]
    assert len(redis.store) == 1 and next(iter(redis.store)).startswith("llm:v1:")


def test_cache_skipped_when_temperature_positive_or_missing(env):
    redis = FakeRedis()
    llm_router.set_redis_client(redis)
    up = use(Upstream(*[(200, ok_body(), None)] * 4))
    for _ in range(2):
        run(llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0.7))
    for _ in range(2):
        run(llm_router.complete("cheap", MESSAGES, sensitive=False))
    assert len(up.requests) == 4
    assert redis.store == {}


def test_cache_key_depends_on_models_messages_and_params():
    k = llm_router.cache_key(["a"], MESSAGES, {"temperature": 0})
    assert k == llm_router.cache_key(["a"], MESSAGES, {"temperature": 0})
    assert k != llm_router.cache_key(["b"], MESSAGES, {"temperature": 0})
    assert k != llm_router.cache_key(["a"], [{"role": "user", "content": "x"}], {"temperature": 0})
    assert k != llm_router.cache_key(["a"], MESSAGES, {"temperature": 0, "max_tokens": 5})


def test_redis_failure_does_not_break_the_call(env):
    class BrokenRedis:
        async def get(self, key):
            raise ConnectionError("redis down")

        async def set(self, key, value, ex=None):
            raise ConnectionError("redis down")

    llm_router.set_redis_client(BrokenRedis())
    use(Upstream((200, ok_body(), None)))
    res = run(llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0))
    assert res.content == "پاسخ"


def test_missing_api_key_raises(env, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY")
    use(Upstream())
    with pytest.raises(llm_router.LLMRouterError):
        run(llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0.3))


def test_rejects_explicit_model_and_unknown_tier(env):
    with pytest.raises(ValueError):
        run(llm_router.complete("cheap", MESSAGES, sensitive=False, model="x/y"))
    with pytest.raises(ValueError):
        run(llm_router.complete("premium", MESSAGES, sensitive=False))


def test_per_call_retry_override(env):
    err = (503, {"error": {"code": 503, "message": "down"}}, None)
    up = use(Upstream(err, err))
    with pytest.raises(llm_router.LLMRouterError):
        run(llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0.3,
                                max_retries=1, timeout=5))
    assert len(up.requests) == 2
    assert "timeout" not in up.requests[0] and "max_retries" not in up.requests[0]


def test_default_tiers_have_no_free_model_outside_free_tier(monkeypatch):
    for tier in llm_router.TIERS:
        monkeypatch.delenv(f"LLM_TIER_{tier.upper()}", raising=False)
    assert all(llm_router.is_free_model(m) for m in llm_router.tier_models("free"))
    for tier in ("cheap", "strong"):
        assert not any(llm_router.is_free_model(m) for m in llm_router.tier_models(tier))


def test_default_cheap_tier_resolves_to_deepseek_v4_1_flash(monkeypatch):
    """W24 (2026-09-28): the registry's `cheap` role -- and, through it, the
    LLM_TIER_CHEAP default -- must resolve to DeepSeek V4.1 Flash first."""
    monkeypatch.delenv("LLM_TIER_CHEAP", raising=False)
    assert llm_router.tier_models("cheap")[0] == "deepseek/deepseek-v4.1-flash"


def test_default_strong_tier_has_no_claude_sonnet(monkeypatch):
    """W24 (2026-09-28): no anthropic/claude-sonnet-5 in the product runtime."""
    monkeypatch.delenv("LLM_TIER_STRONG", raising=False)
    models = llm_router.tier_models("strong")
    assert "anthropic/claude-sonnet-5" not in models
    assert models[0] == "deepseek/deepseek-v4-pro"


def test_default_tier_models_match_registry_when_registry_readable():
    """The hardcoded _FALLBACK_TIER_MODELS constant is a last resort only;
    when config/models.yaml is readable (the normal case) DEFAULT_TIER_MODELS
    must come from the registry, not silently diverge from it."""
    from output_apps.generated_modules.smartjudge import model_registry

    for tier in llm_router.TIERS:
        assert llm_router.DEFAULT_TIER_MODELS[tier] == ",".join(model_registry.role_models(tier))


def test_flag_defaults_off(monkeypatch):
    monkeypatch.delenv("LLM_ROUTER_ENABLED", raising=False)
    assert llm_router.router_enabled() is False
    monkeypatch.setenv("LLM_ROUTER_ENABLED", "1")
    assert llm_router.router_enabled() is True


def test_daily_summary_from_jsonl(env):
    use(Upstream((200, ok_body(cost=0.001), None), (200, ok_body(cost=0.002), None)))
    run(llm_router.complete("cheap", MESSAGES, sensitive=False, tenant="t1", temperature=0.3))
    run(llm_router.complete("cheap", MESSAGES, sensitive=False, tenant="t1", temperature=0.3))
    rows = llm_router.summarize_jsonl(str(env / "usage.jsonl"), datetime.now(UTC).date())
    assert len(rows) == 1
    row = rows[0]
    assert row["tenant"] == "t1" and row["calls"] == 2
    assert row["prompt_tokens"] == 200
    assert row["cost_usd"] == pytest.approx(0.003)


def test_cheap_tier_disables_reasoning_by_default(env):
    up = use(Upstream((200, ok_body(), None)))
    run(llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0.3))
    assert up.requests[0]["reasoning"] == {"enabled": False}


def test_strong_tier_keeps_provider_reasoning_default(env):
    up = use(Upstream((200, ok_body(), None)))
    run(llm_router.complete("strong", MESSAGES, sensitive=False, temperature=0.3))
    assert "reasoning" not in up.requests[0]


def test_reasoning_env_default_omits_field_for_cheap(env, monkeypatch):
    monkeypatch.setenv("LLM_REASONING_CHEAP", "default")
    up = use(Upstream((200, ok_body(), None)))
    run(llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0.3))
    assert "reasoning" not in up.requests[0]


def test_reasoning_env_low_enables_low_effort_for_cheap(env, monkeypatch):
    monkeypatch.setenv("LLM_REASONING_CHEAP", "low")
    up = use(Upstream((200, ok_body(), None)))
    run(llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0.3))
    assert up.requests[0]["reasoning"] == {"enabled": True, "effort": "low"}


def test_rejected_reasoning_field_is_retried_without_it(env):
    up = use(Upstream(
        (400, {"error": {"code": 400, "message": "reasoning not supported"}}, None),
        (200, ok_body(), None),
    ))
    res = run(llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0.3))
    assert up.requests[0]["reasoning"] == {"enabled": False}
    assert "reasoning" not in up.requests[1]
    assert res.content == "پاسخ"
    assert res.attempts == 2
