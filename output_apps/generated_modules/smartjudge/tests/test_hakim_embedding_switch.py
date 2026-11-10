"""Unit tests for Hakim embedding model switch config and re-index script (T32 #592)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
import pytest

from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng
from scripts.legal import reindex_hakim as rh


# ==============================================================================
# Config Switch Tests (lightrag_engine.py)
# ==============================================================================


def test_hakim_switch_default_is_off(monkeypatch):
    monkeypatch.delenv(eng.SMARTJUDGE_USE_HAKIM_EMBED_ENV, raising=False)
    assert eng.is_hakim_embed_enabled() is False
    assert eng.get_default_embed_model() == "BAAI/bge-m3"
    assert eng.get_default_collection() == "iran_laws_v2"


def test_hakim_switch_enabled_when_env_is_set(monkeypatch):
    for val in ("1", "true", "True", "yes", "YES", "on"):
        monkeypatch.setenv(eng.SMARTJUDGE_USE_HAKIM_EMBED_ENV, val)
        monkeypatch.delenv("LIGHTRAG_QDRANT_EMBED_MODEL", raising=False)
        monkeypatch.delenv("LIGHTRAG_QDRANT_COLLECTION", raising=False)

        assert eng.is_hakim_embed_enabled() is True
        assert eng.get_default_embed_model() == eng.HAKIM_MODEL_ID  # MCINext/Hakim
        assert eng.get_default_collection() == eng.HAKIM_DEFAULT_COLLECTION  # iran_laws_hakim_v1


def test_explicit_env_overrides_take_precedence(monkeypatch):
    monkeypatch.setenv(eng.SMARTJUDGE_USE_HAKIM_EMBED_ENV, "1")
    monkeypatch.setenv("LIGHTRAG_QDRANT_EMBED_MODEL", "custom/embedder")
    monkeypatch.setenv("LIGHTRAG_QDRANT_COLLECTION", "custom_collection")

    assert eng.get_default_embed_model() == "custom/embedder"
    assert eng.get_default_collection() == "custom_collection"


def test_resolve_collection_with_hakim(monkeypatch):
    monkeypatch.delenv("LIGHTRAG_QDRANT_ALLOW_EMBED_MISMATCH", raising=False)

    # When querying with Hakim, Hakim collections are valid matches
    assert eng._resolve_collection("iran_laws_hakim_v1", eng.HAKIM_MODEL_ID) == "iran_laws_hakim_v1"
    assert eng._resolve_collection("iran_laws_hakim", eng.HAKIM_MODEL_ID) == "iran_laws_hakim"

    # When querying with Hakim against a bge-m3 collection, it falls back to Hakim collection
    assert eng._resolve_collection("iran_laws_v2", eng.HAKIM_MODEL_ID) == eng.HAKIM_DEFAULT_COLLECTION

    # When querying with bge-m3 against a Hakim collection, it falls back to bge-m3 collection
    assert eng._resolve_collection("iran_laws_hakim_v1", "BAAI/bge-m3") == "iran_laws_v2"


# ==============================================================================
# Re-index Script Tests (scripts/legal/reindex_hakim.py)
# ==============================================================================


def test_reindex_assert_local():
    assert rh.assert_local("http://127.0.0.1:6333") == "http://127.0.0.1:6333"
    assert rh.assert_local("http://localhost:6333") == "http://localhost:6333"
    with pytest.raises(rh.Refusal, match="non-local Qdrant host"):
        rh.assert_local("http://remote.host.com:6333")
    with pytest.raises(rh.Refusal, match="invalid Qdrant URL"):
        rh.assert_local("not-a-url")


def test_reindex_refuses_overwriting_protected_collection():
    with pytest.raises(rh.Refusal, match="protected bge-m3 baseline"):
        rh.reindex_hakim(
            [{"law_name": "Test", "article_no": "1", "text": "Sample"}],
            target_collection="iran_laws_v2",
        )


def test_reindex_dry_run_does_not_call_http():
    called = []

    def mock_http(method, url, payload=None):
        called.append((method, url))
        return 200, {}

    rows = [
        {"law_name": "قانون تجارت", "article_no": "1", "text": "تاجر کسی است که شغل معمولی خود را معاملات تجارتی قرار دهد."},
        {"law_name": "قانون مدنی", "article_no": "10", "text": "قراردادهای خصوصی نسبت به کسانی که آن را منعقد نموده‌اند نافذ است."},
    ]

    res = rh.reindex_hakim(rows, dry_run=True, http=mock_http)
    assert res["ok"] is True
    assert res["dry_run"] is True
    assert res["rows_count"] == 2
    assert res["model"] == rh.DEFAULT_HAKIM_MODEL
    assert called == []  # No HTTP calls made


def test_reindex_executes_collection_creation_and_upsert():
    http_log = []

    def mock_http(method, url, payload=None):
        http_log.append((method, url, payload))
        if method == "GET" and "/collections/iran_laws_hakim_v1" in url:
            return 404, {}  # Does not exist yet
        if method == "PUT" and "/collections/iran_laws_hakim_v1/points" in url:
            return 200, {"result": {"operation_id": 1, "status": "completed"}}
        if method == "PUT" and "/collections/iran_laws_hakim_v1" in url:
            return 200, {"result": True}
        return 200, {}

    def mock_embed(texts):
        # Return mock 768-dim vectors
        return [[0.01 * (i + 1)] * rh.HAKIM_DIM for i in range(len(texts))]

    rows = [
        {
            "law_name": "قانون تجارت",
            "article_no": "1",
            "article_label": "ماده ۱",
            "text": "تاجر کسی است که شغل معمولی خود را معاملات تجارتی قرار دهد.",
            "source_tier": "official",
        },
        {
            "law_name": "قانون مدنی",
            "article_no": "10",
            "article_label": "ماده ۱۰",
            "text": "قراردادهای خصوصی نسبت به کسانی که آن را منعقد نموده‌اند نافذ است.",
            "source_tier": "official",
        },
    ]

    res = rh.reindex_hakim(
        rows,
        target_collection="iran_laws_hakim_v1",
        batch_size=2,
        http=mock_http,
        embed=mock_embed,
    )

    assert res["ok"] is True
    assert res["points_indexed"] == 2
    assert res["vector_dim"] == rh.HAKIM_DIM

    # Verify collection was created with 768-dim vector
    create_call = [c for c in http_log if c[0] == "PUT" and "/collections/iran_laws_hakim_v1" in c[1] and "points" not in c[1]]
    assert len(create_call) == 1
    assert create_call[0][2]["vectors"]["size"] == 768
    assert create_call[0][2]["vectors"]["distance"] == "Cosine"

    # Verify points upsert call
    upsert_call = [c for c in http_log if c[0] == "PUT" and "points?wait=true" in c[1]]
    assert len(upsert_call) == 1
    points = upsert_call[0][2]["points"]
    assert len(points) == 2
    assert points[0]["payload"]["law_name"] == "قانون تجارت"
    assert points[0]["payload"]["embedding_model"] == rh.DEFAULT_HAKIM_MODEL
    assert len(points[0]["vector"]) == 768


def test_reindex_scroll_from_source_collection():
    def mock_http(method, url, payload=None):
        if method == "GET" and "/collections/source_coll" in url:
            return 200, {}
        if method == "POST" and "/points/scroll" in url:
            return 200, {
                "result": {
                    "points": [
                        {
                            "id": "pt-1",
                            "payload": {
                                "law_name": "قانون چک",
                                "article_no": "3",
                                "text": "صادرکننده چک باید در تاریخ مندرج در آن وجه کافی داشته باشد.",
                            },
                        }
                    ],
                    "next_page_offset": None,
                }
            }
        return 200, {}

    rows = rh.scroll_rows_from_qdrant(mock_http, "http://127.0.0.1:6333", "source_coll")
    assert len(rows) == 1
    assert rows[0]["law_name"] == "قانون چک"
    assert rows[0]["article_no"] == "3"


def test_verify_hakim_collection():
    def mock_http(method, url, payload=None):
        return 200, {
            "result": {
                "points_count": 5000,
                "config": {"params": {"vectors": {"size": 768, "distance": "Cosine"}}},
            }
        }

    res = rh.verify_hakim_collection(mock_http, "http://127.0.0.1:6333", "iran_laws_hakim_v1")
    assert res["ok"] is True
    assert res["vector_size"] == 768
    assert res["points_count"] == 5000
