"""Offline tests for the free-first key-pool LLM gateway (AGENTS.md section 4).

SMARTJUDGE_LLM_GATEWAY off -> unchanged direct OpenRouter path; on -> the
gateway is called with SMARTJUDGE_LLM_GATEWAY_MODEL and the KEYPOOL_MASTER_KEY
header; a gateway error -> fall back to direct OpenRouter. The streaming chat
path is covered with an injected opener. No network.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from output_apps.generated_modules.smartjudge import chat_fast, llm_router
from output_apps.generated_modules.smartjudge import smartjudge_module as m

MESSAGES = [{"role": "user", "content": "سلام"}]
GATEWAY_HOST = "keypool.test"
GATEWAY_BASE = f"http://{GATEWAY_HOST}:4000/v1"
GW_KEY = "gw-master-key"
DIRECT_KEY = "direct-key"


def _ok_json(model="deepseek/deepseek-v4.1-flash", content="پاسخ"):
    return {
        "id": "gen-1",
        "model": model,
        "choices": [{"message": {"role": "assistant", "content": content}}],
        "usage": {"prompt_tokens": 3, "completion_tokens": 2, "cost": 0.0},
    }


class Script:
    """MockTransport handler: pops the next (status, json) per URL host."""

    def __init__(self, gateway=(), direct=()):
        self.gateway = list(gateway)
        self.direct = list(direct)
        self.requests = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        queue = self.gateway if GATEWAY_HOST in request.url.host else self.direct
        status, payload = queue.pop(0)
        return httpx.Response(status, json=payload)

    def gateway_requests(self):
        return [r for r in self.requests if GATEWAY_HOST in r.url.host]

    def direct_requests(self):
        return [r for r in self.requests if GATEWAY_HOST not in r.url.host]


@pytest.fixture(autouse=True)
def env(monkeypatch):
    for key in (
        "SMARTJUDGE_LLM_GATEWAY", "SMARTJUDGE_LLM_GATEWAY_MODEL", "KEYPOOL_MASTER_KEY",
        "LLM_USAGE_DSN", "LLM_USAGE_LOG_PATH", "REDIS_URL", "REDIS_HOST",
        "LLM_REASONING_CHEAP", "LLM_SENSITIVE_DENY_DATA_COLLECTION",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", DIRECT_KEY)
    monkeypatch.setenv("LLM_TIER_FREE", "a/free-1:free")
    monkeypatch.setenv("LLM_TIER_CHEAP", "c/cheap-1,d/cheap-2")
    monkeypatch.setenv("LLM_TIER_STRONG", "e/strong-1")
    monkeypatch.setenv("LLM_RETRY_BASE_DELAY", "0")
    monkeypatch.setenv("LLM_RETRY_MAX_DELAY", "0")
    monkeypatch.setattr(m, "OPENROUTER_API_KEY", DIRECT_KEY)
    llm_router.set_redis_client(None)
    yield
    llm_router.set_http_client(None)
    llm_router.set_redis_client(None)


def run(coro):
    async def wrapper():
        try:
            return await coro
        finally:
            await llm_router.flush_usage()

    return asyncio.run(wrapper())


def _use_router(script: Script) -> None:
    llm_router.set_http_client(httpx.AsyncClient(transport=httpx.MockTransport(script)))


def _install_opener(monkeypatch, calls, *, fail_gateway=False):
    def factory(api_key, messages, max_tokens, temperature, usage_out, *, gateway=False):
        async def opener(model):
            calls.append({"model": model, "gateway": gateway, "key": api_key})
            if gateway and fail_gateway:
                raise chat_fast.LLMProviderError(503, model, "gateway down")
            yield "بخش "
            yield "پاسخ"

        return opener

    monkeypatch.setattr(m, "_make_chat_opener", factory)


# ---- non-streaming router path (real HTTP through MockTransport) ------------
def test_flag_off_uses_direct_openrouter():
    script = Script(direct=[(200, _ok_json(model="c/cheap-1"))])
    _use_router(script)
    res = run(llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0.3))
    assert script.gateway_requests() == []
    [req] = script.direct_requests()
    body = json.loads(req.content)
    assert body["models"] == ["c/cheap-1", "d/cheap-2"]  # tier list, unchanged behaviour
    assert req.headers["authorization"] == f"Bearer {DIRECT_KEY}"
    assert res.content == "پاسخ" and res.model == "c/cheap-1"


def test_flag_on_calls_gateway_with_model_and_key(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_LLM_GATEWAY", GATEWAY_BASE)
    monkeypatch.setenv("KEYPOOL_MASTER_KEY", GW_KEY)
    script = Script(gateway=[(200, _ok_json(model="groq/openai-gpt-oss-120b", content="gw"))])
    _use_router(script)
    res = run(llm_router.complete("cheap", MESSAGES, sensitive=True, temperature=0.3))
    assert script.direct_requests() == []
    [req] = script.gateway_requests()
    assert req.url.path == "/v1/chat/completions"
    body = json.loads(req.content)
    assert body["model"] == "agent-strong-free"
    assert "models" not in body and "provider" not in body
    assert req.headers["authorization"] == f"Bearer {GW_KEY}"
    assert res.content == "gw"


def test_gateway_error_falls_back_to_direct(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_LLM_GATEWAY", GATEWAY_BASE)
    monkeypatch.setenv("KEYPOOL_MASTER_KEY", GW_KEY)
    script = Script(
        gateway=[(500, {"error": {"message": "gateway down"}})],
        direct=[(200, _ok_json(model="c/cheap-1", content="direct"))],
    )
    _use_router(script)
    res = run(
        llm_router.complete("cheap", MESSAGES, sensitive=False, temperature=0.3, max_retries=0)
    )
    assert len(script.gateway_requests()) == 1
    [req] = script.direct_requests()
    assert req.headers["authorization"] == f"Bearer {DIRECT_KEY}"
    assert res.content == "direct" and res.model == "c/cheap-1"


# ---- streaming chat path ----------------------------------------------------
def test_stream_flag_off_uses_direct(monkeypatch):
    calls = []
    _install_opener(monkeypatch, calls)
    outcome, kind = run(m._llm_stream_answer(MESSAGES, "FREE", False, 50, 0.2))
    assert kind == "ok" and outcome.text == "بخش پاسخ"
    assert outcome.model == m._FREE_PRIMARY
    assert calls == [{"model": m._FREE_PRIMARY, "gateway": False, "key": DIRECT_KEY}]


def test_stream_flag_on_calls_gateway_with_model_and_key(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_LLM_GATEWAY", GATEWAY_BASE)
    monkeypatch.setenv("KEYPOOL_MASTER_KEY", GW_KEY)
    calls = []
    _install_opener(monkeypatch, calls)
    outcome, kind = run(m._llm_stream_answer(MESSAGES, "FREE", False, 50, 0.2))
    assert kind == "ok" and outcome.text == "بخش پاسخ"
    assert outcome.model == "agent-strong-free"
    assert calls == [{"model": "agent-strong-free", "gateway": True, "key": GW_KEY}]


def test_stream_gateway_error_falls_back_to_direct(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_LLM_GATEWAY", GATEWAY_BASE)
    monkeypatch.setenv("KEYPOOL_MASTER_KEY", GW_KEY)
    calls = []
    _install_opener(monkeypatch, calls, fail_gateway=True)
    outcome, kind = run(m._llm_stream_answer(MESSAGES, "FREE", False, 50, 0.2))
    assert kind == "ok" and outcome.text == "بخش پاسخ"
    assert outcome.model == m._FREE_PRIMARY
    assert calls[0] == {"model": "agent-strong-free", "gateway": True, "key": GW_KEY}
    assert calls[1] == {"model": m._FREE_PRIMARY, "gateway": False, "key": DIRECT_KEY}
