"""Offline unit tests for T241 Qdrant hybrid (BM25 + dense + sparse) with as-of filters (#980)."""
import asyncio


def _eng():
    from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng
    return eng


def test_normalize_as_of_int_handles_persian_arabic_and_iso():
    eng = _eng()
    assert eng.normalize_as_of_int("1405/09/04") == 14050904
    assert eng.normalize_as_of_int("1405-09-04") == 14050904
    assert eng.normalize_as_of_int("۱۴۰۵/۰۹/۰۴") == 14050904
    assert eng.normalize_as_of_int("٢٠٢٦-١١-٢٥") == 20261125
    assert eng.normalize_as_of_int(14050904) == 14050904
    assert eng.normalize_as_of_int(None) is None
    assert eng.normalize_as_of_int("") is None
    assert eng.normalize_as_of_int("invalid") is None
    assert eng.normalize_as_of_int(True) is None


def test_build_point_filter_as_of_and_metadata():
    eng = _eng()
    flt = eng.build_point_filter(
        active_only=True,
        as_of="1405/09/04",
        authority_tiers=[1, 2],
        law_id="civil-code",
        status="active",
    )
    assert flt is not None
    must = flt["must"]
    # active + valid_from + valid_to + authority_tier + law_id + status
    assert len(must) == 6
    assert {"should": [{"key": "valid_from", "range": {"lte": 14050904}}, {"is_empty": {"key": "valid_from"}}]} in must
    assert {"should": [{"key": "valid_to", "range": {"gte": 14050904}}, {"is_empty": {"key": "valid_to"}}]} in must
    assert {"key": "authority_tier", "match": {"any": [1, 2]}} in must
    assert {"key": "law_id", "match": {"value": "civil-code"}} in must
    assert {"key": "status", "match": {"value": "active"}} in must


def test_build_point_filter_inactive_and_no_filters_returns_none():
    eng = _eng()
    assert eng.build_point_filter(active_only=False) is None


def test_build_hybrid_query_body_three_branches_with_as_of_filter():
    eng = _eng()
    as_of_filter = eng.build_point_filter(active_only=False, as_of="1405-09-04")
    body = eng.build_hybrid_query_body(
        [0.1, 0.2, 0.3],
        {"indices": [11, 22], "values": [1.0, 1.0]},
        dense_limit=100,
        sparse_limit=100,
        limit=30,
        point_filter=as_of_filter,
        bm25_text="ماده 10 قانون مدنی",
        bm25_using="text_search_norm",
        bm25_limit=100,
    )
    assert body["query"] == {"fusion": "rrf"}
    assert body["limit"] == 30
    assert body["filter"] == as_of_filter
    prefetch = body["prefetch"]
    assert len(prefetch) == 3
    assert prefetch[0]["query"] == [0.1, 0.2, 0.3]
    assert prefetch[0]["limit"] == 100
    assert prefetch[1]["using"] == eng.HYBRID_SPARSE_VECTOR
    assert prefetch[1]["limit"] == 100
    assert prefetch[2]["using"] == "text_search_norm"
    assert prefetch[2]["query"] == {"text": "ماده 10 قانون مدنی"}
    assert prefetch[2]["limit"] == 100
    assert all(branch["filter"] == as_of_filter for branch in prefetch)


def test_qdrant_hybrid_search_httpx_sends_as_of_and_bm25_when_configured(monkeypatch):
    eng = _eng()
    captured = {}

    class _FakeResp:
        status_code = 200

        def json(self):
            return {
                "result": {
                    "points": [
                        {
                            "id": 1,
                            "score": 0.91,
                            "payload": {"law_name": "قانون مدنی", "article_no": "10", "valid_from": 13070218},
                        }
                    ]
                }
            }

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, json=None, headers=None):
            captured["url"] = url
            captured["json"] = json
            return _FakeResp()

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)
    monkeypatch.setattr(eng, "_qdrant_targets", lambda: [("local", "http://127.0.0.1:6333", {})])
    monkeypatch.setattr(eng, "HYBRID_NATIVE_BM25_VECTOR", "text_search_norm")

    rows = asyncio.run(
        eng._qdrant_hybrid_search_httpx(
            [0.5, 0.5],
            "ماده ۱۰ قانون مدنی",
            "laws_live",
            10,
            active_only=True,
            as_of="1405/09/04",
            authority_tiers=[1],
        )
    )
    assert rows is not None and len(rows) == 1
    assert rows[0]["law_name"] == "قانون مدنی"
    assert rows[0]["_vector_score"] == 0.91
    assert captured["url"].endswith("/collections/laws_live/points/query")
    assert len(captured["json"]["prefetch"]) == 3
    assert captured["json"]["query"] == {"fusion": "rrf"}
    assert "filter" in captured["json"]
