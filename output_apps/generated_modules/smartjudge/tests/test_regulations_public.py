"""Offline tests for the read-only public regulations API (no Qdrant, no LLM)."""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.generated_modules.smartjudge import chat_auth
from output_apps.generated_modules.smartjudge import regulations_public

BASE = "/api/v1/apps/judge/regulations-public"

INTERNAL = ("content_hash", "ingest_pipeline", "review_reasons", "fetched_at", "_point_id")

# 3 fake points: two chunks of one board resolution + one CBI circular.
POINTS = [
    {
        "doc_id": "deregulation_board_session_92",
        "doc_type": "board_resolution",
        "issuer": "هیئت مقررات‌زدایی",
        "subject": "حذف الزام مجوز",
        "number": "",
        "ref": "جلسه 92 بند 1",
        "date": "1404-09-10",
        "full_text": "بخش اول بند یکم.",
        "needs_review": True,
        "source_tier": "official",
        "source_url": "https://qavanin.ir/board/92",
        "status": "proposed",
        "is_active": True,
        "chunk_index": 0,
        "_point_id": "11111111-1111-1111-1111-111111111111",
        "content_hash": "SECRET-HASH",
        "ingest_pipeline": "internal-pipeline",
        "review_reasons": ["internal"],
        "fetched_at": "2026-01-01",
    },
    {
        "doc_id": "deregulation_board_session_92",
        "doc_type": "board_resolution",
        "issuer": "هیئت مقررات‌زدایی",
        "subject": "حذف الزام مجوز",
        "ref": "جلسه 92 بند 1",
        "date": "1404-09-10",
        "full_text": "بخش دوم بند یکم.",
        "needs_review": True,
        "chunk_index": 1,
        "_point_id": "22222222-2222-2222-2222-222222222222",
    },
    {
        "doc_id": "cbi_05_101819",
        "doc_type": "circular",
        "issuer": "بانک مرکزی جمهوری اسلامی ایران",
        "subject": "دستورالعمل نمونه",
        "number": "05/101819",
        "date": "1405-05-04",
        "full_text": "احتراما متن اصلی بخشنامه بانک مرکزی.",
        "needs_review": False,
        "source_tier": "unofficial",
        "chunk_index": 0,
        "_point_id": "33333333-3333-3333-3333-333333333333",
    },
]

BOARD_SLUG = regulations_public.regulation_slug("11111111-1111-1111-1111-111111111111")


@pytest.fixture(autouse=True)
def _clean():
    chat_auth.reset_for_tests()
    regulations_public.reset_cache_for_tests()
    yield
    chat_auth.reset_for_tests()
    regulations_public.reset_cache_for_tests()


@pytest.fixture
def client(monkeypatch):
    async def fake_scroll():
        return [dict(point) for point in POINTS]

    monkeypatch.setattr(regulations_public, "_scroll_collection", fake_scroll)
    app = FastAPI()
    app.include_router(regulations_public.router, prefix="/api/v1/apps/judge")
    return TestClient(app)


def test_index_issuers_and_counts(client):
    response = client.get(f"{BASE}/index")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=3600"
    body = response.json()
    assert body["total"] == 2
    assert {item["issuer"] for item in body["issuers"]} == {
        "هیئت مقررات‌زدایی",
        "بانک مرکزی جمهوری اسلامی ایران",
    }
    counts = {item["issuer"]: item["count"] for item in body["issuers"]}
    assert counts["هیئت مقررات‌زدایی"] == 1
    assert counts["بانک مرکزی جمهوری اسلامی ایران"] == 1


def test_list_merges_chunks_and_fields(client):
    body = client.get(f"{BASE}/list").json()
    assert body["total"] == 2
    board = next(item for item in body["items"] if item["issuer"] == "هیئت مقررات‌زدایی")
    assert board["slug"] == BOARD_SLUG
    assert board["number"] == "جلسه 92 بند 1"
    assert board["date"] == "1404-09-10"


def test_list_filters_by_issuer_and_paginates(client):
    issuer = "بانک مرکزی جمهوری اسلامی ایران"
    body = client.get(f"{BASE}/list", params={"issuer": issuer}).json()
    assert body["total"] == 1
    assert body["items"][0]["issuer"] == issuer

    first = client.get(f"{BASE}/list", params={"offset": 0, "limit": 1}).json()
    second = client.get(f"{BASE}/list", params={"offset": 1, "limit": 1}).json()
    assert first["total"] == 2 and second["total"] == 2
    assert len(first["items"]) == 1 and len(second["items"]) == 1
    assert first["items"][0] != second["items"][0]


def test_detail_full_text_and_flags(client):
    body = client.get(f"{BASE}/{BOARD_SLUG}").json()
    assert body["slug"] == BOARD_SLUG
    assert body["title"]
    assert body["text"] == "بخش اول بند یکم.\nبخش دوم بند یکم."
    assert body["needs_review"] is True
    assert body["source_url"] == "https://qavanin.ir/board/92"
    assert body["source_tier"] == "official"


def test_internal_fields_never_leak(client):
    for path in ("/index", "/list", f"/{BOARD_SLUG}", "/sitemap-entries"):
        blob = json.dumps(client.get(f"{BASE}{path}").json())
        for field in INTERNAL:
            assert field not in blob


def test_unknown_slug_returns_404(client):
    assert client.get(f"{BASE}/does-not-exist").status_code == 404


def test_sitemap_entries_pagination(client):
    body = client.get(f"{BASE}/sitemap-entries").json()
    assert body["total"] == 2
    assert all(entry["path"].startswith("/regulations/") for entry in body["entries"])

    first = client.get(f"{BASE}/sitemap-entries", params={"offset": 0, "limit": 1}).json()
    second = client.get(f"{BASE}/sitemap-entries", params={"offset": 1, "limit": 1}).json()
    assert first["entries"][0] != second["entries"][0]

    too_big = client.get(f"{BASE}/sitemap-entries", params={"limit": 5001})
    assert too_big.status_code == 422


def test_rate_limited_per_ip(client, monkeypatch):
    monkeypatch.setattr(chat_auth, "incr", lambda key, window: (121, 60))
    response = client.get(f"{BASE}/index")
    assert response.status_code == 429


def test_collection_default_and_env(monkeypatch):
    monkeypatch.delenv(regulations_public.ENV_COLLECTION, raising=False)
    assert regulations_public._collection() == "iran_regulations_v1"
    for off in ("0", "off", "false", " "):
        monkeypatch.setenv(regulations_public.ENV_COLLECTION, off)
        assert regulations_public._collection() == "iran_regulations_v1"
    monkeypatch.setenv(regulations_public.ENV_COLLECTION, "custom_regulations")
    assert regulations_public._collection() == "custom_regulations"


def test_slug_is_stable_and_prefixed():
    slug = regulations_public.regulation_slug("11111111-1111-1111-1111-111111111111")
    assert slug == BOARD_SLUG
    assert slug.startswith("reg-")
    assert len(slug) == len("reg-") + 12
    assert all(char in "0123456789abcdef" for char in slug[len("reg-"):])


def test_index_groups_points_without_ids_by_title():
    points = [
        {"issuer": "سازمان الف", "subject": "موضوع", "full_text": "الف", "chunk_index": 0},
        {"issuer": "سازمان الف", "subject": "موضوع", "full_text": "ب", "chunk_index": 1},
    ]
    index = regulations_public._build_index(points)
    assert len(index["documents"]) == 1
    assert index["documents"][0]["text"] == "الف\nب"
