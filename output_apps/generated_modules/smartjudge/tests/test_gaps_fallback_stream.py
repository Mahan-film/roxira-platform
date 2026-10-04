"""Offline tests: FALLBACK rows hidden, dowry canned reply, stream protections."""
import asyncio

from output_apps.generated_modules.smartjudge import chat_safety as cs
from output_apps.generated_modules.smartjudge import smartjudge_module as m


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _consult(monkeypatch, text, rows):
    async def fake_q(*a, **k):
        return rows

    def no_db(*a, **k):
        raise RuntimeError("no db")

    monkeypatch.setattr(m, "aquery_knowledge_graph", fake_q)
    monkeypatch.setattr(m, "OPENROUTER_API_KEY", "")
    monkeypatch.setattr(m, "_use_llm_router", lambda: False)
    monkeypatch.setattr(m.psycopg, "connect", no_db)
    return _run(m.interactive_consult({"message": text, "user_phone": "09120000000"}))


def test_fallback_rows_hidden_and_dowry_ok(monkeypatch):
    out = _consult(monkeypatch, "مهریه ۱۴ سکه", m._fallback_knowledge_graph())
    assert out["statutory_basis"] == []
    assert out["unified_precedents"] == []
    assert out["reply"]


def test_canned_legal_reply_has_notice(monkeypatch):
    out = _consult(monkeypatch, "درباره قرارداد اجاره سوال دارم", m._fallback_knowledge_graph())
    assert cs.GENERAL_KNOWLEDGE_NOTICE in out["reply"]
    assert "1082" not in out["reply"]


def test_stream_digits_notice_disclaimer(monkeypatch):
    async def fake_stream(model, messages, usage_out=None):
        yield "ماده ۱۲"
        yield "۳"

    monkeypatch.setattr(m, "_openrouter_stream", fake_stream)
    monkeypatch.setattr(m, "_resolve_subscription_tier", lambda **k: "VIP")
    monkeypatch.setattr(m, "_is_vip_tier", lambda t: True)

    async def go():
        resp = await m.chat_stream(None, {"messages": [{"role": "user", "content": "x"}]})
        return [c async for c in resp.body_iterator]

    frames = "".join(_run(go()))
    assert "۱" not in frames and "۳" not in frames
    assert "event: notice" in frames and cs.CHAT_DISCLAIMER in frames
    assert frames.index("event: notice") < frames.index("event: done")
