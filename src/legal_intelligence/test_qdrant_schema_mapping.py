"""Unit tests for the W6b Qdrant-fallback schema-tolerance fix (workstream W6b).

Covers ``output_apps/generated_modules/smartjudge/legal_graph/lightrag_engine.py``
(``_payload_text``, ``_payload_article_no``, ``_rank_payloads``, ``_scroll_body``)
and ``scripts/eval_legal_rag.py`` (``_article_no_matches``) against **fake**
payloads shaped like both collections that exist in production:

* the old ``iran_laws_bge_m3`` shape — flat ``title``/``text``/``category``,
  article number only embedded as free text ("... ماده 208 ...").
* the new ``iran_laws_v2`` shape (``scripts/w6_ingest_dotic.py``) — structured
  ``law_name``/``article_no``/``article_label`` plus a flat ``title``/``text``
  that also happen to be populated.

No network, no Qdrant, no Postgres, no LLM keys — pure functions only.
"""
from __future__ import annotations

import asyncio

from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as le
from scripts.eval_legal_rag import _article_no_matches

# ── نمونه‌های فیک هر دو شکل payload ──────────────────────────────────────────

OLD_SHAPE_PAYLOAD = {
    "id": 1,
    "component_id": "CRIMINAL-PROCEDURE-ART-1",
    "title": "قانون آیین دادرسی کیفری - ماده 1 (کلیات و اصول دادرسی کیفری و حقوق شهروندی)",
    "text": (
        "ماده 1 قانون آیین دادرسی کیفری مصوب ۱۳۹۲ با اصلاحات: ماده 1 تا 7: "
        "دادرسی کیفری باید مستند به قانون باشد."
    ),
    "category": "CRIMINAL_PROCEDURE",
    "valid_start": "2015-06-22",
}

V2_SHAPE_PAYLOAD = {
    "law_id": "ir-news-5274",
    "law_name": "قانون تجارت",
    "law_type": "COMMERCIAL",
    "article_no": "150",
    "article_label": "ماده 150",
    "chapter": None,
    "amended_on": None,
    "approval_date": None,
    "status": "VALID",
    "is_active": True,
    "source_url": "https://dotic.ir:443/news/5274/example",
    "source": "dotic via HF endomorphosis/ipfs_iran_laws snapshot 2026-09-22",
    "content_hash": "5b7df1c712210a0e08ca6bb8f641a1cc",
    "chunk_index": 0,
    "text": (
        "ماده 150 قانون تجارت: ماده 150 - در مورد تعهداتی که شرکت مختلط "
        "غیرسهامی ممکن است قبل از ثبت شرکت کرده باشد شریک با مسؤولیت محدود "
        "در مقابل اشخاص ثالث در حکم شریک ضامن خواهد بود."
    ),
    "title": "قانون تجارت - ماده 150",
    "category": "COMMERCIAL",
    "scope_tags": ["commercial"],
}

# یک شکل فرضی سوم: فیلدهای ساختاریافته دارد اما بر خلاف ``iran_laws_v2`` واقعی
# فیلد تخت ``title``/``text`` هم ندارد — سخت‌ترین حالت schema-tolerance که
# باید همچنان مادهٔ درست را از article_no/article_label/law_name بسازد.
STRUCTURED_ONLY_PAYLOAD = {
    "law_id": "ir-5580",
    "law_name": "قانون مدنی",
    "law_type": "CIVIL",
    "article_no": "218-mokarrar",
    "article_label": "ماده 218 مکرر",
    "is_active": True,
    "text": "شرکت ممکن است اختیاری یا قهری باشد.",
}


class TestPayloadText:
    def test_old_shape_includes_title_and_text(self) -> None:
        text = le._payload_text(OLD_SHAPE_PAYLOAD)
        assert "ماده 1" in text
        assert "دادرسی کیفری" in text

    def test_v2_shape_includes_law_name_and_article_label(self) -> None:
        text = le._payload_text(V2_SHAPE_PAYLOAD)
        assert "قانون تجارت" in text
        assert "ماده 150" in text

    def test_structured_only_shape_still_yields_text(self) -> None:
        text = le._payload_text(STRUCTURED_ONLY_PAYLOAD)
        assert "قانون مدنی" in text
        assert "ماده 218 مکرر" in text


