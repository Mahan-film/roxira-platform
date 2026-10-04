"""Court catalog, new court types, /drafts/court-suggest and /drafts/indictment. Offline fakes."""

import json

import pytest


@pytest.fixture
def rd():
    from output_apps.generated_modules.smartjudge import ruling_draft

    return ruling_draft


@pytest.fixture
def cc():
    from output_apps.generated_modules.smartjudge import court_catalog

    return court_catalog


@pytest.fixture
def idr():
    from output_apps.generated_modules.smartjudge import indictment_draft

    return indictment_draft


NEW_TYPES = [
    "general_civil",
    "peace",
    "criminal_1",
    "criminal_2",
    "revolution",
    "guild_violations",
    "computer_guild",
    "bar_disciplinary",
]
LAW = {"law_name": "قانون مجازات", "article_no": "1", "text": "متن ماده"}


def test_new_court_types_registered(rd):
    for key in NEW_TYPES + ["civil", "criminal", "family", "commercial", "labor", "administrative"]:
        meta = rd.COURT_TYPES[key]
        assert meta["name"] and len(meta["parties"]) == 2
    for key in NEW_TYPES:
        assert rd.COURT_TYPES[key]["checklist"]


@pytest.mark.parametrize("court", NEW_TYPES)
def test_new_types_prefix_and_no_punishment(rd, court):
    llm = {
        "facts_summary": "a",
        "claims_summary": "b",
        "evidence_review": [],
        "issues": [],
        "legal_reasoning": [
            {"issue": "x", "articles": [{"law_name": "قانون مجازات", "article_no": "1"}], "reasoning": "r"}
        ],
        "proposed_operative_part": "حبس 5 سال",
        "uncertainties": [],
        "missing_information": [],
    }
    case = rd.RulingCase(court, "الف", "ب", "f", "c", [])
    out = rd.generate_ruling_draft(
        case,
        retrieve=lambda c: [LAW],
        call_llm=lambda p: json.dumps(llm, ensure_ascii=False),
        verify_citations=lambda t: {"validated_articles": [{"law_name": "قانون مجازات", "article_no": "1"}]},
    )
    assert out["status"] == rd.STATUS_DRAFT
    assert out["proposed_operative_part"].startswith(rd.NONFINAL_PREFIX.strip())
    if court in rd.CRIMINAL_COURT_TYPES:
        assert "5 سال" in out["proposed_operative_part"] or "حبس" in out["proposed_operative_part"]


def test_suggest_courts_rules(cc):
    top = lambda f, c="", h=None: cc.suggest_courts(f, c, h)  # noqa: E731
    assert top("چک برگشتی")[0]["court_key"] == "commercial"
    assert top("مطالبه مهریه و حضانت")[0]["court_key"] == "family"
    assert top("اخراج و حق السعی")[0]["court_key"] == "labor"
    assert top("کلاهبرداری")[0]["court_key"] == "criminal_2"
    assert top("قتل")[0]["court_key"] == "criminal_1"
    assert top("مواد مخدر")[0]["court_key"] == "revolution"
    assert top("گران‌فروشی")[0]["court_key"] == "guild_violations"
    assert top("هوش مصنوعی")[0]["court_key"] == "computer_guild"
    assert top("شکایت از وکیل")[0]["court_key"] == "bar_disciplinary"
    assert top("ابطال مصوبه")[0]["court_key"] == "administrative"
    assert top("خواسته مالی کوچک")[0]["court_key"] == "peace"
    assert top("متن بی‌ربط") == []
    res = top("چک سرقت قتل مهریه")
    assert len(res) <= 3
    assert res == top("چک سرقت قتل مهریه")
    assert set(res[0]) == {"court_key", "court_name_fa", "stage", "reason_fa", "score"}


def test_catalog_shape(cc):
    for meta in cc.COURT_CATALOG.values():
        assert meta["stage"] in cc.STAGES
        assert isinstance(meta["drafts_supported"], list)
    assert "وکیل" in cc.DISCLAIMER_FA


def _llm_indictment(punish=False):
    return {
        "charge_description": "حبس 3 سال" if punish else "توصیف اتهام",
        "evidence_summary": "خلاصه",
        "legal_basis": [
            {"law_name": "قانون مجازات", "article_no": "1", "reasoning": "r"},
            {"law_name": "قانون جعلی", "article_no": "9", "reasoning": "x"},
        ],
        "missing_information": ["گزارش"],
    }


