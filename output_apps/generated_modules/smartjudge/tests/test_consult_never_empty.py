"""POST /chat with empty retrieval: general-knowledge answer. Fakes only."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.generated_modules.smartjudge import chat_safety as cs
from output_apps.generated_modules.smartjudge import smartjudge_module as mod

URL = "/api/v1/apps/judge/chat"


class _Boom:
    def __init__(self, *a, **k):
        raise RuntimeError("no db")


@pytest.fixture
def client(monkeypatch):
    seen = {}

    class Routed:
        content = "طبق ماده ۱۲۳ قانون، مهلت ۳۰ روز است."
        model = "fake"

    class FakeRouter:
        @staticmethod
        def router_enabled():
            return True

        @staticmethod
        async def complete(tier, messages, **kw):
            seen["system"] = messages[0]["content"]
            return Routed()

    async def fake_kg(query, limit=5, meta_out=None):
        return mod._fallback_knowledge_graph(limit)

    async def fake_guard(text, *, use_qdrant=True):
        return {"validated_articles": []}

    monkeypatch.setattr(mod, "aquery_knowledge_graph", fake_kg)
    monkeypatch.setattr(mod, "_llm_router", FakeRouter)
    monkeypatch.setattr(mod, "_use_llm_router", lambda: True)
    monkeypatch.setattr(mod, "_guard_citations", fake_guard)
    monkeypatch.setattr(mod.psycopg, "connect", _Boom)
    app = FastAPI()
    app.include_router(mod.router)
    return TestClient(app), seen


def test_empty_retrieval_still_answers_with_notice(client):
    c, seen = client
    body = {"message": "مهلت اعتراض به رأی چقدر است؟", "conversation_id": "x"}
    reply = c.post(URL, json=body).json()["reply"]
    assert reply.startswith(cs.GENERAL_KNOWLEDGE_NOTICE)
    assert reply.endswith(cs.CHAT_DISCLAIMER)
    assert "123" not in reply
    assert "30 روز" in reply
    assert "ماده ۱۰۸۲" not in seen["system"]
    assert "Latin digits" in seen["system"]


def test_out_of_scope_and_identity_unchanged(client):
    c, _ = client
    out = c.post(URL, json={"message": "دستور پخت قورمه سبزی"}).json()["reply"]
    assert out == mod.OUT_OF_SCOPE_REPLY
    ident = c.post(URL, json={"message": "تو کی هستی"}).json()["reply"]
    assert ident == mod.IDENTITY_REPLY