class TestPayloadArticleNo:
    def test_old_shape_extracts_from_title(self) -> None:
        assert le._payload_article_no(OLD_SHAPE_PAYLOAD) == "1"

    def test_v2_shape_uses_explicit_field(self) -> None:
        assert le._payload_article_no(V2_SHAPE_PAYLOAD) == "150"

    def test_structured_only_shape_uses_explicit_field(self) -> None:
        # "218-mokarrar" -> leading digits only
        assert le._payload_article_no(STRUCTURED_ONLY_PAYLOAD) == "218"

    def test_missing_article_number_returns_none(self) -> None:
        assert le._payload_article_no({"text": "بدون شماره ماده"}) is None


class TestRankPayloads:
    def test_old_shape_row_carries_article_no(self) -> None:
        rows = le._rank_payloads([OLD_SHAPE_PAYLOAD], "دادرسی کیفری", limit=5)
        assert rows[0]["article_no"] == "1"
        assert "دادرسی کیفری" in rows[0]["title"]

    def test_v2_shape_row_carries_article_no_and_title(self) -> None:
        rows = le._rank_payloads([V2_SHAPE_PAYLOAD], "قانون تجارت", limit=5)
        assert rows[0]["article_no"] == "150"
        assert rows[0]["title"] == "قانون تجارت - ماده 150"
        assert rows[0]["category"] == "COMMERCIAL"

    def test_structured_only_shape_builds_title_from_law_name_and_label(self) -> None:
        rows = le._rank_payloads([STRUCTURED_ONLY_PAYLOAD], "قانون مدنی", limit=5)
        assert rows[0]["title"] == "قانون مدنی - ماده 218 مکرر"
        assert rows[0]["article_no"] == "218"
        # category falls back to law_name when no explicit category/collection key
        assert rows[0]["category"] == "قانون مدنی"

    def test_repealed_points_are_dropped(self) -> None:
        repealed = dict(V2_SHAPE_PAYLOAD, is_active=False)
        rows = le._rank_payloads([repealed], "قانون تجارت", limit=5)
        assert rows == []


class TestScrollBody:
    def test_scroll_is_only_the_small_emergency_fallback(self) -> None:
        # Hub review of the first W6b fix rejected scanning the whole
        # collection (up to 6,000 points) as the main retrieval path -- too
        # much latency/memory per chat question. Scroll is now only used when
        # real vector search is unavailable, and must stay small (<=200).
        body = le._scroll_body(limit=5)
        assert body["limit"] == le.QDRANT_SCAN_LIMIT
        assert body["limit"] <= 200


class TestArticleNoMatchesEval:
    def test_matches_plain_number(self) -> None:
        assert _article_no_matches(150, {"article_no": "150"})

    def test_matches_mokarrar_suffix_by_leading_digits(self) -> None:
        assert _article_no_matches(218, {"article_no": "218-mokarrar"})

    def test_no_match_for_different_article(self) -> None:
        assert not _article_no_matches(151, {"article_no": "150"})

    def test_missing_article_no_is_false_not_error(self) -> None:
        assert not _article_no_matches(150, {})
        assert not _article_no_matches(150, {"article_no": None})


