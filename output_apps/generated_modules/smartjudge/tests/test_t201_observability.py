"""T201: per-stage answer timing record and citation-guard collection default. Offline."""

import ast
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

from output_apps.generated_modules.smartjudge import answer_timing, chat_fast, served_collection

MODULE = Path(__file__).resolve().parents[1] / "smartjudge_module.py"


def _in_bucket(fn):
    bucket: dict = {}
    token = chat_fast.timing_var.set(bucket)
    try:
        fn(bucket)
    finally:
        chat_fast.timing_var.reset(token)
    return bucket


def test_stage_accumulates_and_rerank_skipped_flag():
    def run(bucket):
        with answer_timing.stage("verify_ms"):
            pass
        with answer_timing.stage("verify_ms"):
            pass
        answer_timing.note_rerank_skipped()

    b = _in_bucket(run)
    assert isinstance(b["verify_ms"], int) and b["verify_ms"] >= 0
    assert b["rerank_skipped"] is True


def test_stage_without_bucket_is_a_noop():
    with answer_timing.stage("rerank_ms"):
        pass  # no active request: must not raise
    answer_timing.note_rerank_skipped()
    answer_timing.note_llm("m", attempts=1)


def test_fallback_detection_router_and_stream():
    def run(bucket):
        answer_timing.note_router_result(SimpleNamespace(model="a/b", attempts=2))
        assert bucket["fallback"] is True and bucket["model"] == "a/b"
        answer_timing.note_router_result(SimpleNamespace(model="a/b", attempts=1))
        assert bucket["fallback"] is False
        answer_timing.note_stream_outcome(
            SimpleNamespace(model="m2", attempts=[("m1", "timeout"), ("m2", "ok")]))
        assert bucket["fallback"] is True and bucket["llm_attempts"] == 2
        answer_timing.note_stream_outcome(SimpleNamespace(model="m1", attempts=[("m1", "ok")]))
        assert bucket["fallback"] is False

    _in_bucket(run)


def test_record_has_all_stages_and_no_pii(capsys):
    bucket = {"retrieval_ms": 120, "rerank_ms": 30, "graph_expansion_ms": 15, "ttft_ms": 800,
              "llm_ms": 2500, "verify_ms": 40, "model": "x/y", "fallback": True, "llm_attempts": 2,
              "user_text": "SECRET QUESTION", "phone": "09120000000"}
    answer_timing.emit("req-1 abc/../9", bucket, 3100, tier="FREE", collection="iran_laws_v8h")
    line = capsys.readouterr().err.strip().splitlines()[-1]
    rec = json.loads(line)
    assert rec["event"] == "answer_timing"
    for key in ("retrieval_ms", "rerank_ms", "rerank_skipped", "graph_expansion_ms", "ttft_ms",
                "llm_ms", "verify_ms", "total_ms", "model", "fallback", "collection"):
        assert key in rec
    assert rec["total_ms"] == 3100 and rec["fallback"] is True and rec["rerank_skipped"] is False
    assert rec["request_id"] == "req-1abc..9"  # sanitised, capped
    assert "SECRET" not in line and "0912" not in line


def test_emit_never_raises_on_bad_input():
    answer_timing.emit(None, None, "not-a-number")  # total_ms cannot be int()-ed


def test_citation_collection_follows_served_collection_env():
    env = {"LIGHTRAG_QDRANT_COLLECTION": "iran_laws_v8h"}
    assert served_collection.served_collection(env) == "iran_laws_v8h"
    assert served_collection.citation_collection(env) == "iran_laws_v8h"
    assert served_collection.citation_collection({**env, "LIGHTRAG_QDRANT_COLLECTION": "  iran_laws_v9 "}) == "iran_laws_v9"


def test_citation_collection_explicit_override_wins():
    env = {"LIGHTRAG_QDRANT_COLLECTION": "iran_laws_v8h", "ROXIRA_CITATION_QDRANT_COLLECTION": "other"}
    assert served_collection.citation_collection(env) == "other"
    assert served_collection.citation_collection({**env, "ROXIRA_CITATION_QDRANT_COLLECTION": "  "}) == "iran_laws_v8h"


def test_citation_collection_default_is_not_the_old_hardcoded_name():
    # No env at all: whatever the engine resolves, it is the retriever's own default,
    # never the stale hardcoded "iran_laws_bge_m3".
    name = served_collection.citation_collection({})
    assert name and name != "iran_laws_bge_m3"
    from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine

    assert name == lightrag_engine.QDRANT_FALLBACK_COLLECTION


def test_module_guard_default_is_wired_to_served_collection():
    tree = ast.parse(MODULE.read_text(encoding="utf-8"))
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_resolve_citation_collection")
    assert "citation_collection" in ast.unparse(fn)
    assert '"iran_laws_bge_m3"' not in ast.unparse(fn)
    assert not any(isinstance(n, ast.Assign) and any(getattr(t, "id", "") == "CITATION_QDRANT_COLLECTION_DEFAULT"
                                                     for t in n.targets) for n in tree.body)


def test_rerank_hook_records_skip_when_disabled(monkeypatch):
    from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng

    async def impl(query, limit=5, active_only=None):
        return [{"title": "t"}]

    monkeypatch.setattr(eng._reranker, "enabled", lambda: False)
    monkeypatch.setattr(eng, "_qdrant_fallback_laws_impl", impl)
    bucket: dict = {}
    token = chat_fast.timing_var.set(bucket)
    try:
        rows = asyncio.run(eng.qdrant_fallback_laws("q", 3))
    finally:
        chat_fast.timing_var.reset(token)
    assert rows == [{"title": "t"}] and bucket["rerank_skipped"] is True
