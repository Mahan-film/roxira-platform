"""Contract tests for the Rust-ready ``RetrievalBackend`` Protocol and JSON models."""
from __future__ import annotations

import asyncio
import json

from output_apps.generated_modules.smartjudge.retrieval_contract import (
    LawHit,
    LocalRetrievalBackend,
    PrecedentHit,
    RetrievalBackend,
    RetrievalRequest,
    RetrievalResponse,
    RetrievalTimings,
)


def test_retrieval_json_contract_roundtrip():
    req = RetrievalRequest(query="مهلت تجدیدنظرخواهی", limit=5, trace_id="t-1")
    req_json = req.model_dump_json()
    parsed_req = RetrievalRequest.model_validate_json(req_json)
    assert parsed_req == req

    resp = RetrievalResponse(
        laws=[LawHit(title="ماده ۳۳۶ قانون آیین دادرسی مدنی", summary="بیست روز", match_level="EXACT", score=0.98)],
        precedents=[PrecedentHit(title="رأی وحدت رویه ۸۰۰", summary="توضیح", number="800")],
        source="qdrant-fallback",
        collection="iran_laws_v7b",
        timings=RetrievalTimings(embed_ms=4.1, qdrant_ms=12.3, sql_ms=8.0, total_ms=14.5),
        meta={"graph_entities": 0},
    )
    raw = resp.model_dump_json()
    data = json.loads(raw)
    assert data["source"] == "qdrant-fallback"
    assert data["timings"]["qdrant_ms"] == 12.3

    parsed_resp = RetrievalResponse.model_validate_json(raw)
    assert parsed_resp == resp
    laws_legacy, prec_legacy = parsed_resp.to_legacy_tuple()
    assert laws_legacy[0]["title"] == "ماده ۳۳۶ قانون آیین دادرسی مدنی"
    assert prec_legacy[0]["number"] == "800"


def test_local_retrieval_backend_satisfies_protocol():
    async def fake_query(query_text: str, limit: int = 3, meta_out=None):
        if meta_out is not None:
            meta_out.update({"source": "lightrag-graph", "collection": "iran_laws_v7b"})
        return (
            [{"title": "ماده ۱۰ قانون مدنی", "summary": "قراردادهای خصوصی", "match_level": "EXACT"}],
            [{"title": "رأی نمونه", "summary": "خلاصه"}],
        )

    backend = LocalRetrievalBackend(fake_query)
    assert isinstance(backend, RetrievalBackend)

    resp = asyncio.run(backend.retrieve(RetrievalRequest(query="ماده ۱۰ قانون مدنی", limit=3)))
    assert resp.source == "lightrag-graph"
    assert resp.collection == "iran_laws_v7b"
    assert len(resp.laws) == 1
    assert len(resp.precedents) == 1
    assert resp.timings.total_ms >= 0.0
