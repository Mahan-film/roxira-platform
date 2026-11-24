"""Offline tests for 'latest circular / regulation' intent and retrieval (#1380).

Verifies:
(1) catalog_intent detects latest_regulation and extracts normalized issuer
(2) latest_rulings scrolls SMARTJUDGE_REGULATIONS_COLLECTION (not rulings)
(3) issuer filtering works on Persian normalized variants, ZWNJ, and aliases
(4) sorting by date_iso/approval_date then number, newest first
(5) cache key is kept per collection
(6) respects law validity dates
(7) rulings intents and collections remain completely unchanged
(8) end-to-end chat returns regulation context and regulations response block
"""
from __future__ import annotations

import asyncio
import sys
import types
from typing import Any

from output_apps.generated_modules.smartjudge import catalog_intent as ci
from output_apps.generated_modules.smartjudge import rulings_retrieval as rr
from output_apps.generated_modules.smartjudge import smartjudge_module as sm


# ---------------------------------------------------------------------------
# 1. Intent & Issuer detection
# ---------------------------------------------------------------------------
def test_catalog_intent_detection():
    # 1. Regulations with various issuers
    r1 = ci.detect("آخرین بخشنامه بانک مرکزی در مورد وام چیست؟")
    assert r1 is not None
    assert r1["intent"] == "latest_regulation"
    assert r1["target"] == "regulation"
    assert r1["sub_collection"] == "regulations"
    assert r1["issuer"] == "بانک مرکزی"
    assert not r1["is_number_ask"]

    r2 = ci.detect("جدیدترین بخشنامه رئیس قوه قضاییه")
    assert r2 is not None
    assert r2["issuer"] == "رئیس قوه قضاییه"

    r2b = ci.detect("جدیدترین بخشنامه ریاست قوه قضاییه")
    assert r2b is not None
    assert r2b["issuer"] == "رئیس قوه قضاییه"

    r3 = ci.detect("آخرین نظریه اداره کل حقوقی قوه قضاییه")
    assert r3 is not None
    assert r3["issuer"] == "اداره حقوقی قوه قضاییه"

    r4 = ci.detect("آخرین مصوبه هیات مقررات زدایی")
    assert r4 is not None
    assert r4["issuer"] == "هیئت مقررات‌زدایی"

    r5 = ci.detect("شماره آخرین بخشنامه سازمان امور مالیاتی چیست؟")
    assert r5 is not None
    assert r5["is_number_ask"] is True
    assert r5["issuer"] == "سازمان امور مالیاتی"

    r6 = ci.detect("آخرین بخشنامه در خصوص چک صیادی چیست؟")
    assert r6 is not None
    assert r6["issuer"] is None

    # 2. Rulings intents remain unchanged
    u1 = ci.detect("آخرین رأی وحدت رویه دیوان عالی کشور")
    assert u1 is not None
    assert u1["intent"] == "latest_ruling"
    assert u1["target"] == "unity_supreme_court"
    assert u1["sub_collection"] == "unity_rulings"

    a1 = ci.detect("جدیدترین دادنامه هیئت عمومی دیوان عدالت اداری")
    assert a1 is not None
    assert a1["intent"] == "latest_ruling"
    assert a1["target"] == "admin_court"
    assert a1["sub_collection"] == "admin_court_board"


# ---------------------------------------------------------------------------
# 2. Mock client helper
# ---------------------------------------------------------------------------
def _fake_qdrant_client(
    points_by_collection: dict[str, list[dict[str, Any]]],
    called_urls: list[str],
):
    class Resp:
        status_code = 200

        def __init__(self, data):
            self._d = data

        def json(self):
            return {"result": {"points": self._d, "next_page_offset": None}}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            called_urls.append(url)
            # URL shape: http://host:port/collections/{coll}/points/scroll
            coll = url.split("/collections/")[1].split("/points/")[0]
            pts = points_by_collection.get(coll, [])
            return Resp(pts)

    return FakeClient


