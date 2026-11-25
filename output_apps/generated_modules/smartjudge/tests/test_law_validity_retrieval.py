"""Tests for Issue #1348: Law validity dates applied on every Smart Judge retrieval path,
and tenant write guards on public legal corpora collections.
"""

import asyncio
import pytest

from output_apps.generated_modules.smartjudge import abstention_gate as ag
from output_apps.generated_modules.smartjudge import regulations_retrieval as regs
from output_apps.generated_modules.smartjudge import rulings_retrieval as rulings
from output_apps.generated_modules.smartjudge import smartjudge_module as sj
from output_apps.generated_modules.smartjudge.security.vector_tenant_wrapper import (
    InvalidTenantFilterError,
    validate_points_for_upsert,
)


def test_filter_by_as_of_defaults_to_today_and_drops_past_valid_to():
    """Default as_of (when None/missing) evaluates against today's date in request timezone."""
    chunks = [
        {"title": "قانون منقضی شده", "valid_from": "1390-01-01", "valid_to": "1402-12-29"},
        {"title": "قانون معتبر فعلی", "valid_from": "1400-01-01", "valid_to": "1406-12-29"},
        {"title": "قانون دایمی بدون تاریخ", "status": "active"},
        {"title": "قانون منسوخ صریح", "status": "repealed"},
    ]
    # No date passed -> defaults to today (1405 SH / 2026 CE)
    filtered = ag.filter_by_as_of(chunks, as_of_date=None)
    titles = [c["title"] for c in filtered]
    assert "قانون منقضی شده" not in titles
    assert "قانون منسوخ صریح" not in titles
    assert "قانون معتبر فعلی" in titles
    assert "قانون دایمی بدون تاریخ" in titles


def test_knowledge_graph_path_drops_expired_chunk(monkeypatch):
    """aquery_knowledge_graph applies filter_by_as_of so expired chunks are dropped."""
    expired_law = {
        "title": "ماده منقضی",
        "law_name": "قانون کار قدیم",
        "article_no": "1",
        "valid_from": "1380-01-01",
        "valid_to": "1401-12-29",
        "status": "active",
    }
    valid_law = {
        "title": "ماده معتبر",
        "law_name": "قانون کار جدید",
        "article_no": "1",
        "valid_from": "1402-01-01",
        "valid_to": "1406-12-29",
        "status": "active",
    }

    async def fake_uncached(q, limit=3, meta_out=None):
        return [expired_law, valid_law], []

    monkeypatch.setattr(sj, "_aquery_knowledge_graph_uncached", fake_uncached)
    sj._RETRIEVAL_CACHE._data.clear()

    async def _run():
        return await sj.aquery_knowledge_graph("سوال آزمایشی", limit=2)

    laws, _ = asyncio.run(_run())
    assert len(laws) == 1
    assert laws[0]["title"] == "ماده معتبر"


