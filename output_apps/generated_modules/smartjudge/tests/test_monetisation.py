"""Free tier never reaches a paid model; daily limits nudge to /plans. Offline, fakes only."""

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.generated_modules.smartjudge import chat_auth, chat_fast, llm_gateway, plan_limits
from output_apps.generated_modules.smartjudge import smartjudge_module as mod

URL = "/api/v1/apps/judge/chat"
ENVS = ("SMARTJUDGE_LLM_GATEWAY_MODEL", "SMARTJUDGE_LLM_GATEWAY_MODEL_FREE",
        "SMARTJUDGE_LLM_GATEWAY_MODEL_VIP", "SMARTJUDGE_FREE_PAID_FALLBACK",
        "CHAT_ANON_DAILY_LIMIT", "CHAT_FREE_DAILY_LIMIT", "CHAT_VIP_DAILY_LIMIT")


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for name in ENVS:
        monkeypatch.delenv(name, raising=False)
    chat_auth.reset_for_tests()


# --- A: model_for ------------------------------------------------------------
def test_model_for_defaults():
    assert llm_gateway.model_for("VIP") == "vip-product"
    assert llm_gateway.model_for("FREE") == "best-product-free"
    assert llm_gateway.model_for(None) == "best-product-free"


def test_model_for_env_per_tier(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_LLM_GATEWAY_MODEL_VIP", "v")
    monkeypatch.setenv("SMARTJUDGE_LLM_GATEWAY_MODEL_FREE", "f")
    assert (llm_gateway.model_for("VIP"), llm_gateway.model_for("FREE")) == ("v", "f")


def test_model_for_legacy_env_serves_both(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_LLM_GATEWAY_MODEL", "legacy")
    assert llm_gateway.model_for("VIP") == "legacy" == llm_gateway.model_for("FREE")
    monkeypatch.setenv("SMARTJUDGE_LLM_GATEWAY_MODEL_VIP", "v")
    assert llm_gateway.model_for("VIP") == "v"


# --- B: free never reaches the direct paid path ------------------------------
def _stub_stream(monkeypatch, gateway_text):
    seen = {"gateway_models": [], "direct": 0, "calls": 0}

    async def fake_stream(plan, opener, on_delta, total_timeout=None):
        seen["calls"] += 1
        if seen["calls"] == 1:  # the gateway attempt always comes first
            seen["gateway_models"].append(plan[0][0])
            if gateway_text:
                return chat_fast.StreamOutcome(text=gateway_text, model="gw")
            return chat_fast.StreamOutcome()
        seen["direct"] += 1
        return chat_fast.StreamOutcome(text="paid answer", model="paid")

    monkeypatch.setattr(mod, "_gateway_ready", lambda: True)
    monkeypatch.setattr(mod._chat_fast, "stream_with_fallback", fake_stream)
    monkeypatch.setattr(mod, "_llm_api_keys", lambda: [("k", "not-a-real-key")])
    return seen


def _answer(tier):
    return asyncio.run(mod._llm_stream_answer([{"role": "user", "content": "q"}], tier, False, 100, 0.3))


def test_free_gateway_failure_never_calls_paid(monkeypatch):
    seen = _stub_stream(monkeypatch, "")
    outcome, kind = _answer("FREE")
    assert not outcome.text and kind == "free_no_paid"
    assert seen["direct"] == 0 and seen["gateway_models"] == ["best-product-free"]


def test_vip_gateway_failure_still_uses_paid(monkeypatch):
    seen = _stub_stream(monkeypatch, "")
    outcome, _ = _answer("VIP")
    assert outcome.text == "paid answer" and seen["direct"] == 1
    assert seen["gateway_models"] == ["vip-product"]


def test_kill_switch_restores_old_free_behaviour(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_FREE_PAID_FALLBACK", "1")
    seen = _stub_stream(monkeypatch, "")
    outcome, _ = _answer("FREE")
    assert outcome.text == "paid answer" and seen["direct"] == 1


def test_free_gateway_success_is_served(monkeypatch):
    _stub_stream(monkeypatch, "free answer")
    outcome, kind = _answer("FREE")
    assert outcome.text == "free answer" and kind == "ok"


# --- B/C end to end through /chat -------------------------------------------
class _Boom:
    def __init__(self, *a, **k):
        raise RuntimeError("no db")


def _client(monkeypatch, answer_text):
    async def fake_kg(query, limit=5, meta_out=None):
        return mod._fallback_knowledge_graph(limit)

    async def fake_guard(text, *, use_qdrant=True):
        return {"validated_articles": []}

    async def fake_stream_answer(messages, tier, is_voice, max_tokens, temperature, on_delta=None, gateway_plan=None):
        if answer_text:
            return chat_fast.StreamOutcome(text=answer_text, model="fake"), "ok"
        return chat_fast.StreamOutcome(), "free_no_paid"

    monkeypatch.setattr(mod, "aquery_knowledge_graph", fake_kg)
    monkeypatch.setattr(mod, "_guard_citations", fake_guard)
    monkeypatch.setattr(mod, "_use_llm_router", lambda: False)
    monkeypatch.setattr(mod, "_gateway_ready", lambda: True)
    monkeypatch.setattr(mod, "_llm_stream_answer", fake_stream_answer)
    monkeypatch.setattr(mod.psycopg, "connect", _Boom)
    app = FastAPI()
    app.include_router(mod.router)
    return TestClient(app)


def test_free_user_gets_friendly_upsell_not_503(monkeypatch):
    c = _client(monkeypatch, "")
    r = c.post(URL, json={"message": "مهلت اعتراض به رأی چقدر است؟"})
    assert r.status_code == 200
    body = r.json()
    assert body["upsell"] is True and body["plans_url"] == "/plans" and body["status"] == "SUCCESS"
    assert "اشتراک" in body["reply"]


def test_guest_daily_limit_counts_only_real_answers(monkeypatch):
    monkeypatch.setenv("CHAT_ANON_DAILY_LIMIT", "2")
    c = _client(monkeypatch, "پاسخ حقوقی")
    for _ in range(3):  # greetings are fast-path replies and never count
        assert c.post(URL, json={"message": "سلام"}).status_code == 200
    assert c.post(URL, json={"message": "مهلت اعتراض به رأی چقدر است؟"}).status_code == 200
    assert c.post(URL, json={"message": "مهلت تجدیدنظر چقدر است؟"}).status_code == 200
    r = c.post(URL, json={"message": "مهلت واخواهی چقدر است؟"})
    assert r.status_code == 429
    body = r.json()
    assert body["code"] == "LOGIN_OR_UPGRADE" and body["plans_url"] == "/plans" and body["retry_after"] > 0


def test_failed_answers_do_not_use_up_daily_quota(monkeypatch):
    monkeypatch.setenv("CHAT_ANON_DAILY_LIMIT", "1")
    c = _client(monkeypatch, "")
    for _ in range(3):
        assert c.post(URL, json={"message": "مهلت اعتراض به رأی چقدر است؟"}).status_code == 200


# --- C: per-tier counters -----------------------------------------------------
@pytest.mark.parametrize("user,kind,limit", [
    (chat_auth.CurrentUser(), "guest", 5),
    (chat_auth.CurrentUser(phone="0912", tier="FREE", authenticated=True), "free", 20),
    (chat_auth.CurrentUser(phone="0912", tier="VIP", authenticated=True), "vip", 300),
])
def test_daily_counter_per_tier(user, kind, limit):
    key, lim, k = chat_auth.daily_chat_key(user, "1.2.3.4")
    assert (lim, k) == (limit, kind)
    results = [chat_auth.count_daily_chat(key, 3)[0] for _ in range(4)]
    assert results == [True, True, True, False]


def test_daily_response_codes():
    r = chat_auth.daily_limit_response("free", 100)
    assert r.status_code == 429 and b"UPGRADE_REQUIRED" in r.body and b"/plans" in r.body
    assert b"LOGIN_OR_UPGRADE" in chat_auth.daily_limit_response("guest", 100).body
    assert b"upsell" not in chat_auth.daily_limit_response("vip", 100).body


def test_plan_limits_expose_daily_chat_limits(monkeypatch):
    monkeypatch.setenv("CHAT_FREE_DAILY_LIMIT", "7")
    day = plan_limits.get_plan_limits()["chat_messages_per_day"]
    assert day == {"guest": 5, "free": 7, "vip": 300, "basic": 40, "pro": 60, "premium": 120}
