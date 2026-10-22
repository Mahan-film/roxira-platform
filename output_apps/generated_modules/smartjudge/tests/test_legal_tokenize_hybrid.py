"""Offline tests for the shared Persian tokenizer and the hybrid sparse request path.

No Qdrant, no network: the tokenizer and ``build_hybrid_query_body`` are pure, and the
retrieval fallback is exercised with monkeypatched async helpers.
"""
import asyncio

from output_apps.generated_modules.smartjudge import legal_tokenize as lt
from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng


# ---------------------------------------------------------------- tokenizer
def test_normalize_folds_arabic_letters_digits_zwnj_and_diacritics():
    assert lt.normalize("مادّه ۲۷ قانون ي كتاب") == "ماده 27 قانون ی کتاب"
    assert lt.normalize("تجدید‌نظر") == "تجدید نظر"  # ZWNJ -> space
    assert lt.normalize("أصلاح") == "اصلاح"  # hamza alef folds


def test_tokenize_keeps_article_numbers_as_tokens():
    assert lt.tokenize("ماده ۲۷ قانون") == ["ماده", "27", "قانون"]
    assert "27" in lt.tokenize("مادهٔ ٢٧")  # Arabic-Indic digits also become ASCII


def test_term_frequencies_count_repeated_tokens():
    tf = lt.term_frequencies("ماده ۲۷ ماده")
    assert tf["ماده"] == 2.0
    assert tf["27"] == 1.0


def test_sparse_vector_is_deterministic_tf_and_nonzero_index():
    indices_a, values_a = lt.sparse_vector("ماده ۲۷ ماده")
    indices_b, values_b = lt.sparse_vector("ماده ۲۷ ماده")
    assert indices_a == indices_b and values_a == values_b
    assert len(indices_a) == 2
    assert sorted(values_a) == [1.0, 2.0]
    assert all(index > 0 for index in indices_a)
    assert lt.token_index("27") == lt.token_index("27")


def test_query_sparse_vector_weights_each_token_once():
    indices, values = lt.query_sparse_vector("ماده ماده ۲۷")
    assert len(indices) == 2 and values == [1.0, 1.0]


# ---------------------------------------------------------------- request building
def test_build_hybrid_query_body_has_dense_sparse_prefetch_and_rrf():
    body = eng.build_hybrid_query_body(
        [0.1, 0.2], {"indices": [5], "values": [1.0]}, dense_limit=30, sparse_limit=30, limit=10
    )
    prefetch = body["prefetch"]
    assert len(prefetch) == 2
    assert prefetch[0]["query"] == [0.1, 0.2] and prefetch[0]["limit"] == 30
    assert "using" not in prefetch[0]  # dense is the default (unnamed) vector
    assert prefetch[1]["using"] == "bm25" and prefetch[1]["limit"] == 30
    assert prefetch[1]["query"] == {"indices": [5], "values": [1.0]}
    assert body["query"] == {"fusion": "rrf"}
    assert body["limit"] == 10 and body["with_payload"] is True and body["with_vector"] is False


def test_build_hybrid_query_body_propagates_active_filter_to_every_branch():
    point_filter = {"must": [{"key": "is_active", "match": {"value": True}}]}
    body = eng.build_hybrid_query_body(
        [0.0], {"indices": [1], "values": [1.0]}, point_filter=point_filter
    )
    assert body["filter"] == point_filter
    assert all(entry["filter"] == point_filter for entry in body["prefetch"])


def test_extract_query_points_accepts_both_response_shapes():
    class _Resp:
        status_code = 200

        def __init__(self, result):
            self._result = result

        def json(self):
            return {"result": self._result}

    assert eng._extract_query_points(_Resp({"points": [{"id": 1}]})) == [{"id": 1}]
    assert eng._extract_query_points(_Resp([{"id": 2}])) == [{"id": 2}]
    assert eng._extract_query_points(_Resp(None)) == []


def test_hybrid_flag_is_off_by_default(monkeypatch):
    monkeypatch.delenv(eng.HYBRID_SPARSE_ENV, raising=False)
    assert eng.hybrid_sparse_enabled() is False
    monkeypatch.setenv(eng.HYBRID_SPARSE_ENV, "1")
    assert eng.hybrid_sparse_enabled() is True


