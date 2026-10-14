"""Offline tests for the shared TEI embedding path in scripts/legal/ingest_pipeline.py.

HTTP is mocked: no network, no sentence-transformers. Run only this file:
  python3 -m pytest scripts/legal/tests/test_ingest_embed_http.py -q
"""
import importlib.util
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


ip = _load("ingest_pipeline_embed_http", "scripts/legal/ingest_pipeline.py")


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("EMBEDDING_URL", raising=False)
    yield


def _fake_post(calls, failures=0):
    state = {"failures": failures}

    def post(url, payload, timeout):
        calls.append((url, payload, timeout))
        if state["failures"] > 0:
            state["failures"] -= 1
            raise OSError("connection refused")
        return [[0.25 * (i + 1), 0.75] for i in range(len(payload["inputs"]))]

    return post


def test_default_embed_batches_and_sends_normalize(monkeypatch):
    monkeypatch.setenv("EMBEDDING_URL", "http://roxira_embeddings:80")
    calls = []
    monkeypatch.setattr(ip, "_embed_post_json", _fake_post(calls))
    vectors = ip.default_embed([f"t{i}" for i in range(20)])
    assert len(vectors) == 20
    assert [len(call[1]["inputs"]) for call in calls] == [4, 4, 4, 4, 4]
    assert all(call[1]["normalize"] is True for call in calls)
    assert all(call[0] == "http://roxira_embeddings:80/embed" for call in calls)
    assert all(call[2] == 30 for call in calls)
    assert all(isinstance(x, float) for x in vectors[0])


def test_default_embed_retries_once_and_succeeds(monkeypatch):
    monkeypatch.setenv("EMBEDDING_URL", "http://emb:80")
    calls = []
    monkeypatch.setattr(ip, "_embed_post_json", _fake_post(calls, failures=1))
    monkeypatch.setattr(ip.time, "sleep", lambda _seconds: None)
    vectors = ip.default_embed(["a", "b"])
    assert len(vectors) == 2
    assert len(calls) == 2


def test_default_embed_gives_up_after_two_retries(monkeypatch):
    monkeypatch.setenv("EMBEDDING_URL", "http://emb:80")
    calls = []
    monkeypatch.setattr(ip, "_embed_post_json", _fake_post(calls, failures=99))
    monkeypatch.setattr(ip.time, "sleep", lambda _seconds: None)
    with pytest.raises(ip.Refusal):
        ip.default_embed(["a"])
    assert len(calls) == 7


def test_default_embed_never_imports_sentence_transformers_when_url_set(monkeypatch):
    monkeypatch.setenv("EMBEDDING_URL", "http://emb:80")
    real_import = __import__

    def guarded(name, *args, **kwargs):
        if name == "sentence_transformers":
            raise AssertionError("sentence_transformers must not be imported")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr("builtins.__import__", guarded)
    monkeypatch.setattr(ip, "_embed_post_json", _fake_post([]))
    assert len(ip.default_embed(["x", "y"])) == 2


def test_default_embed_without_url_uses_sentence_transformers(monkeypatch):
    fake = types.ModuleType("sentence_transformers")

    class FakeST:
        def __init__(self, name):
            self.name = name

        def encode(self, texts, normalize_embeddings=True):
            assert normalize_embeddings is True
            return [[1.0, 2.0] for _ in texts]

    fake.SentenceTransformer = FakeST
    monkeypatch.setitem(sys.modules, "sentence_transformers", fake)
    assert ip.default_embed(["a", "b"]) == [[1.0, 2.0], [1.0, 2.0]]
