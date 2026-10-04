"""Route tests for POST /drafts/ruling (#455). Fakes only: no network, no LLM."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.generated_modules.smartjudge import ruling_draft as rd
from output_apps.generated_modules.smartjudge import smartjudge_module as mod

URL = "/api/v1/apps/judge/drafts/ruling"
LAW = {"law_name": "قانون مدنی", "article_no": "10", "summary": "قراردادهای خصوصی نافذ است"}
SECRET = "راز-پرونده-۹۸۷"

LLM_JSON = {
    "facts_summary": "خلاصه",
    "claims_summary": "خواسته",
    "evidence_review": ["دلیل"],
    "issues": ["موضوع"],
    "legal_reasoning": [
        {
            "issue": "موضوع",
            "articles": [
                {"law_name": "قانون مدنی", "article_no": "10"},
                {"law_name": "قانون جعلی", "article_no": "999"},
            ],
            "reasoning": "استدلال",
        }
    ],
    "proposed_operative_part": "حکم به الزام خوانده",
    "uncertainties": [],
    "missing_information": [],
}


def _vip(payload=None, request=None, websocket=None):
    return "VIP"


def _free(payload=None, request=None, websocket=None):
    return "FREE"


@pytest.fixture
def app_client(monkeypatch):
    calls = {"tier": None, "sensitive": None}

    async def fake_retrieve(query, limit=5, active_only=None):
        return {"laws": [LAW, {**LAW, "article_no": "11", "is_bill": True}]}

    class Routed:
        content = json.dumps(LLM_JSON, ensure_ascii=False)

    class FakeRouter:
        @staticmethod
        def router_enabled():
            return True

        @staticmethod
        async def complete(tier, messages, *, sensitive, **kw):
            calls["tier"], calls["sensitive"] = tier, sensitive
            return Routed()

    async def fake_guard(text, *, use_qdrant=True):
        ok = "قانون مدنی" in text
        return {"validated_articles": [{"law": "قانون مدنی", "article": "10"}] if ok else []}

    monkeypatch.setattr(mod, "_lightrag_qdrant_retrieve", fake_retrieve)
    monkeypatch.setattr(mod, "_llm_router", FakeRouter)
    monkeypatch.setattr(mod, "_guard_citations", fake_guard)
    monkeypatch.setattr(mod, "_resolve_subscription_tier", _vip)

    app = FastAPI()
    app.include_router(mod.router)
    return TestClient(app), calls


def body(**over):
    data = {
        "court_type": "civil",
        "claimant": "الف",
        "respondent": "ب",
        "facts": "شرح " + SECRET,
        "claims": "مطالبه",
        "evidence": [{"title": "سند", "text": "متن"}],
    }
    data.update(over)
    return data


def test_success_filters_hallucinated_citation_and_keeps_invariants(app_client, capsys):
    client, calls = app_client
    resp = client.post(URL, json=body())
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == rd.STATUS_DRAFT
    assert data["banner"] == rd.BANNER
    assert data["requires_human_review"] is True
    assert data["model_tier"] == "strong"
    assert len(data["content_sha256"]) == 64
    assert data["request_id"] and data["draft_id"]
    kept = data["legal_reasoning"][0]["articles"]
    assert kept == [{"law_name": "قانون مدنی", "article_no": "10"}]
    assert any(r["article_no"] == "999" for r in data["removed_citations"])
    assert calls["tier"] == "strong"
    assert calls["sensitive"] is True
    captured = capsys.readouterr()
    assert SECRET not in captured.err + captured.out


def test_no_retrieved_articles_is_insufficient(app_client, monkeypatch):
    client, _ = app_client

    async def empty(query, limit=5, active_only=None):
        return {"laws": []}

    monkeypatch.setattr(mod, "_lightrag_qdrant_retrieve", empty)
    data = client.post(URL, json=body()).json()
    assert data["status"] == rd.STATUS_INSUFFICIENT
    assert data["requires_human_review"] is True
    assert data["banner"] == rd.BANNER


def test_llm_failure_is_insufficient_not_500(app_client, monkeypatch):
    client, _ = app_client

    class Boom:
        @staticmethod
        def router_enabled():
            return True

        @staticmethod
        async def complete(*args, **kwargs):
            raise RuntimeError("down")

    monkeypatch.setattr(mod, "_llm_router", Boom)
    resp = client.post(URL, json=body())
    assert resp.status_code == 200
    assert resp.json()["status"] == rd.STATUS_INSUFFICIENT


def test_non_vip_gets_403(app_client, monkeypatch):
    client, _ = app_client
    monkeypatch.setattr(mod, "_resolve_subscription_tier", _free)
    resp = client.post(URL, json=body())
    assert resp.status_code == 403
    assert resp.json()["type"] == "VIP_REQUIRED"


@pytest.mark.parametrize(
    "over",
    [
        {"court_type": "tax"},
        {"claimant": ""},
        {"facts": "x" * (rd.MAX_FACTS + 1)},
        {"claims": "x" * (rd.MAX_CLAIMS + 1)},
        {"evidence": [{"title": "t", "text": "x"}] * (rd.MAX_EVIDENCE_ITEMS + 1)},
        {"evidence": [{"title": "t", "text": "x" * (rd.MAX_EVIDENCE_TEXT + 1)}]},
        {"unknown_field": 1},
    ],
)
def test_validation_rejects_bad_input(app_client, over):
    client, _ = app_client
    assert client.post(URL, json=body(**over)).status_code == 422