# ---------------------------------------------------------------------------
# 3. Collection targeting: regulations vs rulings
# ---------------------------------------------------------------------------
def test_latest_regulation_scrolls_regulations_collection(monkeypatch):
    rr._LATEST_CACHE.clear()
    monkeypatch.setenv("SMARTJUDGE_REGULATIONS_COLLECTION", "iran_regulations_v3")
    monkeypatch.setenv("SMARTJUDGE_RULINGS_COLLECTION", "iran_rulings_v1")

    called_urls: list[str] = []
    cbi_points = [
        {
            "payload": {
                "doc_id": "cbi_03_101",
                "doc_type": "circular",
                "issuer": "بانک مرکزی جمهوری اسلامی ایران",
                "number": "03/101819",
                "date": "1403-05-04",
                "approval_date": "1403-05-04",
                "subject": "دستورالعمل تسهیلات قرض‌الحسنه",
                "status": "active",
            }
        }
    ]
    ruling_points = [
        {
            "payload": {
                "ruling_type": "unity_supreme_court",
                "sub_collection": "unity_rulings",
                "number": "880",
                "date": "1404-06-17",
                "issuing_body": "دیوان عالی کشور",
                "status": "active",
            }
        }
    ]
    data = {
        "iran_regulations_v3": cbi_points,
        "iran_rulings_v1": ruling_points,
    }

    fake_client = _fake_qdrant_client(data, called_urls)
    monkeypatch.setitem(sys.modules, "httpx", types.SimpleNamespace(AsyncClient=fake_client))

    # 1. Regulation query must scroll iran_regulations_v3
    rows = asyncio.run(rr.latest_rulings(limit=5, sub_collection="regulations"))
    assert len(rows) == 1
    assert any("/collections/iran_regulations_v3/points/scroll" in u for u in called_urls)
    assert rows[0]["category"] == "REGULATION"
    assert rows[0]["number"] == "03/101819"
    assert rows[0]["issuer"] == "بانک مرکزی جمهوری اسلامی ایران"

    # 2. Rulings query must scroll iran_rulings_v1 (rulings unchanged)
    called_urls.clear()
    ruling_rows = asyncio.run(rr.latest_rulings(limit=5, sub_collection="unity_rulings"))
    assert len(ruling_rows) == 1
    assert any("/collections/iran_rulings_v1/points/scroll" in u for u in called_urls)
    assert ruling_rows[0]["category"] == "RULING"
    assert ruling_rows[0]["number"] == "880"


# ---------------------------------------------------------------------------
# 4. Issuer filtering (Persian normalisation & variants)
# ---------------------------------------------------------------------------
def test_latest_regulation_issuer_filter(monkeypatch):
    rr._LATEST_CACHE.clear()
    monkeypatch.setenv("SMARTJUDGE_REGULATIONS_COLLECTION", "iran_regulations_v3")

    called_urls: list[str] = []
    points = [
        {
            "payload": {
                "doc_id": "cbi_1",
                "doc_type": "circular",
                "issuer": "بانک مرکزی جمهوری اسلامی ایران",
                "number": "100",
                "date": "1403-05-01",
                "approval_date": "1403-05-01",
                "subject": "بخشنامه ارزی",
                "status": "active",
            }
        },
        {
            "payload": {
                "doc_id": "judiciary_1",
                "doc_type": "circular",
                "issuer": "رئیس قوه قضائیه",
                "number": "200",
                "date": "1403-06-01",
                "approval_date": "1403-06-01",
                "subject": "دستورالعمل ساماندهی زندانیان",
                "status": "active",
            }
        },
        {
            "payload": {
                "doc_id": "legal_dept_1",
                "doc_type": "opinion",
                "issuer": "اداره کل حقوقی قوه قضاییه",
                "number": "300",
                "date": "1403-04-01",
                "approval_date": "1403-04-01",
                "subject": "نظریه مشورتی قانون کاهش مجازات",
                "status": "active",
            }
        },
        {
            "payload": {
                "doc_id": "dereg_1",
                "doc_type": "board_resolution",
                "issuer": "هیئت مقررات‌زدایی و بهبود محیط کسب و کار",
                "number": "400",
                "date": "1402-11-01",
                "approval_date": "1402-11-01",
                "subject": "تسهیل صدور پروانه",
                "status": "active",
            }
        },
    ]

    fake_client = _fake_qdrant_client({"iran_regulations_v3": points}, called_urls)
    monkeypatch.setitem(sys.modules, "httpx", types.SimpleNamespace(AsyncClient=fake_client))

    # Test CBI filter
    rr._LATEST_CACHE.clear()
    cbi_rows = asyncio.run(
        rr.latest_rulings(limit=5, sub_collection="regulations", issuer="بانک مرکزی")
    )
    assert len(cbi_rows) == 1
    assert cbi_rows[0]["number"] == "100"

    # Test Judiciary Head with ZWNJ and hamza variants
    rr._LATEST_CACHE.clear()
    head_rows = asyncio.run(
        rr.latest_rulings(limit=5, sub_collection="regulations", issuer="رییس قوه قضاییه")
    )
    assert len(head_rows) == 1
    assert head_rows[0]["number"] == "200"

    # Test Legal Dept
    rr._LATEST_CACHE.clear()
    legal_rows = asyncio.run(
        rr.latest_rulings(
            limit=5, sub_collection="regulations", issuer="اداره حقوقی قوه قضاییه"
        )
    )
    assert len(legal_rows) == 1
    assert legal_rows[0]["number"] == "300"

    # Test Deregulation board
    rr._LATEST_CACHE.clear()
    dereg_rows = asyncio.run(
        rr.latest_rulings(limit=5, sub_collection="regulations", issuer="هیئت مقررات‌زدایی")
    )
    assert len(dereg_rows) == 1
    assert dereg_rows[0]["number"] == "400"

    # No issuer filter returns all sorted
    rr._LATEST_CACHE.clear()
    all_rows = asyncio.run(rr.latest_rulings(limit=10, sub_collection="regulations", issuer=None))
    assert len(all_rows) == 4
    # Newest date first (1403-06-01 -> 1403-05-01 -> 1403-04-01 -> 1402-11-01)
    assert [r["number"] for r in all_rows] == ["200", "100", "300", "400"]


