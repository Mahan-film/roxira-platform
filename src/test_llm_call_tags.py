"""Offline tests for the key-pool cost-attribution tags (llm_gateway.tag / call_context).

Every gateway request body carries `metadata` with roxira_answer_id / _feature / _tenant /
_plan so the key pool's cost_logger can attribute cost per answer. The direct OpenRouter
path never gets it. No network: httpx MockTransport only.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from output_apps.generated_modules.smartjudge import llm_gateway, llm_router
from output_apps.generated_modules.smartjudge import smartjudge_module as m

MESSAGES = [{"role": "user", "content": "سلام"}]
GATEWAY_HOST = "keypool.test"
GATEWAY_BASE = f"http://{GATEWAY_HOST}:4000/v1"


def _ok_json(content="پاسخ"):
    return {
        "id": "gen-1",
        "model": "groq/openai-gpt-oss-120b",
        "choices": [{"message": {"role": "assistant", "content": content}}],
        "usage": {"prompt_tokens": 3, "completion_tokens": 2},
    }


@pytest.fixture(autouse=True)
def env(monkeypatch):
    for key in (
        "SMARTJUDGE_LLM_GATEWAY", "SMARTJUDGE_LLM_GATEWAY_MODEL", "KEYPOOL_MASTER_KEY",
        "LLM_USAGE_DSN", "LLM_USAGE_LOG_PATH", "REDIS_URL", "REDIS_HOST",
        llm_gateway.ENV_CALL_TAGS,
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv(llm_gateway.ENV_CALL_TAGS, "1")  # opt-in; default is off
    monkeypatch.setenv("OPENROUTER_API_KEY", "direct-key")
    monkeypatch.setenv("LLM_TIER_CHEAP", "c/cheap-1")
    monkeypatch.setenv("LLM_RETRY_BASE_DELAY", "0")
    monkeypatch.setenv("LLM_RETRY_MAX_DELAY", "0")
    llm_router.set_redis_client(None)
    yield
    llm_router.set_http_client(None)


def _gateway_on(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_LLM_GATEWAY", GATEWAY_BASE)
    monkeypatch.setenv("KEYPOOL_MASTER_KEY", "gw-key")


def _router_bodies(responses):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.url.host, json.loads(request.content)))
        status, payload = responses.pop(0)
        return httpx.Response(status, json=payload)

    llm_router.set_http_client(httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return seen


def run(coro):
    async def wrapper():
        try:
            return await coro
        finally:
            await llm_router.flush_usage()

    return asyncio.run(wrapper())


def test_router_gateway_body_is_tagged(monkeypatch):
    _gateway_on(monkeypatch)
    seen = _router_bodies([(200, _ok_json())])
    run(llm_router.complete("cheap", MESSAGES, sensitive=True, tenant="smartjudge",
                            user="u-hash", feature="ruling_draft", plan="pro"))
    [(host, body)] = seen
    assert host == GATEWAY_HOST
    meta = body["metadata"]
    assert meta["roxira_feature"] == "ruling_draft"
    assert meta["roxira_tenant"] == "smartjudge"
    assert meta["roxira_plan"] == "pro"
    assert len(meta["roxira_answer_id"]) == 32  # a call outside an answer is its own answer
    assert "u-hash" not in json.dumps(meta)  # never the user reference


def test_router_inherits_the_answer_id_from_call_context(monkeypatch):
    _gateway_on(monkeypatch)
    seen = _router_bodies([(200, _ok_json()), (200, _ok_json())])

    async def two_calls():
        with llm_gateway.call_context(answer_id="req-42", feature="chat"):
            await llm_router.complete("cheap", MESSAGES, sensitive=True, feature="consult")
            await llm_router.complete("cheap", MESSAGES, sensitive=True)
        await llm_router.flush_usage()

    asyncio.run(two_calls())
    first, second = (body["metadata"] for _, body in seen)
    assert first["roxira_answer_id"] == second["roxira_answer_id"] == "req-42"
    assert first["roxira_feature"] == "consult"  # the explicit feature wins
    assert second["roxira_feature"] == "chat"


def test_direct_openrouter_body_is_never_tagged():
    seen = _router_bodies([(200, _ok_json())])
    with llm_gateway.call_context(answer_id="req-1", feature="chat"):
        run(llm_router.complete("cheap", MESSAGES, sensitive=False, feature="consult"))
    [(host, body)] = seen
    assert host != GATEWAY_HOST
    assert "metadata" not in body


def test_stream_opener_tags_gateway_body(monkeypatch):
    _gateway_on(monkeypatch)
    bodies = []
    sse = b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, content=sse, headers={"content-type": "text/event-stream"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(m, "_llm_http_client", lambda: client)

    async def go():
        opener = m._make_chat_opener("gw-key", MESSAGES, 50, 0.2, {}, gateway=True)
        with llm_gateway.call_context(answer_id="req-7", feature="chat"):
            with llm_gateway.call_context(plan="basic"):
                return [piece async for piece in opener("best-product-free")]

    assert asyncio.run(go()) == ["ok"]
    assert bodies[0]["metadata"] == {
        "roxira_answer_id": "req-7", "roxira_feature": "chat", "roxira_plan": "basic",
    }
    assert "usage" not in bodies[0]  # still no OpenRouter-only fields on the gateway path


def test_tags_are_sanitised_and_can_be_switched_off(monkeypatch):
    noisy = 'a b"<script>' + "x" * 100
    with llm_gateway.call_context(answer_id=noisy, feature="قرارداد", user="x"):
        tags = llm_gateway.call_tags()
    assert tags["roxira_answer_id"] == "abscriptx" + "x" * 55  # 64 chars max, ASCII id only
    assert "roxira_feature" not in tags  # nothing left after cleaning
    assert "roxira_user" not in tags  # unknown fields are ignored
    monkeypatch.setenv(llm_gateway.ENV_CALL_TAGS, "0")
    body = {"model": "g"}
    assert llm_gateway.tag(body, feature="chat") == {"model": "g"}
    monkeypatch.delenv(llm_gateway.ENV_CALL_TAGS)  # unset = off (default)
    assert llm_gateway.tag(body, feature="chat") == {"model": "g"}