def test_consult_path_drops_expired_chunk(monkeypatch):
    """_consult_core filters both laws and precedents by resolved as_of date."""
    expired_law = {
        "title": "ماده ۱۰ قانون قدیم",
        "law_name": "قانون قدیم",
        "article_no": "10",
        "summary": "حکم منقضی شده",
        "match_level": "EXACT",
        "is_active": True,
        "valid_from": "1390-01-01",
        "valid_to": "1402-12-29",
        "source_tier": "official",
        "category": "LAW",
    }
    valid_law = {
        "title": "ماده ۱۰ قانون جاری",
        "law_name": "قانون جاری",
        "article_no": "10",
        "summary": "حکم لازم‌الاجرا در حال حاضر",
        "match_level": "EXACT",
        "is_active": True,
        "valid_from": "1403-01-01",
        "valid_to": "1407-12-29",
        "source_tier": "official",
        "category": "LAW",
    }

    async def fake_kg(q, limit=5, meta_out=None, as_of=None, tz=None):
        return [expired_law, valid_law], []

    async def fake_stream(*args, **kwargs):
        from output_apps.generated_modules.smartjudge import chat_fast as cf
        return cf.StreamOutcome(text="پاسخ مدل"), "ok"

    monkeypatch.setattr(sj, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(sj, "aquery_knowledge_graph", fake_kg)
    monkeypatch.setattr(sj, "_llm_stream_answer", fake_stream)

    from output_apps.generated_modules.smartjudge.chat_auth import CurrentUser
    user = CurrentUser(phone="09120000000", tier="FREE", authenticated=True, plan_level="free")

    async def _run():
        return await sj._consult_core({"message": "قرارداد تجاری چیست؟"}, None, user)

    resp = asyncio.run(_run())
    # Status code is 200 or dict
    body = resp if isinstance(resp, dict) else resp.__dict__
    if hasattr(resp, "body"):
        import json
        body = json.loads(resp.body.decode("utf-8"))

    laws = body.get("statutory_basis") or []
    titles = [l.get("title") for l in laws]
    assert "ماده ۱۰ قانون قدیم" not in titles
    assert "ماده ۱۰ قانون جاری" in titles


def test_regulations_retrieval_drops_expired_chunk(monkeypatch):
    """retrieve_regulations applies filter_by_as_of on results."""
    monkeypatch.setenv(regs.ENV_COLLECTION, "iran_regulations_v1")
    monkeypatch.setattr(regs, "collection", lambda: "iran_regulations_v1")

    payloads = [
        {
            "_vector_score": 0.85,
            "title": "بخشنامه منقضی",
            "doc_id": "reg-1",
            "number": "101",
            "full_text": "متن بخشنامه منقضی",
            "is_active": True,
            "valid_from": "1395-01-01",
            "valid_to": "1401-12-29",
        },
        {
            "_vector_score": 0.88,
            "title": "بخشنامه جاری",
            "doc_id": "reg-2",
            "number": "102",
            "full_text": "متن بخشنامه معتبر",
            "is_active": True,
            "valid_from": "1402-01-01",
            "valid_to": "1407-12-29",
        },
    ]

    async def fake_search(vec, coll, k):
        return payloads

    async def _run():
        return await regs.retrieve_regulations(
            "بخشنامه مالیاتی",
            limit=5,
            embed=lambda text: [0.1] * 10,
            search=fake_search,
            embedder_name=regs.EXPECTED_EMBEDDER,
        )

    rows = asyncio.run(_run())
    titles = [r["title"] for r in rows]
    assert "بخشنامه منقضی" not in titles
    assert "بخشنامه جاری" in titles


def test_rulings_retrieval_drops_expired_chunk(monkeypatch):
    """retrieve_rulings applies filter_by_as_of on precedents."""
    monkeypatch.setenv(rulings.ENV_COLLECTION, "iran_rulings_v1")
    monkeypatch.setattr(rulings, "collection", lambda: "iran_rulings_v1")

    payloads = [
        {
            "_vector_score": 0.82,
            "ruling_id": "r-1",
            "title": "رای منسوخ دیوان",
            "number": "50",
            "full_text": "متن رای قدیمی",
            "is_active": True,
            "valid_from": "1380-01-01",
            "valid_to": "1400-01-01",
        },
        {
            "_vector_score": 0.90,
            "ruling_id": "r-2",
            "title": "رای وحدت رویه معتبر",
            "number": "810",
            "full_text": "متن رای وحدت رویه لازم‌الاتباع",
            "is_active": True,
            "valid_from": "1400-01-01",
            "valid_to": "1408-01-01",
        },
    ]

    async def fake_search(vec, coll, k):
        return payloads

    async def _run():
        return await rulings.retrieve_rulings(
            "رای وحدت رویه چک",
            limit=5,
            embed=lambda text: [0.1] * 10,
            search=fake_search,
            embedder_name=rulings.EXPECTED_EMBEDDER,
        )

    rows = asyncio.run(_run())
    numbers = [r.get("number") for r in rows]
    assert "50" not in numbers
    assert "810" in numbers


def test_drafting_retrieval_drops_expired_chunk(monkeypatch):
    """_ruling_retrieve_laws filters out expired law articles for drafting."""
    fake_result = {
        "laws": [
            {
                "law_name": "قانون سابق",
                "article_no": "5",
                "summary": "ماده سابق منقضی",
                "valid_from": "1390-01-01",
                "valid_to": "1402-12-29",
            },
            {
                "law_name": "قانون فعلی",
                "article_no": "5",
                "summary": "ماده فعلی معتبر",
                "valid_from": "1403-01-01",
                "valid_to": "1407-12-29",
            },
        ]
    }

    async def fake_qdrant(q, limit=6, active_only=True):
        return fake_result

    monkeypatch.setattr(sj, "_lightrag_qdrant_retrieve", fake_qdrant)

    async def _run():
        return await sj._ruling_retrieve_laws("دادخواست مطالبه")

    laws = asyncio.run(_run())
    law_names = [l["law_name"] for l in laws]
    assert "قانون سابق" not in law_names
    assert "قانون فعلی" in law_names


def test_public_collections_reject_tenant_payloads():
    """validate_points_for_upsert refuses tenant_id, user_id, or tenant payloads on public collections."""
    public_colls = ["iran_laws_v2", "iran_rulings_v1", "iran_regulations_v1"]

    for coll in public_colls:
        # 1. Specifying tenant_id argument
        with pytest.raises(InvalidTenantFilterError, match="Cannot specify tenant_id/user_id for public collection"):
            validate_points_for_upsert(coll, [{"id": 1, "payload": {}}], tenant_id="tenant-123")

        # 2. Specifying user_id argument
        with pytest.raises(InvalidTenantFilterError, match="Cannot specify tenant_id/user_id for public collection"):
            validate_points_for_upsert(coll, [{"id": 1, "payload": {}}], user_id="user-456")

        # 3. Payload with tenant_id key
        with pytest.raises(InvalidTenantFilterError, match="contains tenant-owned field 'tenant_id'"):
            validate_points_for_upsert(coll, [{"id": 2, "payload": {"text": "law", "tenant_id": "tenant-abc"}}])

        # 4. Payload with user_id key
        with pytest.raises(InvalidTenantFilterError, match="contains tenant-owned field 'user_id'"):
            validate_points_for_upsert(coll, [{"id": 3, "payload": {"text": "ruling", "user_id": "user-xyz"}}])

        # 5. Payload with tenant document type (e.g. case_file)
        with pytest.raises(InvalidTenantFilterError, match="contains tenant document type 'case_file'"):
            validate_points_for_upsert(coll, [{"id": 4, "payload": {"text": "private", "doc_type": "case_file"}}])

        # 6. Valid public payload -> accepted unchanged
        valid_points = [{"id": 5, "payload": {"text": "ماده ۱ قانون مدنی", "category": "LAW"}}]
        result = validate_points_for_upsert(coll, valid_points)
        assert result == valid_points
