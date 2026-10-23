"""Offline tests for the Cloudflare Workers AI query-embedding backend (EMBED_BACKEND=cf).

HTTP is mocked: no network, no sentence-transformers download. Run only this file:
  python3 -m pytest output_apps/generated_modules/smartjudge/tests/test_cf_embed_backend.py -q
"""
import logging

import pytest

from output_apps.generated_modules.smartjudge import key_rotation
from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng

SECRET = "cf-token-must-never-appear"


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    for name in ("EMBED_BACKEND", "CF_ACCOUNT_ID", "CF_AI_TOKEN", "EMBEDDING_URL"):
        monkeypatch.delenv(name, raising=False)
    cache = eng._chat_fast.TTLCache(ttl=600.0, max_entries=512) if eng._chat_fast else None
    monkeypatch.setattr(eng, "_embed_cache", cache)
    monkeypatch.setattr(eng, "_embedder_instance", None)
    monkeypatch.setattr(eng, "_embedder_load_failed", False)
    key_rotation.COOLDOWNS.reset()
    yield
    key_rotation.COOLDOWNS.reset()


def _cf_env(monkeypatch):
    monkeypatch.setenv("EMBED_BACKEND", "cf")
    monkeypatch.setenv("CF_ACCOUNT_ID", "acct-123")
    monkeypatch.setenv("CF_AI_TOKEN", SECRET)


def _cf_ok(monkeypatch, vectors, key="data", status=200, calls=None):
    def post(url, payload, timeout, token):
        if calls is not None:
            calls.append((url, payload, timeout, token))
        return status, {"result": {key: vectors}}
    monkeypatch.setattr(eng, "_cf_post_json", post)
    return post


def _tei_stub(monkeypatch, vector):
    monkeypatch.setenv("EMBEDDING_URL", "http://emb:80")
    monkeypatch.setattr(eng, "_embed_post_json", lambda url, payload, timeout: [vector])


def _vec(*head):
    """A Cloudflare-sized (1024-dim) vector with ``head`` in the leading positions."""
    vector = [0.0] * eng.CF_EMBED_DIM
    for index, value in enumerate(head):
        vector[index] = float(value)
    return vector


def test_default_backend_is_tei(monkeypatch):
    monkeypatch.delenv("EMBED_BACKEND", raising=False)
    assert eng.embed_backend() == "tei"


def test_cache_is_bounded(monkeypatch):
    if eng._embed_cache is not None:
        assert eng._embed_cache.max_entries == 512


def test_cf_backend_dispatch_uses_workers_ai(monkeypatch):
    _cf_env(monkeypatch)
    calls = []
    _cf_ok(monkeypatch, [_vec(3.0, 4.0)], calls=calls)

    def tei_must_not_run(*_args, **_kwargs):
        raise AssertionError("TEI must not be used when CF succeeds")

    monkeypatch.setattr(eng, "_embed_post_json", tei_must_not_run)
    vectors = eng._embed_query_sync("q")
    assert len(vectors) == eng.CF_EMBED_DIM
    assert vectors[:2] == [0.6, 0.8]  # L2-normalised
    url, payload, timeout, token = calls[0]
    assert "@cf/baai/bge-m3" in url and "acct-123" in url
    assert payload == {"text": ["q"]}
    assert timeout == 3
    assert token == SECRET


def test_cf_accepts_response_key(monkeypatch):
    _cf_env(monkeypatch)
    _cf_ok(monkeypatch, [_vec(0.0, 5.0)], key="response")
    assert eng._embed_query_sync("q")[:2] == [0.0, 1.0]


def test_cf_extract_handles_top_level_data(monkeypatch):
    assert eng._extract_cf_vectors({"data": [[1.0, 0.0]]}) == [[1.0, 0.0]]
    assert eng._extract_cf_vectors({"result": {"response": [[0.0, 1.0]]}}) == [[0.0, 1.0]]
    assert eng._extract_cf_vectors({"result": "not vectors"}) == []


def test_cf_timeout_falls_back_to_tei(monkeypatch, caplog):
    _cf_env(monkeypatch)
    _tei_stub(monkeypatch, [0.0, 1.0])

    def cf_post(*_args, **_kwargs):
        raise TimeoutError("cf timeout")

    monkeypatch.setattr(eng, "_cf_post_json", cf_post)
    with caplog.at_level(logging.WARNING):
        assert eng._embed_query_sync("q") == [0.0, 1.0]
    warnings = [r for r in caplog.records if "Cloudflare" in r.getMessage()]
    assert len(warnings) == 1
    assert SECRET not in caplog.text


def test_cf_http_500_falls_back_to_tei(monkeypatch, caplog):
    _cf_env(monkeypatch)
    _tei_stub(monkeypatch, [1.0, 0.0])
    _cf_ok(monkeypatch, [], status=500)
    with caplog.at_level(logging.WARNING):
        assert eng._embed_query_sync("q") == [1.0, 0.0]
    assert any("Cloudflare" in r.getMessage() for r in caplog.records)
    assert SECRET not in caplog.text


def test_cf_bad_dims_falls_back_to_tei(monkeypatch, caplog):
    _cf_env(monkeypatch)
    _tei_stub(monkeypatch, [1.0, 0.0])
    _cf_ok(monkeypatch, [[1.0, 2.0, 3.0]])  # 3 dims, not 1024
    with caplog.at_level(logging.WARNING):
        assert eng._embed_query_sync("q") == [1.0, 0.0]
    assert any("Cloudflare" in r.getMessage() for r in caplog.records)


def test_cf_missing_env_raises_and_falls_back(monkeypatch, caplog):
    monkeypatch.setenv("EMBED_BACKEND", "cf")
    monkeypatch.delenv("CF_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("CF_AI_TOKEN", raising=False)
    _tei_stub(monkeypatch, [1.0, 0.0])
    with pytest.raises(RuntimeError, match="CF_ACCOUNT_ID"):
        eng._embed_texts_cf(["q"])
    with caplog.at_level(logging.WARNING):
        assert eng._embed_query_sync("q") == [1.0, 0.0]
    assert any("Cloudflare" in r.getMessage() for r in caplog.records)


def test_cf_zero_vector_is_left_alone(monkeypatch):
    _cf_env(monkeypatch)
    _cf_ok(monkeypatch, [_vec()])
    result = eng._embed_query_sync("q")
    assert len(result) == eng.CF_EMBED_DIM
    assert not any(result)


def test_cache_hit_skips_cf_and_normalises_key(monkeypatch):
    _cf_env(monkeypatch)
    calls = []
    _cf_ok(monkeypatch, [_vec(1.0, 0.0)], calls=calls)
    first = eng._embed_query_sync("  hello   world ")
    second = eng._embed_query_sync("hello world")
    assert first == second
    assert first[:2] == [1.0, 0.0]
    assert len(calls) == 1


def test_default_tei_backend_unchanged(monkeypatch):
    monkeypatch.setenv("EMBEDDING_URL", "http://emb:80")
    monkeypatch.setattr(eng, "_embed_post_json", lambda url, payload, timeout: [[0.1, 0.2]])

    def cf_must_not_run(*_args, **_kwargs):
        raise AssertionError("CF must be opt-in")

    monkeypatch.setattr(eng, "_cf_post_json", cf_must_not_run)
    assert eng._embed_query_sync("q") == [0.1, 0.2]