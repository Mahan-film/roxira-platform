"""Offline tests for the read-only public laws API (no Qdrant, no LLM)."""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.generated_modules.smartjudge import chat_auth
from output_apps.generated_modules.smartjudge import laws_public

BASE = "/api/v1/apps/judge/laws-public"

INTERNAL = ("content_hash", "ingest_pipeline", "review_reasons", "fetched_at")

# 3 fake points: two chunks of one article (Persian digits) + one other law.
POINTS = [
    {
        "law_id": "civil",
        "law_name": "قانون مدنی",
        "law_type": "LAW",
        "article_no": "۱۲",
        "article_label": "ماده ۱۲",
        "chapter": "در اموال",
        "text": "بخش اول ماده دوازده.",
        "status": "ACTIVE",
        "is_active": True,
        "approval_date": "1928-01-01",
        "amended_on": None,
        "source": "ekhtebar.ir",
        "source_url": "https://ekhtebar.ir/civil/12",
        "source_tier": "unofficial",
        "needs_review": False,
        "chunk_index": 0,
        "content_hash": "SECRET-HASH",
        "ingest_pipeline": "internal-pipeline",
        "review_reasons": ["internal"],
        "fetched_at": "2026-01-01",
    },
    {
        "law_id": "civil",
        "law_name": "قانون مدنی",
        "law_type": "LAW",
        "article_no": "۱۲",
        "article_label": "ماده ۱۲",
        "text": "بخش دوم ماده دوازده.",
        "status": "ACTIVE",
        "is_active": True,
        "approval_date": "1928-01-01",
        "amended_on": None,
        "source": "ekhtebar.ir",
        "source_url": "https://ekhtebar.ir/civil/12",
        "needs_review": False,
        "chunk_index": 1,
    },
    {
        "law_id": "trade",
        "law_name": "قانون تجارت",
        "law_type": "LAW",
        "article_no": "5",
        "article_label": "ماده ۵",
        "text": "متن ماده پنج تجارت.",
        "status": "ACTIVE",
        "is_active": True,
        "approval_date": "1932-05-13",
        "amended_on": "1990-01-01",
        "source": "ekhtebar.ir",
        "source_url": "https://ekhtebar.ir/trade/5",
        "needs_review": True,
        "chunk_index": 0,
    },
]


@pytest.fixture(autouse=True)
def _clean():
    chat_auth.reset_for_tests()
    laws_public.reset_cache_for_tests()
    yield
    chat_auth.reset_for_tests()
    laws_public.reset_cache_for_tests()


@pytest.fixture
def client(monkeypatch):
    async def fake_scroll():
        return [dict(point) for point in POINTS]

    monkeypatch.setattr(laws_public, "_scroll_collection", fake_scroll)
    app = FastAPI()
    app.include_router(laws_public.router, prefix="/api/v1/apps/judge")
    return TestClient(app)


def test_index_sorted_by_name_and_cached_header(client):
    response = client.get(f"{BASE}/index")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=3600"
    body = response.json()
    assert {item["slug"] for item in body} == {"civil", "trade"}
    names = [item["name"] for item in body]
    assert names == sorted(names)
    civil = next(item for item in body if item["slug"] == "civil")
    assert civil["articles_count"] == 1
    assert civil["law_type"] == "LAW"
    assert civil["approval_date"] == "1928-01-01"


def test_article_merges_chunks_and_normalises_persian_digits(client):
    response = client.get(f"{BASE}/civil/12")
    assert response.status_code == 200
    body = response.json()
    assert body["law"] == {"slug": "civil", "name": "قانون مدنی"}
    article = body["article"]
    assert article["slug"] == "12"
    assert article["label"] == "ماده ۱۲"
    assert article["text"] == "بخش اول ماده دوازده.\nبخش دوم ماده دوازده."
    assert article["status"] == "ACTIVE"
    assert article["is_active"] is True
    assert article["approval_date"] == "1928-01-01"
    assert article["amended_on"] is None
    assert article["needs_review"] is False
    assert article["source"] == "ekhtebar.ir"
    assert article["source_url"] == "https://ekhtebar.ir/civil/12"
    assert body["prev_slug"] is None and body["next_slug"] is None


def test_law_detail_lists_articles(client):
    body = client.get(f"{BASE}/civil").json()
    assert body["slug"] == "civil"
    assert body["source"] == "ekhtebar.ir"
    assert body["source_url"] == "https://ekhtebar.ir/civil/12"
    assert body["articles"] == [
        {"slug": "12", "label": "ماده ۱۲", "status": "ACTIVE", "is_active": True}
    ]


def test_internal_fields_never_leak(client):
    for path in ("/index", "/civil", "/civil/12", "/sitemap-entries"):
        blob = json.dumps(client.get(f"{BASE}{path}").json())
        for field in INTERNAL:
            assert field not in blob


def test_unknown_law_and_article_return_404(client):
    assert client.get(f"{BASE}/does-not-exist").status_code == 404
    assert client.get(f"{BASE}/civil/999").status_code == 404
    assert client.get(f"{BASE}/does-not-exist/1").status_code == 404


def test_sitemap_entries_pagination(client):
    body = client.get(f"{BASE}/sitemap-entries").json()
    assert body["total"] == 2
    assert len(body["entries"]) == 2
    assert all(entry["path"].startswith("/laws/") for entry in body["entries"])

    first = client.get(f"{BASE}/sitemap-entries", params={"offset": 0, "limit": 1}).json()
    second = client.get(f"{BASE}/sitemap-entries", params={"offset": 1, "limit": 1}).json()
    assert first["total"] == 2 and second["total"] == 2
    assert len(first["entries"]) == 1 and len(second["entries"]) == 1
    assert first["entries"][0] != second["entries"][0]

    too_big = client.get(f"{BASE}/sitemap-entries", params={"limit": 5001})
    assert too_big.status_code == 422


def test_rate_limited_per_ip(client, monkeypatch):
    monkeypatch.setattr(chat_auth, "incr", lambda key, window: (121, 60))
    response = client.get(f"{BASE}/index")
    assert response.status_code == 429