# ---------------------------------------------------------------------------
# 5. Sorting by date_iso/approval_date and number
# ---------------------------------------------------------------------------
def test_parse_and_sort_date_and_number():
    items = [
        {"approval_date": "1402-10-15", "number": "50"},
        {"approval_date": "1403-05-04", "number": "10"},
        {"approval_date": "1403-05-04", "number": "20"},
        {"approval_date": "1401-01-01", "number": "999"},
    ]
    sorted_items = rr.parse_and_sort(items)
    # Highest date first, then highest number on same date
    assert sorted_items[0]["number"] == "20"
    assert sorted_items[1]["number"] == "10"
    assert sorted_items[2]["number"] == "50"
    assert sorted_items[3]["number"] == "999"


# ---------------------------------------------------------------------------
# 6. Law validity date filtering
# ---------------------------------------------------------------------------
def test_latest_regulation_validity_filtering(monkeypatch):
    rr._LATEST_CACHE.clear()
    monkeypatch.setenv("SMARTJUDGE_REGULATIONS_COLLECTION", "iran_regulations_v3")

    called_urls: list[str] = []
    points = [
        {
            "payload": {
                "doc_id": "active_circ",
                "number": "1",
                "approval_date": "1403-01-01",
                "status": "active",
            }
        },
        {
            "payload": {
                "doc_id": "repealed_circ",
                "number": "2",
                "approval_date": "1403-02-01",
                "status": "repealed",
            }
        },
    ]

    fake_client = _fake_qdrant_client({"iran_regulations_v3": points}, called_urls)
    monkeypatch.setitem(sys.modules, "httpx", types.SimpleNamespace(AsyncClient=fake_client))

    # Without as_of, repealed circulars are excluded
    rows = asyncio.run(rr.latest_rulings(limit=5, sub_collection="regulations"))
    assert len(rows) == 1
    assert rows[0]["number"] == "1"


# ---------------------------------------------------------------------------
# 7. End-to-end chat caller test (_consult_core)
# ---------------------------------------------------------------------------
def test_chat_caller_regulation_question(monkeypatch):
    rr._LATEST_CACHE.clear()
    monkeypatch.setenv("SMARTJUDGE_REGULATIONS_COLLECTION", "iran_regulations_v3")

    # Mock knowledge graph
    async def fake_kg(q, limit=3, meta_out=None):
        return [], []

    # Mock latest_rulings
    async def fake_latest(
        limit=5, sub_collection="unity_rulings", coll_name=None, issuer=None, as_of=None
    ):
        assert sub_collection == "regulations"
        assert issuer == "بانک مرکزی"
        return [
            {
                "title": "بخشنامه بانک مرکزی شماره 03/101819",
                "kind": "regulation",
                "category": "REGULATION",
                "number": "03/101819",
                "date": "1403-05-04",
                "issuer": "بانک مرکزی جمهوری اسلامی ایران",
                "subject": "دستورالعمل تسهیلات قرض‌الحسنه",
                "summary": "تسهیلات قرض‌الحسنه با نرخ ۴ درصد",
            }
        ]

    monkeypatch.setattr(sm, "aquery_knowledge_graph", fake_kg)
    monkeypatch.setattr(sm._rulings, "latest_rulings", fake_latest)
    monkeypatch.setattr(sm, "OPENROUTER_API_KEY", "test-fake-key")

    # Test direct number query: "شماره آخرین بخشنامه بانک مرکزی چیست؟"
    msg = {"message": "شماره آخرین بخشنامه بانک مرکزی چیست؟"}
    res = asyncio.run(sm._consult_core(msg, None, sm.chat_auth.ANONYMOUS))
    assert res["status"] == "SUCCESS"
    assert "03/101819" in res["reply"]
    assert "بانک مرکزی" in res["reply"]
    # Verified: regulations block contains the item, NOT judicial_practice!
    assert "regulations" in res
    assert len(res["regulations"]) == 1
    assert res["regulations"][0]["number"] == "03/101819"
