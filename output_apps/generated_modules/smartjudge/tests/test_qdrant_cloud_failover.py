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
CLOUD2 = "https://c2.cloud.qdrant.io:6333"
CLOUD3 = "https://c3.cloud.qdrant.io:6333"
CLOUD4 = "https://c4.cloud.qdrant.io:6333"


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.delenv("QDRANT_CLOUD_URL", raising=False)
    monkeypatch.delenv("QDRANT_CLOUD_API_KEY", raising=False)
    for i in (2, 3, 4):
        monkeypatch.delenv(f"QDRANT_CLOUD_URL_{i}", raising=False)
        monkeypatch.delenv(f"QDRANT_CLOUD_API_KEY_{i}", raising=False)
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


def test_three_spare_clusters_appended_in_order(monkeypatch):
    monkeypatch.setenv("QDRANT_CLOUD_URL", CLOUD)
    monkeypatch.setenv("QDRANT_CLOUD_API_KEY", "k1")
    monkeypatch.setenv("QDRANT_CLOUD_URL_2", CLOUD2)
    monkeypatch.setenv("QDRANT_CLOUD_API_KEY_2", "k2")
    monkeypatch.setenv("QDRANT_CLOUD_URL_3", CLOUD3)
    monkeypatch.setenv("QDRANT_CLOUD_URL_4", CLOUD4)
    t = eng._qdrant_targets()
    assert t[: len(eng._QDRANT_HOST_CANDIDATES)] == [
        (h, f"http://{h}:{eng.QDRANT_PORT}", {}) for h in eng._QDRANT_HOST_CANDIDATES
    ]
    assert t[len(eng._QDRANT_HOST_CANDIDATES):] == [
        ("qdrant-cloud", CLOUD, {"api-key": "k1"}),
        ("qdrant-cloud-2", CLOUD2, {"api-key": "k2"}),
        ("qdrant-cloud-3", CLOUD3, {}),
        ("qdrant-cloud-4", CLOUD4, {}),
    ]


def test_spare_clusters_only_configured(monkeypatch):
    assert qc.cloud_targets() == []
    monkeypatch.setenv("QDRANT_CLOUD_URL_2", CLOUD2)  # spare without the first cluster
    monkeypatch.setenv("QDRANT_CLOUD_URL_4", CLOUD4)
    monkeypatch.setenv("QDRANT_CLOUD_URL_3", "http://insecure.example:6333")  # refused, skipped
    assert qc.cloud_targets() == [("qdrant-cloud-2", CLOUD2, {}), ("qdrant-cloud-4", CLOUD4, {})]


def test_one_spare_cluster(monkeypatch):
    monkeypatch.setenv("QDRANT_CLOUD_URL", CLOUD)
    monkeypatch.setenv("QDRANT_CLOUD_URL_2", CLOUD2)
    monkeypatch.setenv("QDRANT_CLOUD_API_KEY_2", "k2")
    assert qc.cloud_targets() == [
        ("qdrant-cloud", CLOUD, {}),
        ("qdrant-cloud-2", CLOUD2, {"api-key": "k2"}),
    ]


def test_note_failover_shared_throttle_across_clusters():
    assert qc.note_failover("qdrant-cloud-2", now=1000.0) is True
    assert qc.note_failover("qdrant-cloud-3", now=1030.0) is False  # same per-minute window
    assert qc.note_failover("qdrant-cloud", now=1061.0) is True
    assert qc.note_failover("localhost", now=9000.0) is False


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
