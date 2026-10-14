"""Offline tests for the read-only public laws API (no Qdrant, no LLM)."""
import hashlib
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


def _derived_slug(name: str) -> str:
    normalised = laws_public._normalise_law_name(name)
    return "law-" + hashlib.sha1(normalised.encode("utf-8")).hexdigest()[:12]


def test_law_name_only_points_group_by_derived_slug():
    points = [
        {"law_name": "قانون کار", "article_no": "1", "text": "الف", "chunk_index": 0},
        {"law_name": "قانون كار", "article_no": "2", "text": "ب", "chunk_index": 0},
        {"law_name": "قانون  کار", "article_no": "1", "text": "ج", "chunk_index": 1},
    ]
    index = laws_public._build_index(points)
    assert [law["slug"] for law in index["laws"]] == [_derived_slug("قانون کار")]
    law = index["laws"][0]
    assert law["name"] == "قانون کار"
    assert set(law["articles"]) == {"1", "2"}
    assert law["articles"]["1"]["text"] == "الف\nج"
    assert index["entries"][0]["path"] == f"/laws/{_derived_slug('قانون کار')}/1"


def test_points_without_law_id_and_name_are_skipped():
    index = laws_public._build_index(
        [
            {"article_no": "1", "text": "x"},
            {"law_name": "   ", "article_no": "1", "text": "y"},
            {"law_id": "", "law_name": "", "article_no": "1"},
        ]
    )
    assert index["laws"] == []
    assert index["entries"] == []


def test_derived_slug_is_stable_and_prefixed():
    slug = laws_public._derived_law_slug(laws_public._normalise_law_name("قانون کار"))
    assert slug == _derived_slug("قانون کار")
    assert slug.startswith("law-")
    assert len(slug) == len("law-") + 12
    assert all(char in "0123456789abcdef" for char in slug[len("law-"):])


def test_law_name_only_points_served_by_index_and_sitemap(client, monkeypatch):
    derived = _derived_slug("قانون صدور چک (اصلاحی ۱۳۹۷)")

    async def fake_scroll():
        return [
            {"law_name": "قانون صدور چک (اصلاحی ۱۳۹۷)", "article_no": "3", "text": "متن"},
            {"law_id": "", "law_name": "", "article_no": "9", "text": "ignored"},
        ]

    monkeypatch.setattr(laws_public, "_scroll_collection", fake_scroll)
    body = client.get(f"{BASE}/index").json()
    assert [item["slug"] for item in body] == [derived]
    assert body[0]["articles_count"] == 1

    entries = client.get(f"{BASE}/sitemap-entries").json()
    assert entries["total"] == 1
    assert entries["entries"][0]["path"] == f"/laws/{derived}/3"
