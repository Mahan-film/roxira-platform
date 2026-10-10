"""Offline tests for the chat latency path: no network, no DB, no LLM calls."""
import asyncio
import json
import time

from output_apps.generated_modules.smartjudge import chat_fast as cf


def run(coro):
    return asyncio.run(coro)


# ---- SSE framing -----------------------------------------------------------
def test_sse_frame_shape_and_persian_not_escaped():
    f = cf.sse_frame("delta", {"content": "سلام\nدنیا"})
    assert f.startswith("event: delta\ndata: ") and f.endswith("\n\n")
    assert "سلام" in f and f.count("\n") == 3  # the newline inside the text is JSON-escaped
    assert json.loads(f.split("data: ", 1)[1])["content"] == "سلام\nدنیا"


# ---- payload trimming ------------------------------------------------------
def test_trim_sources_drops_full_summary():
    rows = [{"title": "ماده ۱۰", "category": "c", "summary": "x" * 2000, "secret": "no"}]
    out = cf.trim_sources(rows, excerpt_chars=100)
    assert "summary" not in out[0] and "secret" not in out[0]
    assert out[0]["title"] == "ماده ۱۰" and len(out[0]["excerpt"]) <= 100


def test_context_lines_topk_and_truncation():
    rows = [{"title": f"t{i}", "summary": "y" * 900} for i in range(9)]
    text = cf.context_lines(rows, top_k=3, summary_chars=50)
    assert text.count("\n") == 2 and all(len(l) < 70 for l in text.split("\n"))


# ---- TTL cache -------------------------------------------------------------
def test_ttl_cache_expiry():
    now = [0.0]
    c = cf.TTLCache(ttl=10, clock=lambda: now[0])
    c.set("k", 1)
    assert c.get("k") == 1
    now[0] = 11
    assert c.get("k") is None


# ---- parallel retrieval ----------------------------------------------------
def test_parallel_retrieve_runs_concurrently_and_isolates_failure():
    async def slow_q():
        await asyncio.sleep(0.2)
        return "Q"

    async def slow_sql():
        await asyncio.sleep(0.2)
        raise RuntimeError("sql down")

    t0 = time.perf_counter()
    q, s, qe, se = run(cf.parallel_retrieve(slow_q, slow_sql))
    assert time.perf_counter() - t0 < 0.35  # sequential would be >= 0.4
    assert q == "Q" and s is None and qe is None and isinstance(se, RuntimeError)


def test_parallel_retrieve_records_subtimings():
    async def go():
        bucket = {}
        cf.timing_var.set(bucket)

        async def a():
            await asyncio.sleep(0.01)

        await cf.parallel_retrieve(a, a)
        return bucket

    b = run(go())
    assert "qdrant_ms" in b and "sql_ms" in b


# ---- stream with fast fallback --------------------------------------------
def _opener(behaviour):
    async def opener(model):
        b = behaviour[model]
        if b == "hang":
            await asyncio.sleep(5)
        elif isinstance(b, Exception):
            raise b
        for piece in b:
            yield piece
    return opener


def test_fallback_on_first_token_timeout_is_fast():
    plan = [("slow", 0.1), ("fast", 1.0)]
    got = []
    t0 = time.perf_counter()
    out = run(cf.stream_with_fallback(plan, _opener({"slow": "hang", "fast": ["a", "b"]}), got.append))
    assert time.perf_counter() - t0 < 1.0
    assert out.text == "ab" and out.model == "fast" and got == ["a", "b"]
    assert out.attempts[0] == ("slow", "timeout")


def test_quota_error_classified_and_next_model_tried():
    err = cf.LLMProviderError(403, "m1", "Key limit exceeded (daily limit)")
    out = run(cf.stream_with_fallback([("m1", 1), ("m2", 1)], _opener({"m1": err, "m2": ["ok"]})))
    assert out.text == "ok" and out.failures == [("m1", 403, "quota")]


def test_all_fail_gives_empty_text_and_kinds():
    e429 = cf.LLMProviderError(429, "m1", "rate")
    out = run(cf.stream_with_fallback([("m1", 1), ("m2", 0.05)], _opener({"m1": e429, "m2": "hang"})))
    assert out.text == "" and [k for _, _, k in out.failures] == ["quota", "timeout"]


def test_midstream_error_is_interrupted_not_restarted():
    async def opener(model):
        yield "part"
        raise RuntimeError("boom")

    out = run(cf.stream_with_fallback([("m", 1), ("n", 1)], opener))
    assert out.text == "part" and out.interrupted and out.model == "m"


def test_classify_status():
    assert cf.classify_status(402) == "quota" and cf.classify_status(429) == "quota"
    assert cf.classify_status(403, "Key limit exceeded") == "quota"
    assert cf.classify_status(401) == "auth" and cf.classify_status(503) == "upstream"
    assert cf.classify_status(504) == "timeout"


# ---- module-level behaviour: no canned answers, 503 contract, model plan ---
def _module():
    from output_apps.generated_modules.smartjudge import smartjudge_module as m
    return m