def _gen(idr, payload, retrieve=None):
    case = idr.IndictmentCase("متهم", "شاکی", "شرح", [{"title": "t", "text": "x"}])
    return idr.generate_indictment_draft(
        case,
        retrieve=retrieve or (lambda c: [LAW]),
        call_llm=lambda p: json.dumps(payload, ensure_ascii=False),
        verify_citations=lambda t: {"validated_articles": [{"law": "قانون مجازات", "article": "1"}]},
    )


def test_indictment_guard_and_prefix(idr):
    out = _gen(idr, _llm_indictment())
    assert out["status"] == idr.STATUS_DRAFT
    assert out["charge_description"].startswith(idr.NONFINAL_PREFIX.strip())
    assert [a["article_no"] for a in out["legal_basis"]] == ["1"]
    assert any(r["article_no"] == "9" for r in out["removed_citations"])
    assert out["banner"] == idr.BANNER and out["requires_human_review"] is True


def test_indictment_never_punishment(idr):
    out = _gen(idr, _llm_indictment(punish=True))
    assert "حبس" not in out["charge_description"]


def test_indictment_insufficient(idr):
    assert _gen(idr, _llm_indictment(), retrieve=lambda c: [])["status"] == idr.STATUS_INSUFFICIENT
    bad = _llm_indictment()
    bad["legal_basis"] = [bad["legal_basis"][1]]
    assert _gen(idr, bad)["status"] == idr.STATUS_INSUFFICIENT


@pytest.fixture
def client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from output_apps.generated_modules.smartjudge import smartjudge_module as mod

    calls = {}

    async def fake_retrieve(query, limit=5, active_only=None):
        return {"laws": [{"law_name": "قانون مجازات", "article_no": "1", "summary": "s"}]}

    class Routed:
        content = json.dumps(_llm_indictment(), ensure_ascii=False)

    class FakeRouter:
        @staticmethod
        def router_enabled():
            return True

        @staticmethod
        async def complete(tier, messages, *, sensitive, **kw):
            calls["tier"], calls["sensitive"] = tier, sensitive
            return Routed()

    async def fake_guard(text, *, use_qdrant=True):
        return {"validated_articles": [{"law": "قانون مجازات", "article": "1"}]}

    monkeypatch.setattr(mod, "_lightrag_qdrant_retrieve", fake_retrieve)
    monkeypatch.setattr(mod, "_llm_router", FakeRouter)
    monkeypatch.setattr(mod, "_guard_citations", fake_guard)
    monkeypatch.setattr(mod, "_resolve_subscription_tier", lambda payload=None, request=None, websocket=None: "VIP")
    app = FastAPI()
    app.include_router(mod.router)
    return TestClient(app), calls, mod


def test_court_suggest_route_no_vip_needed(client, monkeypatch):
    c, calls, mod = client
    monkeypatch.setattr(mod, "_resolve_subscription_tier", lambda payload=None, request=None, websocket=None: "FREE")
    r = c.post("/api/v1/apps/judge/drafts/court-suggest", json={"facts": "چک برگشتی", "claims": ""})
    assert r.status_code == 200
    d = r.json()
    assert d["requires_human_review"] is True and d["banner"] and d["disclaimer"] and d["request_id"]
    assert d["suggestions"][0]["court_key"] == "commercial"
    assert "tier" not in calls
    assert c.post("/api/v1/apps/judge/drafts/court-suggest", json={"facts": "x" * 12001}).status_code == 422


def test_indictment_route(client, monkeypatch, capsys):
    c, calls, mod = client
    url = "/api/v1/apps/judge/drafts/indictment"
    secret = "راز-۱۲۳"
    r = c.post(url, json={"accused": "الف", "complainant": "ب", "facts": secret, "evidence": []})
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "AI_DRAFT_UNVERIFIED" and d["requires_human_review"] is True
    assert calls == {"tier": "strong", "sensitive": True}
    assert secret not in capsys.readouterr().err
    monkeypatch.setattr(mod, "_resolve_subscription_tier", lambda payload=None, request=None, websocket=None: "FREE")
    assert c.post(url, json={"accused": "الف", "complainant": "ب", "facts": "f"}).status_code == 403


def test_ruling_route_accepts_new_court_types(client):
    c, _, _ = client
    r = c.post(
        "/api/v1/apps/judge/drafts/ruling",
        json={"court_type": "bar_disciplinary", "claimant": "a", "respondent": "b", "facts": "f", "claims": "c"},
    )
    assert r.status_code == 200