# ---------------------------------------------------------------- retrieval fallback
def _patch_dense(monkeypatch, dense_rows):
    calls = {"hybrid": 0, "dense": 0}

    def fake_embed(_text):
        return [0.1, 0.2]

    async def fake_dim(_collection):
        return 2

    async def fake_has_sparse(_collection, _name=eng.HYBRID_SPARSE_VECTOR):
        return False

    async def fake_hybrid(*_a, **_k):
        calls["hybrid"] += 1
        return [{"law_name": "HYBRID", "article_no": "0"}]

    async def fake_dense(*_a, **_k):
        calls["dense"] += 1
        return dense_rows

    monkeypatch.setattr(eng, "_embed_query_sync", fake_embed)
    monkeypatch.setattr(eng, "_qdrant_collection_vector_size", fake_dim)
    monkeypatch.setattr(eng, "_qdrant_collection_has_sparse", fake_has_sparse)
    monkeypatch.setattr(eng, "_qdrant_hybrid_search_httpx", fake_hybrid)
    monkeypatch.setattr(eng, "_qdrant_vector_search_httpx", fake_dense)
    monkeypatch.setattr(eng, "QDRANT_VECTOR_SEARCH_ENABLED", True)
    return calls


def test_hybrid_falls_back_silently_to_dense_without_sparse_vector(monkeypatch):
    dense_rows = [{"law_name": "DENSE", "article_no": "1"}]
    calls = _patch_dense(monkeypatch, dense_rows)
    monkeypatch.setenv(eng.HYBRID_SPARSE_ENV, "1")
    rows = asyncio.run(eng._try_vector_search("ماده ۲۷", 5))
    assert rows == dense_rows
    assert calls == {"hybrid": 0, "dense": 1}


def test_hybrid_uses_sparse_path_when_collection_has_bm25(monkeypatch):
    calls = {"hybrid": 0, "dense": 0}

    def fake_embed(_text):
        return [0.1, 0.2]

    async def fake_dim(_collection):
        return 2

    async def fake_has_sparse(_collection, _name=eng.HYBRID_SPARSE_VECTOR):
        return True

    async def fake_hybrid(*_a, **_k):
        calls["hybrid"] += 1
        return [{"law_name": "HYBRID", "article_no": "0"}]

    async def fake_dense(*_a, **_k):
        calls["dense"] += 1
        return [{"law_name": "DENSE", "article_no": "1"}]

    monkeypatch.setattr(eng, "_embed_query_sync", fake_embed)
    monkeypatch.setattr(eng, "_qdrant_collection_vector_size", fake_dim)
    monkeypatch.setattr(eng, "_qdrant_collection_has_sparse", fake_has_sparse)
    monkeypatch.setattr(eng, "_qdrant_hybrid_search_httpx", fake_hybrid)
    monkeypatch.setattr(eng, "_qdrant_vector_search_httpx", fake_dense)
    monkeypatch.setattr(eng, "QDRANT_VECTOR_SEARCH_ENABLED", True)
    monkeypatch.setenv(eng.HYBRID_SPARSE_ENV, "1")
    rows = asyncio.run(eng._try_vector_search("ماده ۲۷", 5))
    assert rows == [{"law_name": "HYBRID", "article_no": "0"}]
    assert calls == {"hybrid": 1, "dense": 0}


def test_hybrid_returns_none_on_error_and_dense_takes_over(monkeypatch):
    dense_rows = [{"law_name": "DENSE", "article_no": "1"}]
    calls = _patch_dense(monkeypatch, dense_rows)

    async def fake_has_sparse(_collection, _name=eng.HYBRID_SPARSE_VECTOR):
        return True

    async def fake_hybrid(*_a, **_k):
        calls["hybrid"] += 1
        return None  # HTTP failure -> caller must fall back

    monkeypatch.setattr(eng, "_qdrant_collection_has_sparse", fake_has_sparse)
    monkeypatch.setattr(eng, "_qdrant_hybrid_search_httpx", fake_hybrid)
    monkeypatch.setenv(eng.HYBRID_SPARSE_ENV, "1")
    rows = asyncio.run(eng._try_vector_search("ماده ۲۷", 5))
    assert rows == dense_rows
    assert calls == {"hybrid": 1, "dense": 1}


def test_hybrid_query_returns_none_for_text_without_tokens(monkeypatch):
    monkeypatch.setenv(eng.HYBRID_SPARSE_ENV, "1")
    assert asyncio.run(eng._qdrant_hybrid_search_httpx([0.1], "   ", "iran_laws_v8h", 5)) is None