def test_model_plan_uses_registry_only_and_no_free_models():
    m = _module()
    for tier in ("VIP", "FREE"):
        plan = m._chat_model_plan(tier)
        assert plan and all(not x.endswith(":free") for x, _ in plan)
    assert m._chat_model_plan("VIP")[0][0] == m.OPENROUTER_TIERS["VIP"]["primary_model"]
    assert m._chat_model_plan("FREE")[0][0] == m._FREE_PRIMARY


def test_all_llm_failures_return_503_not_canned_answer(monkeypatch, capsys):
    m = _module()

    async def fake_kg(q, limit=3, meta_out=None):
        return [{"title": "ماده ۱", "summary": "s", "match_level": "EXACT"}], []

    async def fake_llm(*a, **k):
        out = cf.StreamOutcome()
        out.failures.append(("m", 403, "quota"))
        return out, "quota"

    monkeypatch.setattr(m, "aquery_knowledge_graph", fake_kg)
    monkeypatch.setattr(m, "_llm_stream_answer", fake_llm)
    monkeypatch.setattr(m, "OPENROUTER_API_KEY", "test-key-not-real")
    resp = run(m._consult_core({"message": "مهلت تجدیدنظرخواهی چقدر است؟"}, None, m.chat_auth.ANONYMOUS))
    assert resp.status_code == 503
    body = json.loads(resp.body)
    assert body == {"status": "ERROR", "code": "LLM_UNAVAILABLE", "message": cf.LLM_UNAVAILABLE_MESSAGE}
    assert "reply" not in body


def test_success_streams_deltas_and_trims_sources(monkeypatch):
    m = _module()

    async def fake_kg(q, limit=3, meta_out=None):
        return [{"title": "ماده ۱", "summary": "z" * 3000, "match_level": "EXACT"}], []

    async def fake_llm(messages, tier, is_voice, max_tokens, temperature, on_delta=None):
        out = cf.StreamOutcome(text="پاسخ", model="m", ttft_ms=5)
        await on_delta("پاسخ")
        return out, "ok"

    seen = []

    async def cb(p):
        seen.append(p)

    monkeypatch.setattr(m, "aquery_knowledge_graph", fake_kg)
    monkeypatch.setattr(m, "_llm_stream_answer", fake_llm)
    monkeypatch.setattr(m, "OPENROUTER_API_KEY", "test-key-not-real")
    res = run(m._consult_core({"message": "مهلت تجدیدنظرخواهی چقدر است؟"}, None, m.chat_auth.ANONYMOUS, cb))
    assert res["status"] == "SUCCESS" and res["reply"] == "پاسخ" and seen == ["پاسخ"]
    assert "summary" not in res["statutory_basis"][0] and len(json.dumps(res)) < 1500


def test_key_fallback_tried_only_for_quota(monkeypatch):
    m = _module()
    calls = []

    async def fake_stream(plan, opener, on_delta=None, total_timeout=0):
        calls.append(1)
        out = cf.StreamOutcome()
        if len(calls) == 1:
            out.failures.append(("m", 402, "quota"))
        else:
            out.text, out.model = "ok", "m"
        return out

    monkeypatch.setattr(m._chat_fast, "stream_with_fallback", fake_stream)
    monkeypatch.setattr(m, "OPENROUTER_API_KEY", "k1")
    monkeypatch.setenv("OPENROUTER_API_KEY_FALLBACK", "k2")
    out, kind = run(m._llm_stream_answer([], "FREE", False, 10, 0.3))
    assert out.text == "ok" and len(calls) == 2


def _client(monkeypatch, llm):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    m = _module()

    async def fake_kg(q, limit=3, meta_out=None):
        return [{"title": "ماده ۱", "summary": "s", "match_level": "EXACT"}], []

    monkeypatch.setattr(m, "aquery_knowledge_graph", fake_kg)
    monkeypatch.setattr(m, "_llm_stream_answer", llm)
    monkeypatch.setattr(m, "OPENROUTER_API_KEY", "test-key-not-real")
    app = FastAPI()
    app.include_router(m.router)
    return TestClient(app)


def test_chat_stream_endpoint_emits_meta_delta_done(monkeypatch):
    async def llm(messages, tier, is_voice, max_tokens, temperature, on_delta=None):
        await on_delta("الف")
        await on_delta("ب")
        return cf.StreamOutcome(text="الفب", model="m"), "ok"

    r = _client(monkeypatch, llm).post("/api/v1/apps/judge/chat/stream", json={"message": "مهلت تجدیدنظرخواهی چقدر است؟"})
    assert r.status_code == 200 and r.headers["x-accel-buffering"] == "no"
    assert r.headers["content-type"].startswith("text/event-stream")
    events = [b.split("\n", 1)[0] for b in r.text.strip().split("\n\n")]
    assert events[0] == "event: meta" and events[-1] == "event: done" and events.count("event: delta") == 2
    assert '"reply":"الفب"' in r.text


def test_chat_stream_endpoint_503_keeps_http_status(monkeypatch):
    async def llm(*a, **k):
        return cf.StreamOutcome(), "quota"

    r = _client(monkeypatch, llm).post("/api/v1/apps/judge/chat/stream", json={"message": "مهلت تجدیدنظرخواهی چقدر است؟"})
    assert r.status_code == 503 and r.json()["code"] == "LLM_UNAVAILABLE"
