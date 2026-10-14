"""Offline tests for the optional regulations retrieval hook (no Qdrant, no LLM).

The hook is not wired into the chat flow; these tests only cover the public search function and its helpers.
"""
import asyncio

from output_apps.generated_modules.smartjudge import regulations_retrieval as reg

DASH = "\u2014"


def payload(score=0.8, chunk=0, **kw):
    p = {
        "doc_id": "deregulation_board_session_92",
        "doc_type": "board_resolution",
        "issuer": "هیئت مقررات‌زدایی",
        "subject": "حذف الزام مجوز",
        "session": 92,
        "item_no": "1",
        "ref": "جلسه 92 بند 1",
        "title": f"هیئت مقررات‌زدایی {DASH} حذف الزام مجوز",
        "chunk_index": chunk,
        "text": "متن بند اول.",
        "needs_review": True,
        "source_tier": "official",
        "is_active": True,
        "_vector_score": score,
    }
    p.update(kw)
    return p


def test_flag_default_off(monkeypatch):
    monkeypatch.delenv(reg.ENV_COLLECTION, raising=False)
    assert not reg.enabled() and reg.collection() == ""
    assert asyncio.run(reg.retrieve_regulations("هر پرسشی")) == []
    for off in ("0", "off", "false", " "):
        monkeypatch.setenv(reg.ENV_COLLECTION, off)
        assert not reg.enabled()
    monkeypatch.setenv(reg.ENV_COLLECTION, "iran_regulations_v1")
    assert reg.enabled() and reg.collection() == "iran_regulations_v1"


def test_payload_to_row_shape(monkeypatch):
    monkeypatch.setenv(reg.ENV_COLLECTION, "iran_regulations_v1")
    row = reg.payload_to_row(payload(), 0.9)
    assert row["category"] == "REGULATION" and row["kind"] == "regulation"
    assert row["match_level"] == "REGULATION_VECTOR"
    assert row["title"] == f"هیئت مقررات‌زدایی {DASH} حذف الزام مجوز"
    assert row["ref"] == "جلسه 92 بند 1"
    assert row["needs_review"] is True and row["source_tier"] == "official"
    assert row["source"] == "qdrant:iran_regulations_v1"


def test_hits_to_rows_cutoff_dedupe_order():
    rows = reg.hits_to_rows(
        [payload(score=0.9), payload(score=0.6), payload(score=0.7, chunk=1),
         payload(score=0.95, chunk=2, is_active=False), payload(score=0.3, chunk=3)],
        limit=5)
    assert len(rows) == 2  # same (doc, chunk) deduped; below-cutoff and inactive dropped
    assert rows[0]["vector_score"] == 0.9 and rows[1]["vector_score"] == 0.7


def test_hits_to_rows_respects_a_custom_cutoff():
    assert reg.hits_to_rows([payload(score=0.5)], cutoff=0.6) == []
    assert [r["vector_score"] for r in reg.hits_to_rows([payload(score=0.5)], cutoff=0.4)] == [0.5]


def test_retrieve_regulations_with_injected_embedder(monkeypatch):
    monkeypatch.setenv(reg.ENV_COLLECTION, "iran_regulations_v1")
    seen = {}

    async def search(vec, coll, k):
        seen.update(vec=vec, coll=coll, k=k)
        return [payload(score=0.9), payload(score=0.2, chunk=1)]

    rows = asyncio.run(reg.retrieve_regulations(
        "پرسش", limit=1, embed=lambda t: [0.1, 0.2], search=search, embedder_name="BAAI/bge-m3"))
    assert len(rows) == 1 and seen["coll"] == "iran_regulations_v1" and seen["k"] == 8
    # a different query embedder than the collection's bge-m3 -> skipped, never noise
    assert asyncio.run(reg.retrieve_regulations(
        "پرسش", embed=lambda t: [0.1], search=search, embedder_name="other")) == []

    async def boom(vec, coll, k):
        raise RuntimeError("qdrant down")

    assert asyncio.run(reg.retrieve_regulations(
        "پرسش", embed=lambda t: [0.1], search=boom, embedder_name="BAAI/bge-m3")) == []


def test_retrieve_regulations_off_by_default(monkeypatch):
    monkeypatch.delenv(reg.ENV_COLLECTION, raising=False)

    async def search(vec, coll, k):
        raise AssertionError("search must not run when the flag is off")

    assert asyncio.run(reg.retrieve_regulations(
        "پرسش", embed=lambda t: [0.1], search=search, embedder_name="BAAI/bge-m3")) == []
