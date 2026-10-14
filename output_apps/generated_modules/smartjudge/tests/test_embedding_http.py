"""Offline tests for the shared TEI embedding path in lightrag_engine.

HTTP is mocked: no network, no sentence-transformers download. Run only this file:
  python3 -m pytest output_apps/generated_modules/smartjudge/tests/test_embedding_http.py -q
"""
import builtins

import pytest

from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.delenv("EMBEDDING_URL", raising=False)
    monkeypatch.setattr(eng, "_embed_cache", None)
    monkeypatch.setattr(eng, "_embedder_instance", None)
    monkeypatch.setattr(eng, "_embedder_load_failed", False)
    yield


def _fake_post(calls, failures=0):
    state = {"failures": failures}

    def post(url, payload, timeout):
        calls.append((url, payload, timeout))
        if state["failures"] > 0:
            state["failures"] -= 1
            raise OSError("connection refused")
        return [[0.5 * (i + 1), 1.0] for i in range(len(payload["inputs"]))]

    return post


def test_batches_at_most_sixteen_and_sends_normalize(monkeypatch):
    monkeypatch.setenv("EMBEDDING_URL", "http://roxira_embeddings:80")
    calls = []
    monkeypatch.setattr(eng, "_embed_post_json", _fake_post(calls))
    vectors = eng._embed_texts_http([f"t{i}" for i in range(20)])
    assert len(vectors) == 20
    assert [len(call[1]["inputs"]) for call in calls] == [16, 4]
    assert all(call[1]["normalize"] is True for call in calls)
    assert all(call[0] == "http://roxira_embeddings:80/embed" for call in calls)
    assert all(call[2] == 30 for call in calls)
    assert all(isinstance(x, float) for x in vectors[0])


def test_embedding_url_trailing_slash_is_trimmed(monkeypatch):
    monkeypatch.setenv("EMBEDDING_URL", "http://emb:80/")
    assert eng.embedding_url() == "http://emb:80"


def test_retries_once_and_succeeds(monkeypatch):
    monkeypatch.setenv("EMBEDDING_URL", "http://emb:80")
    calls = []
    monkeypatch.setattr(eng, "_embed_post_json", _fake_post(calls, failures=1))
    monkeypatch.setattr(eng.time, "sleep", lambda _seconds: None)
    vectors = eng._embed_texts_http(["a", "b"])
    assert len(vectors) == 2
    assert len(calls) == 2  # first attempt failed, the retry succeeded


def test_gives_up_after_two_retries(monkeypatch):
    monkeypatch.setenv("EMBEDDING_URL", "http://emb:80")
    calls = []
    monkeypatch.setattr(eng, "_embed_post_json", _fake_post(calls, failures=99))
    monkeypatch.setattr(eng.time, "sleep", lambda _seconds: None)
    with pytest.raises(OSError):
        eng._embed_texts_http(["a"])
    assert len(calls) == 3  # one try + two retries


def test_query_embed_uses_http_and_skips_local_model(monkeypatch):
    monkeypatch.setenv("EMBEDDING_URL", "http://emb:80")
    calls = []
    monkeypatch.setattr(eng, "_embed_post_json", _fake_post(calls))

    def must_not_load():
        raise AssertionError("local SentenceTransformer must not be loaded")

    monkeypatch.setattr(eng, "_get_query_embedder", must_not_load)
    vector = eng._embed_query_sync("سلام")
    assert calls[0][1]["inputs"] == ["سلام"]
    assert calls[0][1]["normalize"] is True
    assert vector is not None and all(isinstance(x, float) for x in vector)


def test_sentence_transformers_is_never_imported_when_url_set(monkeypatch):
    monkeypatch.setenv("EMBEDDING_URL", "http://emb:80")
    real_import = builtins.__import__

    def guarded(name, *args, **kwargs):
        if name == "sentence_transformers":
            raise AssertionError("sentence_transformers must not be imported")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded)
    monkeypatch.setattr(eng, "_embed_post_json", _fake_post([]))
    assert eng._embed_query_sync("سلام شخصی") is not None


def test_http_failure_falls_back_to_none(monkeypatch):
    monkeypatch.setenv("EMBEDDING_URL", "http://emb:80")
    monkeypatch.setattr(eng, "_embed_post_json", _fake_post([], failures=99))
    monkeypatch.setattr(eng.time, "sleep", lambda _seconds: None)
    assert eng._embed_query_sync("x") is None


def test_without_url_keeps_the_sentence_transformer_path(monkeypatch):
    class FakeModel:
        def encode(self, texts, normalize_embeddings=True, show_progress_bar=False):
            assert normalize_embeddings is True
            return [[2.0, 4.0] for _ in texts]

    monkeypatch.setattr(eng, "_get_query_embedder", lambda: FakeModel())

    def must_not_use_http(*_args, **_kwargs):
        raise AssertionError("HTTP must not be used without EMBEDDING_URL")

    monkeypatch.setattr(eng, "_embed_post_json", must_not_use_http)
    assert eng._embed_query_sync("x") == [2.0, 4.0]