class TestVectorSearchFallback:
    """Hub review of the first W6b fix: replace the "scroll everything" scan
    with real vector search (embed the query with the same bge-m3 settings
    ``scripts/w6_ingest_dotic.py`` used at ingest time), and fall back to the
    small scroll window only when the embedder or the search itself is
    unavailable. These tests never load a real model or touch the network —
    every boundary (``_embed_query_sync``, ``_qdrant_collection_vector_size``,
    ``_qdrant_vector_search_httpx``) is monkeypatched.
    """

    def _reset_embedder_state(self, monkeypatch) -> None:
        monkeypatch.setattr(le, "_embedder_instance", None)
        monkeypatch.setattr(le, "_embedder_load_failed", False)
        monkeypatch.setattr(le, "_collection_vector_dim_cache", {})
        monkeypatch.setattr(le, "QDRANT_VECTOR_SEARCH_ENABLED", True)

    def test_vector_search_disabled_flag_skips_straight_to_none(self, monkeypatch) -> None:
        # Operational kill switch (LIGHTRAG_QDRANT_VECTOR_SEARCH_ENABLED=0):
        # must short-circuit before even trying to embed the query.
        self._reset_embedder_state(monkeypatch)
        monkeypatch.setattr(le, "QDRANT_VECTOR_SEARCH_ENABLED", False)

        def _fail_if_called(_text):
            raise AssertionError("must not embed when vector search is disabled")

        monkeypatch.setattr(le, "_embed_query_sync", _fail_if_called)
        result = asyncio.run(le._try_vector_search("سوال", limit=5))
        assert result is None

    def test_get_query_embedder_returns_none_when_load_fails(self, monkeypatch) -> None:
        self._reset_embedder_state(monkeypatch)

        def _boom(*_args, **_kwargs):
            raise ImportError("sentence_transformers not installed")

        # Patch the module-level lazy import site by making SentenceTransformer
        # unavailable: simulate via a broken constructor call inside the
        # try/except in _get_query_embedder using a stub sentence_transformers.
        import sys
        import types

        fake_module = types.ModuleType("sentence_transformers")
        fake_module.SentenceTransformer = _boom  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "sentence_transformers", fake_module)

        assert le._get_query_embedder() is None
        # second call must not retry (load failure is cached, not re-attempted
        # forever) -- still None without raising.
        assert le._get_query_embedder() is None

    def test_embed_query_sync_is_none_when_embedder_unavailable(self, monkeypatch) -> None:
        self._reset_embedder_state(monkeypatch)
        monkeypatch.setattr(le, "_get_query_embedder", lambda: None)
        assert le._embed_query_sync("مهلت تجدیدنظرخواهی چند روز است؟") is None

    def test_try_vector_search_returns_none_when_embedder_unavailable(self, monkeypatch) -> None:
        # This is the fallback trigger: qdrant_fallback_laws must drop to the
        # small scroll window when _try_vector_search returns None.
        self._reset_embedder_state(monkeypatch)
        monkeypatch.setattr(le, "_embed_query_sync", lambda _text: None)

        async def _fail_if_called(*_args, **_kwargs):
            raise AssertionError("vector search must not run without a query vector")

        monkeypatch.setattr(le, "_qdrant_vector_search_httpx", _fail_if_called)

        result = asyncio.run(le._try_vector_search("سوال بدون مدل", limit=5))
        assert result is None

    def test_try_vector_search_skips_search_on_dimension_mismatch(self, monkeypatch) -> None:
        self._reset_embedder_state(monkeypatch)
        monkeypatch.setattr(le, "_embed_query_sync", lambda _text: [0.1, 0.2, 0.3])

        async def _fake_dim(_collection):
            return 1024  # collection dim != len(fake query vector) == 3

        async def _fail_if_called(*_args, **_kwargs):
            raise AssertionError("vector search must not run on a dim mismatch")

        monkeypatch.setattr(le, "_qdrant_collection_vector_size", _fake_dim)
        monkeypatch.setattr(le, "_qdrant_vector_search_httpx", _fail_if_called)

        result = asyncio.run(le._try_vector_search("سوال", limit=5))
        assert result is None

    def test_try_vector_search_happy_path_returns_reranked_candidates(self, monkeypatch) -> None:
        self._reset_embedder_state(monkeypatch)
        fake_vector = [0.1] * 1024
        monkeypatch.setattr(le, "_embed_query_sync", lambda _text: fake_vector)

        async def _fake_dim(_collection):
            return 1024

        captured = {}

        async def _fake_search(vector, collection, limit, active_only=None):
            captured["vector"] = vector
            captured["collection"] = collection
            captured["limit"] = limit
            return [V2_SHAPE_PAYLOAD]

        monkeypatch.setattr(le, "_qdrant_collection_vector_size", _fake_dim)
        monkeypatch.setattr(le, "_qdrant_vector_search_httpx", _fake_search)

        result = asyncio.run(le._try_vector_search("قانون تجارت", limit=5))
        assert result == [V2_SHAPE_PAYLOAD]
        assert captured["vector"] == fake_vector
        assert captured["collection"] == le.QDRANT_FALLBACK_COLLECTION
        # candidate pool must be at least QDRANT_VECTOR_TOPK, not just `limit`.
        assert captured["limit"] >= le.QDRANT_VECTOR_TOPK

    def test_qdrant_fallback_laws_falls_back_to_scroll_when_vector_search_unavailable(
        self, monkeypatch
    ) -> None:
        # End-to-end (still offline): _try_vector_search unavailable -> the
        # public entry point must still return results via the scroll path.
        self._reset_embedder_state(monkeypatch)
        monkeypatch.setattr(le, "_qdrant_probe_suppressed", lambda: False)

        async def _no_vector_search(*_args, **_kwargs):
            return None

        async def _fake_scroll(*_args, **_kwargs):
            return [V2_SHAPE_PAYLOAD]

        monkeypatch.setattr(le, "_try_vector_search", _no_vector_search)
        monkeypatch.setattr(le, "_qdrant_scroll_httpx", _fake_scroll)

        rows = asyncio.run(le.qdrant_fallback_laws("قانون تجارت", limit=5))
        assert rows
        assert rows[0]["article_no"] == "150"
