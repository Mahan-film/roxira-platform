"""Offline tests for the optional Qdrant Cloud read-only failover. All HTTP is faked.

  python3 -m pytest output_apps/generated_modules/smartjudge/tests/test_qdrant_cloud_failover.py -q
"""
import asyncio
import io
import json
import sys
import types

import pytest

from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng
from output_apps.generated_modules.smartjudge.legal_graph import qdrant_cloud as qc

CLOUD = "https://abc.cloud.qdrant.io:6333"


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.delenv("QDRANT_CLOUD_URL", raising=False)
    monkeypatch.delenv("QDRANT_CLOUD_API_KEY", raising=False)
    qc._reset_for_tests()
    yield


def test_inert_without_env():
    assert qc.cloud_target() is None
    t = eng._qdrant_targets()
    assert [x[0] for x in t] == list(eng._QDRANT_HOST_CANDIDATES)
    assert all(x[2] == {} for x in t)


def test_cloud_appended_last_with_key(monkeypatch):
    monkeypatch.setenv("QDRANT_CLOUD_URL", CLOUD + "/")
    monkeypatch.setenv("QDRANT_CLOUD_API_KEY", "k-test")
    t = eng._qdrant_targets()
    assert t[-1] == ("qdrant-cloud", CLOUD, {"api-key": "k-test"})
    assert len(t) == len(eng._QDRANT_HOST_CANDIDATES) + 1


def test_plain_http_cloud_url_is_refused(monkeypatch):
    monkeypatch.setenv("QDRANT_CLOUD_URL", "http://insecure.example:6333")
    assert qc.cloud_target() is None


def test_log_once_per_minute():
    assert qc.note_failover("qdrant-cloud", now=1000.0) is True
    assert qc.note_failover("qdrant-cloud", now=1030.0) is False
    assert qc.note_failover("qdrant-cloud", now=1061.0) is True
    assert qc.note_failover("127.0.0.1", now=5000.0) is False  # local hosts never log


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_urllib_scroll_falls_over_to_cloud(monkeypatch):
    monkeypatch.setenv("QDRANT_CLOUD_URL", CLOUD)
    monkeypatch.setenv("QDRANT_CLOUD_API_KEY", "k-test")
    seen = []

    def fake_urlopen(request, timeout=None):
        seen.append((request.full_url, request.get_header("Api-key")))
        if request.full_url.startswith(CLOUD):
            body = {"result": {"points": [{"payload": {"law_name": "x", "article_no": "1"}}]}}
            return _Resp(json.dumps(body).encode())
        raise OSError("connection refused")

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    rows = eng._scroll_by_point_filter_urllib({"must": []}, 3, "iran_laws_v3")
    assert rows == [{"law_name": "x", "article_no": "1"}]
    assert seen[-1][0].startswith(CLOUD) and seen[-1][1] == "k-test"
    assert all(h is None for _, h in seen[:-1])  # key never sent to local hosts
    assert len(seen) == len(eng._QDRANT_HOST_CANDIDATES) + 1


def test_urllib_scroll_no_cloud_returns_empty(monkeypatch):
    def boom(request, timeout=None):
        raise OSError("down")

    monkeypatch.setattr("urllib.request.urlopen", boom)
    assert eng._scroll_by_point_filter_urllib({}, 3, "c") == []


def test_httpx_search_falls_over_to_cloud(monkeypatch):
    monkeypatch.setenv("QDRANT_CLOUD_URL", CLOUD)
    monkeypatch.setenv("QDRANT_CLOUD_API_KEY", "k-test")
    calls = []

    class Resp:
        status_code = 200

        def json(self):
            return {"result": [{"score": 0.9, "payload": {"law_name": "y"}}]}

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            calls.append((url, headers))
            if url.startswith(CLOUD):
                return Resp()
            raise ConnectionError("refused")

    monkeypatch.setitem(sys.modules, "httpx", types.SimpleNamespace(AsyncClient=Client))
    rows = asyncio.run(eng._qdrant_vector_search_httpx([0.1, 0.2], "iran_laws_v3", 5))
    assert rows[0]["law_name"] == "y"
    assert calls[-1][1] == {"api-key": "k-test"}
    assert all(h == {} for _, h in calls[:-1])
