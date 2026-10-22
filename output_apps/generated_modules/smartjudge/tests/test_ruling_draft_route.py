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
    calls = {"tier": None, "sensitive": None, "accept": None, "prompt": None}

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
            calls["accept"] = kw.get("accept")
            calls["prompt"] = messages[0]["content"]
            return Routed()

        @staticmethod
        def drafting_total_budget():
            return 150.0

    async def fake_guard(text, *, use_qdrant=True):
        ok = "قانون مدنی" in text
        return {"validated_articles": [{"law": "قانون مدنی", "article": "10"}] if ok else []}

    async def no_core(law_names, article_no, active_only=None):
        return None

    monkeypatch.setattr(mod, "_lightrag_qdrant_retrieve", fake_retrieve)
    monkeypatch.setattr(mod, "_lightrag_fetch_exact_article", no_core)
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
    assert calls["tier"] == "drafting"  # dedicated ladder, never the free-first gateway tier
    assert calls["sensitive"] is True
    assert calls["accept"] is rd.is_parseable_draft  # invalid JSON moves to the next model
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
    data = resp.json()
    assert data["type"] == "VIP_REQUIRED"
    assert data["action"] == "UPGRADE_PLAN"
    # the text is about drafts, not the live-voice sentence of the chat VIP frame
    assert "پیش‌نویس" in data["message"]
    assert "مکالمه صوتی" not in data["message"]
    assert data["message"] != mod.VIP_REQUIRED_FRAME["message"]


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


def test_core_articles_are_fetched_and_reach_the_prompt_and_citation_guard(app_client, monkeypatch):
    """A loan claim fetches the governing articles by exact lookup and merges them BEFORE the prompt."""
    client, calls = app_client
    asked = []

    async def core_fetch(law_names, article_no, active_only=None):
        asked.append((tuple(law_names), str(article_no)))
        if str(article_no) == "648":
            return {"law_name": "قانون مدنی", "article_no": "648", "summary": "قرض عقدی است ..."}
        return None  # everything else is "not in our corpus": must not be injected

    monkeypatch.setattr(mod, "_lightrag_fetch_exact_article", core_fetch)
    llm = dict(LLM_JSON)
    llm["legal_reasoning"] = [
        {"issue": "قرض", "articles": [{"law_name": "قانون مدنی", "article_no": "648"}], "reasoning": "r"}
    ]

    class Routed:
        content = json.dumps(llm, ensure_ascii=False)

    async def complete(tier, messages, *, sensitive, **kw):
        calls["prompt"] = messages[0]["content"]
        return Routed()

    monkeypatch.setattr(mod._llm_router, "complete", complete)

    async def guard(text, *, use_qdrant=True):
        return {"validated_articles": [{"law": "قانون مدنی", "article": "648"}]}

    monkeypatch.setattr(mod, "_guard_citations", guard)
    resp = client.post(
        URL,
        json=body(claims="مطالبه اصل وجه قرض و خسارت تأخیر تأدیه و هزینه دادرسی", facts="قرض ۲۰۰ میلیون ریال"),
    )
    data = resp.json()
    assert data["status"] == rd.STATUS_DRAFT
    assert any(n == "648" for _, n in asked) and any(n == "522" for _, n in asked)
    assert "قانون مدنی ماده 648: قرض عقدی است" in calls["prompt"]
    assert "ماده 522" not in calls["prompt"]  # lookup returned nothing: nothing is invented
    assert data["legal_reasoning"][0]["articles"] == [{"law_name": "قانون مدنی", "article_no": "648"}]


def test_core_lookup_failure_does_not_fail_the_draft(app_client, monkeypatch):
    client, _ = app_client

    async def boom(law_names, article_no, active_only=None):
        raise RuntimeError("qdrant down")

    monkeypatch.setattr(mod, "_lightrag_fetch_exact_article", boom)
    resp = client.post(URL, json=body(claims="مطالبه وجه قرض"))
    assert resp.status_code == 200
    assert resp.json()["status"] == rd.STATUS_DRAFT


def test_bridge_timeout_covers_the_ladder_budget(monkeypatch):
    assert mod._drafting_bridge_timeout() >= 150.0
