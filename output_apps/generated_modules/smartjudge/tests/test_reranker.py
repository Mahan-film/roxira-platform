"""Offline tests for the optional cross-encoder reranker (fake model, no downloads)."""
import asyncio
import time

import pytest

from output_apps.generated_modules.smartjudge import reranker as rr
from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng


def _rows(n=6):
    return [{"title": f"law#{i}", "summary": f"text {i}", "article_no": str(i), "match_level": "QDRANT_FALLBACK"}
            for i in range(n)]


class FakeModel:
    """Scores a row by the digit in its text: higher digit = more relevant."""

    def __init__(self, name="fake"):
        self.name = name
        self.calls = 0

    def predict(self, pairs):
        self.calls += 1
        return [float(p[1].split("text ")[1]) for p in pairs]


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for k in ("SMARTJUDGE_RERANKER", "SMARTJUDGE_RERANKER_MODEL", "SMARTJUDGE_RERANKER_TOP_N",
              "SMARTJUDGE_RERANKER_TIMEOUT_MS"):
        monkeypatch.delenv(k, raising=False)
    rr.reset_for_tests(None)
    yield
    rr.reset_for_tests(None)


def test_flag_off_is_identity_and_never_loads_model():
    loaded = []
    rr.reset_for_tests(lambda name: loaded.append(name) or FakeModel())
    rows = _rows()
    assert rr.rerank("q", rows) == rows
    assert rr.rerank("q", rows, top_k=3) == rows[:3]
    assert loaded == []
    assert rr.enabled() is False


def test_local_reorders_by_score_and_cuts_to_top_k(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_RERANKER", "local")
    rr.reset_for_tests(lambda name: FakeModel(name))
    out = rr.rerank("q", _rows(), top_k=3)
    assert [r["article_no"] for r in out] == ["5", "4", "3"]


def test_model_id_is_configurable(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_RERANKER", "local")
    monkeypatch.setenv("SMARTJUDGE_RERANKER_MODEL", "org/custom")
    seen = []
    rr.reset_for_tests(lambda name: seen.append(name) or FakeModel(name))
    rr.rerank("q", _rows())
    assert seen == ["org/custom"]


def test_model_loaded_once_and_exact_rows_stay_pinned(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_RERANKER", "local")
    made = []
    rr.reset_for_tests(lambda name: made.append(1) or FakeModel())
    rows = _rows()
    rows[2] = {**rows[2], "match_level": "QDRANT_EXACT"}
    out = rr.rerank("q", rows)
    rr.rerank("q", rows)
    assert out[0]["article_no"] == "2"
    assert [r["article_no"] for r in out[1:]] == ["5", "4", "3", "1", "0"]
    assert len(made) == 1


def test_only_top_n_candidates_are_rescored(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_RERANKER", "local")
    monkeypatch.setenv("SMARTJUDGE_RERANKER_TOP_N", "3")
    rr.reset_for_tests(lambda name: FakeModel())
    out = rr.rerank("q", _rows(6))
    assert [r["article_no"] for r in out] == ["2", "1", "0", "3", "4", "5"]


def test_scoring_error_falls_back_to_original_order(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_RERANKER", "local")

    class Boom(FakeModel):
        def predict(self, pairs):
            raise RuntimeError("boom")

    rr.reset_for_tests(lambda name: Boom())
    rows = _rows()
    assert rr.rerank("q", rows, top_k=4) == rows[:4]


def test_load_error_falls_back_and_is_not_retried(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_RERANKER", "local")
    attempts = []

    def bad(name):
        attempts.append(1)
        raise OSError("no model")

    rr.reset_for_tests(bad)
    rows = _rows()
    assert rr.rerank("q", rows) == rows
    assert rr.rerank("q", rows) == rows
    assert len(attempts) == 1


def test_timeout_falls_back_to_original_order(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_RERANKER", "local")
    monkeypatch.setenv("SMARTJUDGE_RERANKER_TIMEOUT_MS", "50")

    class Slow(FakeModel):
        def predict(self, pairs):
            time.sleep(0.4)
            return super().predict(pairs)

    rr.reset_for_tests(lambda name: Slow())
    rows = _rows()
    t0 = time.monotonic()
    assert rr.rerank("q", rows, top_k=3) == rows[:3]
    assert time.monotonic() - t0 < 0.35
    time.sleep(0.5)  # worker finished -> slot released, next call works
    monkeypatch.setenv("SMARTJUDGE_RERANKER_TIMEOUT_MS", "5000")
    assert rr.rerank("q", rows, top_k=1)[0]["article_no"] == "5"


def test_wrong_score_count_falls_back(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_RERANKER", "local")

    class Short(FakeModel):
        def predict(self, pairs):
            return [1.0]

    rr.reset_for_tests(lambda name: Short())
    rows = _rows()
    assert rr.rerank("q", rows) == rows


def test_arerank_async_wrapper(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_RERANKER", "local")
    rr.reset_for_tests(lambda name: FakeModel())
    out = asyncio.run(rr.arerank("q", _rows(), top_k=2))
    assert [r["article_no"] for r in out] == ["5", "4"]


def test_engine_wiring_flag_off_calls_impl_once_with_original_limit(monkeypatch):
    calls = []

    async def fake_impl(query, limit, active_only):
        calls.append(limit)
        return _rows(limit)

    monkeypatch.setattr(eng, "_qdrant_fallback_laws_impl", fake_impl)
    rows = asyncio.run(eng.qdrant_fallback_laws("q", limit=5))
    assert calls == [5] and len(rows) == 5


def test_engine_wiring_flag_on_fetches_top_n_and_returns_top_k(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_RERANKER", "local")
    rr.reset_for_tests(lambda name: FakeModel())
    calls = []

    async def fake_impl(query, limit, active_only):
        calls.append(limit)
        return [{**r, "summary": f"text {i}"} for i, r in enumerate(_rows(limit))]

    monkeypatch.setattr(eng, "_qdrant_fallback_laws_impl", fake_impl)
    rows = asyncio.run(eng.qdrant_fallback_laws("q", limit=5))
    assert calls == [20] and len(rows) == 5
    assert [r["article_no"] for r in rows] == ["19", "18", "17", "16", "15"]
