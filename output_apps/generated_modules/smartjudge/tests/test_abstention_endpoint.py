"""Tests for abstention gate wiring in POST /chat."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.generated_modules.smartjudge import smartjudge_module as mod

URL = "/api/v1/apps/judge/chat"


class _Boom:
    def __init__(self, *a, **k):
        raise RuntimeError("no db")


@pytest.fixture
def client(monkeypatch):
    async def fake_kg(query, limit=5, meta_out=None):
        return [
            {"law_name": "قانون صدور چک", "article_no": "1", "title": "ماده ۱", "valid_from": "1397-01-01", "valid_to": "1405-01-01", "score": 0.9},
            {"law_name": "قانون صدور چک", "article_no": "2", "title": "ماده ۲", "valid_from": "1397-01-01", "valid_to": "1405-01-01", "score": 0.9},
        ], []

    async def fake_guard(text, *, use_qdrant=True):
        return {"validated_articles": []}

    monkeypatch.setattr(mod, "aquery_knowledge_graph", fake_kg)
    monkeypatch.setattr(mod, "_guard_citations", fake_guard)
    monkeypatch.setattr(mod.psycopg, "connect", _Boom)
    app = FastAPI()
    app.include_router(mod.router)
    return TestClient(app)


def test_false_premise_abstains(client):
    resp = client.post(URL, json={"message": "ماده ۶۰ قانون صدور چک چیست؟", "conversation_id": "test-fp"}).json()
    assert resp.get("abstained") is True
    assert resp.get("abstention_reason") == "false_premise"
    assert "مغایرت" in resp.get("reply")


def test_out_of_scope_abstains(client):
    resp = client.post(URL, json={"message": "کد پایتون برای مرتب سازی بنویس", "conversation_id": "test-oos"}).json()
    assert resp.get("abstained") is True
    assert resp.get("abstention_reason") == "out_of_scope"
    assert "دستیار حقوقی" in resp.get("reply") or "خارج از" in resp.get("reply")


def test_as_of_temporal_filter_abstains_when_no_valid_version(client):
    # Requested date 1350-01-01 is before valid_from 1397-01-01
    resp = client.post(URL, json={
        "message": "شرایط چک چیست؟",
        "as_of_date": "1350-01-01",
        "conversation_id": "test-as-of",
    }).json()
    assert resp.get("abstained") is True
    assert resp.get("abstention_reason") == "no_as_of_version"
    assert "1350-01-01" in resp.get("reply")
