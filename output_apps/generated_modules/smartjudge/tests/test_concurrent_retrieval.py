"""Verify independent retrieval stages run concurrently in _consult_core."""
from __future__ import annotations

import asyncio

from output_apps.generated_modules.smartjudge import chat_fast as cf
from output_apps.generated_modules.smartjudge import smartjudge_module as sm


def test_independent_retrieval_stages_run_concurrently(monkeypatch):
    started: list[str] = []
    both_running = asyncio.Event()

    async def fake_kg(q, limit=3, meta_out=None):
        started.append("kg")
        if "cat" in started:
            both_running.set()
        await asyncio.wait_for(both_running.wait(), timeout=0.5)
        return [{"title": "ماده ۱", "summary": "s", "match_level": "EXACT"}], []

    async def fake_latest_rulings(limit=5, sub_collection="unity_rulings"):
        started.append("cat")
        if "kg" in started:
            both_running.set()
        await asyncio.wait_for(both_running.wait(), timeout=0.5)
        return [{"title": "رأی ۸۰۰", "summary": "خلاصه"}]

    async def fake_llm(messages, tier, is_voice, max_tokens, temperature, on_delta=None, **kw):
        return cf.StreamOutcome(text="پاسخ", model="m"), "ok"

    monkeypatch.setattr(sm, "aquery_knowledge_graph", fake_kg)
    monkeypatch.setattr(sm._rulings, "latest_rulings", fake_latest_rulings)
    monkeypatch.setattr(sm._catalog_intent, "detect", lambda _t: {"target": "unity_supreme_court", "is_number_ask": False})
    monkeypatch.setattr(sm, "_llm_stream_answer", fake_llm)
    monkeypatch.setattr(sm, "OPENROUTER_API_KEY", "test-key-not-real")

    res = asyncio.run(sm._consult_core({"message": "آخرین رأی وحدت رویه"}, None, sm.chat_auth.ANONYMOUS))
    assert both_running.is_set()
    assert res["status"] == "SUCCESS"
