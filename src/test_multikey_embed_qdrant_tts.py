"""Offline tests for multi-key query embeddings (bge-m3 only), Qdrant Cloud per-cluster health
and the TTS fallback chain. All HTTP is faked; no key value is real. Nothing runs at import time.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import sys
import types
import urllib.error

import httpx
import pytest

from output_apps.generated_modules.smartjudge import key_rotation, voice_tts
from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng
from output_apps.generated_modules.smartjudge.legal_graph import qdrant_cloud as qc

SECRET = "SECRET-token-never-logged"
_EMBED_ENVS = (
    "EMBED_BACKEND", "EMBEDDING_URL", "MODAL_EMBED_URL", "MODAL_EMBED_TOKEN", "CHUTES_EMBED_URL",
    "AZURE_SPEECH_REGION",
)
_SLOTTED = ("CF_ACCOUNT_ID", "CF_AI_TOKEN", "DEEPINFRA_API_KEY", "CHUTES_API_KEY", "AZURE_SPEECH_KEY",
            "AZURE_SPEECH_REGION", "QDRANT_CLOUD_URL", "QDRANT_CLOUD_API_KEY")


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for name in _EMBED_ENVS:
        monkeypatch.delenv(name, raising=False)
    for base in _SLOTTED:
        for name in (base, f"{base}_2", f"{base}_3", f"{base}_4"):
            monkeypatch.delenv(name, raising=False)
    cache = eng._chat_fast.TTLCache(ttl=600.0, max_entries=512) if eng._chat_fast else None
    monkeypatch.setattr(eng, "_embed_cache", cache)
    monkeypatch.setattr(eng, "_embedder_instance", None)
    monkeypatch.setattr(eng, "_embedder_load_failed", True)  # never load sentence-transformers
    key_rotation.COOLDOWNS.reset()
    eng._embed_guard_reset()
    qc._reset_for_tests()
    yield
    key_rotation.COOLDOWNS.reset()
    qc._reset_for_tests()


def _vec(*head):
    vector = [0.0] * eng.CF_EMBED_DIM
    for index, value in enumerate(head):
        vector[index] = float(value)
    return vector


# ---------------------------------------------------------------------------
# query embeddings: Cloudflare across tokens, then other bge-m3 hosts
# ---------------------------------------------------------------------------


def test_cf_second_token_after_429_and_first_token_cools(monkeypatch):
    monkeypatch.setenv("EMBED_BACKEND", "cf")
    monkeypatch.setenv("CF_ACCOUNT_ID", "acct-1")
    monkeypatch.setenv("CF_AI_TOKEN", "t1")
    monkeypatch.setenv("CF_AI_TOKEN_2", "t2")  # no CF_ACCOUNT_ID_2: shares acct-1
    monkeypatch.setenv("CF_ACCOUNT_ID_3", "acct-3")
    monkeypatch.setenv("CF_AI_TOKEN_3", "t3")
    calls = []

    def post(url, payload, timeout, token):
        calls.append((url.split("/accounts/")[1].split("/")[0], token))
        if token == "t1":
            return 429, {}
        return 200, {"result": {"data": [_vec(3.0, 4.0)]}}

    monkeypatch.setattr(eng, "_cf_post_json", post)
    assert eng._embed_query_sync("q1")[:2] == [0.6, 0.8]
    assert calls == [("acct-1", "t1"), ("acct-1", "t2")]
    assert key_rotation.COOLDOWNS.cooling("cf-embed", "CF_AI_TOKEN")

    calls.clear()
    eng._embed_query_sync("q2")
    assert calls == [("acct-1", "t2")]  # the cooling token is skipped
    assert [s.split(":")[1] for s in eng.bge_hosts_state()["slots"]] == ["CF_AI_TOKEN", "CF_AI_TOKEN_2", "CF_AI_TOKEN_3"]


def test_all_cf_down_then_deepinfra_bge_m3(monkeypatch, caplog):
    monkeypatch.setenv("EMBED_BACKEND", "cf")
    monkeypatch.setenv("CF_ACCOUNT_ID", "acct-1")
    monkeypatch.setenv("CF_AI_TOKEN", SECRET)
    monkeypatch.setenv("DEEPINFRA_API_KEY_2", SECRET + "-di")
    monkeypatch.setattr(eng, "_cf_post_json", lambda *a, **k: (503, {}))
    # CF is down, so the same-vector-space guard takes its reference from the local TEI
    monkeypatch.setenv("EMBEDDING_URL", "http://emb:80")
    monkeypatch.setattr(eng, "_embed_post_json", lambda url, payload, timeout: [_vec(0.0, 1.0)])
    seen = {}

    def host_post(url, payload, timeout, token):
        seen.update(url=url, payload=payload, token=token)
        data = [{"index": 0, "embedding": _vec(0.0, 2.0)}]
        return 200, {"data": data}

    monkeypatch.setattr(eng, "_host_post_json", host_post)
    with caplog.at_level(logging.INFO):
        assert eng._embed_query_sync("q")[:2] == [0.0, 1.0]
    assert seen["url"] == eng.DEEPINFRA_EMBED_URL
    assert seen["payload"] == {"model": "BAAI/bge-m3", "input": ["q"]}
    assert SECRET not in caplog.text


def test_modal_tei_shape_and_https_only(monkeypatch):
    monkeypatch.setenv("EMBED_BACKEND", "cf")
    monkeypatch.setenv("MODAL_EMBED_URL", "http://plain.example")  # refused
    assert eng._bge_hosts() == []
    monkeypatch.setenv("MODAL_EMBED_URL", "https://x.modal.run/")
    seen = {}

    def host_post(url, payload, timeout, token):
        seen.update(url=url, payload=payload, token=token)
        return 200, [_vec(1.0)]

    monkeypatch.setattr(eng, "_host_post_json", host_post)
    assert eng._embed_query_sync("q")[0] == 1.0
    assert seen == {"url": "https://x.modal.run/embed", "payload": {"inputs": ["q"], "normalize": True}, "token": ""}


def test_wrong_dims_from_a_host_is_rejected_without_cooling_the_key(monkeypatch):
    monkeypatch.setenv("EMBED_BACKEND", "cf")
    monkeypatch.setenv("DEEPINFRA_API_KEY", "d1")
    monkeypatch.setenv("EMBEDDING_URL", "http://emb:80")
    monkeypatch.setattr(eng, "_embed_post_json", lambda url, payload, timeout: [[0.5, 0.5]])
    monkeypatch.setattr(eng, "_host_post_json", lambda *a, **k: (200, {"data": [{"embedding": [1.0] * 768}]}))
    assert eng._embed_query_sync("q") == [0.5, 0.5]  # TEI fallback
    assert not key_rotation.COOLDOWNS.cooling("deepinfra-embed", "DEEPINFRA_API_KEY")


def test_network_error_cools_the_slot(monkeypatch):
    monkeypatch.setenv("EMBED_BACKEND", "cf")
    monkeypatch.setenv("CF_ACCOUNT_ID", "a")
    monkeypatch.setenv("CF_AI_TOKEN", "t")

    def boom(*a, **k):
        raise urllib.error.URLError("down")

    monkeypatch.setattr(eng, "_cf_post_json", boom)
    assert eng._embed_query_sync("q") is None
    assert key_rotation.COOLDOWNS.cooling("cf-embed", "CF_AI_TOKEN")


def test_remote_hosts_unused_on_default_tei_backend(monkeypatch):
    monkeypatch.setenv("DEEPINFRA_API_KEY", "d1")
    monkeypatch.setenv("EMBEDDING_URL", "http://emb:80")
    monkeypatch.setattr(eng, "_embed_post_json", lambda url, payload, timeout: [[0.1]])

    def must_not_run(*a, **k):
        raise AssertionError("remote hosts are opt-in via EMBED_BACKEND=cf")

    monkeypatch.setattr(eng, "_host_post_json", must_not_run)
    assert eng._embed_query_sync("q") == [0.1]


def test_cf_post_json_returns_http_error_status(monkeypatch):
    def raise_429(request, timeout=None):
        raise urllib.error.HTTPError(request.full_url, 429, "rate", {}, None)

    monkeypatch.setattr("urllib.request.urlopen", raise_429)
    assert eng._cf_post_json("https://x", {}, 1.0, "t") == (429, {})


# ---------------------------------------------------------------------------
# Qdrant Cloud: next cluster on a failing answer, per-cluster health
# ---------------------------------------------------------------------------

CLOUD = "https://c1.cloud.qdrant.io:6333"
CLOUD2 = "https://c2.cloud.qdrant.io:6333"


def test_failing_cloud_cluster_moves_to_the_next_and_health_reports_it(monkeypatch):
    monkeypatch.setenv("QDRANT_CLOUD_URL", CLOUD)
    monkeypatch.setenv("QDRANT_CLOUD_API_KEY", SECRET)
    monkeypatch.setenv("QDRANT_CLOUD_URL_2", CLOUD2)
    calls = []

    class Resp:
        def __init__(self, status):
            self.status_code = status

        def json(self):
            return {"result": [{"score": 0.9, "payload": {"law_name": "z"}}]}

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            calls.append(url)
            if url.startswith(CLOUD2):
                return Resp(200)
            if url.startswith(CLOUD):
                return Resp(503)
            raise ConnectionError("refused")

    monkeypatch.setitem(sys.modules, "httpx", types.SimpleNamespace(AsyncClient=Client))
    rows = asyncio.run(eng._qdrant_vector_search_httpx([0.1], "iran_laws_v3", 5))
    assert rows[0]["law_name"] == "z"
    assert calls[-2].startswith(CLOUD) and calls[-1].startswith(CLOUD2)

    health = {r["label"]: r for r in qc.cloud_health()}
    assert health["qdrant-cloud"]["status"] == "failing"
    assert health["qdrant-cloud"]["last_error"] == "HTTP 503"
    assert health["qdrant-cloud"]["api_key_set"] is True
    assert health["qdrant-cloud-2"]["status"] == "ok"
    dumped = json.dumps(qc.cloud_health())
    assert SECRET not in dumped and "c1.cloud" not in dumped
    assert eng.qdrant_fallback_state()["cloud_clusters"] == qc.cloud_health()


def test_local_host_non_200_still_ends_the_read(monkeypatch):
    calls = []

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            calls.append(url)
            return types.SimpleNamespace(status_code=500, json=lambda: {})

    monkeypatch.setitem(sys.modules, "httpx", types.SimpleNamespace(AsyncClient=Client))
    assert asyncio.run(eng._qdrant_vector_search_httpx([0.1], "c", 5)) is None
    assert len(calls) == 1


def test_probe_clusters_records_each(monkeypatch):
    monkeypatch.setenv("QDRANT_CLOUD_URL", CLOUD)
    monkeypatch.setenv("QDRANT_CLOUD_URL_2", CLOUD2)

    class _Resp(io.BytesIO):
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(request, timeout=None):
        assert request.get_method() == "GET" and request.full_url.endswith("/collections")
        if request.full_url.startswith(CLOUD2):
            raise urllib.error.HTTPError(request.full_url, 401, "no", {}, None)
        return _Resp(b"{}")

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    rows = {r["label"]: r for r in qc.probe_clusters()}
    assert rows["qdrant-cloud"]["status"] == "ok"
    assert rows["qdrant-cloud-2"]["status"] == "failing" and rows["qdrant-cloud-2"]["last_error"] == "HTTP 401"


def test_unused_clusters_report_unused(monkeypatch):
    monkeypatch.setenv("QDRANT_CLOUD_URL", CLOUD)
    assert [r["status"] for r in qc.cloud_health()] == ["unused"]
    assert qc.cloud_health() and qc.cloud_health()[0]["requests"] == 0


# ---------------------------------------------------------------------------
# TTS: edge-tts first, then the Azure Speech key slots
# ---------------------------------------------------------------------------


def _edge_fails(monkeypatch, exc=None):
    async def edge(text, voice, rate, timeout=0):
        raise exc or RuntimeError("edge down")

    monkeypatch.setattr(voice_tts, "edge_mp3", edge)


def _install(monkeypatch, handler):
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(*args, **kwargs)

    monkeypatch.setattr(voice_tts.httpx, "AsyncClient", factory)


def test_edge_ok_never_calls_azure(monkeypatch):
    monkeypatch.setenv("AZURE_SPEECH_KEY", "az1")
    monkeypatch.setenv("AZURE_SPEECH_REGION", "westeurope")

    async def edge(text, voice, rate, timeout=0):
        return b"m" * 500

    monkeypatch.setattr(voice_tts, "edge_mp3", edge)
    _install(monkeypatch, lambda r: (_ for _ in ()).throw(AssertionError("azure called")))
    assert asyncio.run(voice_tts.synthesize_mp3("سلام")) == (b"m" * 500, "edge-tts")


def test_no_azure_configured_is_inert(monkeypatch):
    _edge_fails(monkeypatch)
    assert voice_tts.azure_slots() == []
    assert asyncio.run(voice_tts.synthesize_mp3("سلام")) == (b"", "")


def test_edge_fails_then_azure_second_key_after_429(monkeypatch, capsys):
    _edge_fails(monkeypatch, ImportError("no edge_tts"))
    monkeypatch.setenv("AZURE_SPEECH_KEY", SECRET)
    monkeypatch.setenv("AZURE_SPEECH_REGION", "westeurope")
    monkeypatch.setenv("AZURE_SPEECH_KEY_2", "az2")
    monkeypatch.setenv("AZURE_SPEECH_REGION_2", "eastus")
    monkeypatch.setenv("AZURE_SPEECH_KEY_3", "az3")
    monkeypatch.setenv("AZURE_SPEECH_REGION_3", "bad region!")  # invalid: slot skipped
    seen = []

    def handler(request: httpx.Request):
        seen.append((request.url.host, request.headers["ocp-apim-subscription-key"]))
        assert request.headers["x-microsoft-outputformat"] == voice_tts.AZURE_FORMAT
        body = request.content.decode()
        assert "fa-IR-FaridNeural" in body and "&lt;b&gt;" in body
        if request.headers["ocp-apim-subscription-key"] == SECRET:
            return httpx.Response(429)
        return httpx.Response(200, content=b"a" * 400)

    _install(monkeypatch, handler)
    audio, provider = asyncio.run(voice_tts.synthesize_mp3("<b>ماده</b>"))
    assert (audio, provider) == (b"a" * 400, "azure-tts")
    assert seen == [("westeurope.tts.speech.microsoft.com", SECRET), ("eastus.tts.speech.microsoft.com", "az2")]
    assert key_rotation.COOLDOWNS.cooling("azure-tts", "AZURE_SPEECH_KEY")
    assert SECRET not in capsys.readouterr().err


def test_ssml_rate_is_validated():
    assert "prosody rate='+0%'" in voice_tts._ssml("x", "fa-IR-FaridNeural", "fast'><x")
    assert "prosody rate='+22%'" in voice_tts._ssml("x", "fa-IR-FaridNeural", "+22%")


# ---------------------------------------------------------------------------
# same-vector-space guard for fallback embedding providers
# ---------------------------------------------------------------------------


def _guard_env(monkeypatch):
    monkeypatch.setenv("EMBED_BACKEND", "cf")
    monkeypatch.setenv("CF_ACCOUNT_ID", "acct-1")
    monkeypatch.setenv("CF_AI_TOKEN", "t1")
    monkeypatch.setenv("DEEPINFRA_API_KEY", "d1")


def test_fallback_provider_in_same_vector_space_is_confirmed_once_per_process(monkeypatch):
    _guard_env(monkeypatch)
    cf_up = {"up": True}
    host_calls = []

    def cf_post(url, payload, timeout, token):
        return (200, {"result": {"data": [_vec(1.0, 0.0)]}}) if cf_up["up"] else (503, {})

    def host_post(url, payload, timeout, token):
        host_calls.append(payload["input"])
        return 200, {"data": [{"index": 0, "embedding": _vec(1.0, 0.001)}]}  # cosine ~ 1.0

    monkeypatch.setattr(eng, "_cf_post_json", cf_post)
    monkeypatch.setattr(eng, "_host_post_json", host_post)
    eng._embed_query_sync("warm")  # primary answers: the guard is not consulted
    assert host_calls == []
    cf_up["up"] = False
    key_rotation.COOLDOWNS.reset()
    cf_up["up"] = True
    # primary now fails (429 -> cools); fallback must pass the probe check, which needs the primary reference
    monkeypatch.setattr(eng, "_cf_post_json", lambda url, payload, timeout, token: (
        (200, {"result": {"data": [_vec(1.0, 0.0)]}}) if payload["text"] == [eng.EMBED_GUARD_PROBE] else (503, {})))
    assert eng._embed_query_sync("q1")[0] > 0.99
    assert host_calls == [[eng.EMBED_GUARD_PROBE], ["q1"]]
    key_rotation.COOLDOWNS.reset()
    eng._embed_query_sync("q2")
    assert host_calls[2:] == [["q2"]]  # verdict cached: no second probe


def test_fallback_in_a_different_vector_space_is_disabled(monkeypatch, caplog):
    _guard_env(monkeypatch)
    monkeypatch.setattr(eng, "_cf_post_json", lambda url, payload, timeout, token: (
        (200, {"result": {"data": [_vec(1.0, 0.0)]}}) if payload["text"] == [eng.EMBED_GUARD_PROBE] else (503, {})))
    host_calls = []

    def host_post(url, payload, timeout, token):  # same dims, orthogonal space (e.g. another 1024-dim model)
        host_calls.append(payload["input"])
        return 200, {"data": [{"index": 0, "embedding": _vec(0.0, 1.0)}]}

    monkeypatch.setattr(eng, "_host_post_json", host_post)
    with caplog.at_level(logging.WARNING):
        assert eng._embed_query_sync("q1") is None  # no TEI configured: nothing may answer
    assert host_calls == [[eng.EMBED_GUARD_PROBE]]  # only the probe, never the real query
    assert eng._embed_guard_verdict == {"deepinfra-embed": False}
    assert "disabled" in caplog.text
    key_rotation.COOLDOWNS.reset()
    assert eng._embed_query_sync("q2") is None
    assert host_calls == [[eng.EMBED_GUARD_PROBE]]  # stays off for the process


def test_fallback_is_not_used_while_the_primary_reference_is_unavailable(monkeypatch):
    _guard_env(monkeypatch)
    monkeypatch.setattr(eng, "_cf_post_json", lambda *a, **k: (503, {}))
    monkeypatch.setattr(eng, "_host_post_json", lambda *a, **k: (_ for _ in ()).throw(AssertionError("unconfirmed")))
    assert eng._embed_query_sync("q") is None
    assert eng._embed_guard_verdict == {}  # no verdict cached: retried once a reference exists


def test_cosine_helper():
    assert eng._cosine([1.0, 0.0], [2.0, 0.0]) == 1.0
    assert eng._cosine([1.0, 0.0], [0.0, 1.0]) == 0.0
    assert eng._cosine([1.0], [1.0, 2.0]) == -1.0
    assert eng._cosine([0.0, 0.0], [1.0, 0.0]) == -1.0


# ---------------------------------------------------------------------------
# TTS in smartjudge_module: inline edge-tts by default, Azure only when its key env is set
# ---------------------------------------------------------------------------


def _fake_edge(monkeypatch, audio=b"e" * 500):
    class Communicate:
        def __init__(self, text, voice, rate=None):
            pass

        async def stream(self):
            yield {"type": "audio", "data": audio}

    monkeypatch.setitem(sys.modules, "edge_tts", types.SimpleNamespace(Communicate=Communicate))


def _sj():
    from output_apps.generated_modules.smartjudge import smartjudge_module as m

    return m


def test_voice_pcm_default_uses_inline_edge_and_never_touches_azure(monkeypatch):
    m = _sj()
    for name in ("AZURE_SPEECH_KEY", "AZURE_SPEECH_KEY_2", "AZURE_SPEECH_REGION"):
        monkeypatch.delenv(name, raising=False)
    _fake_edge(monkeypatch)
    monkeypatch.setattr(m, "_tts_mp3_to_pcm16", lambda b: b"pcm:" + b[:1])

    async def boom(*a, **k):
        raise AssertionError("Azure path must not run without a key")

    monkeypatch.setattr(m._voice_tts, "synthesize_mp3", boom)
    assert m._azure_tts_configured() is False
    assert asyncio.run(m._voice_synthesize_pcm16("سلام")) == b"pcm:e"


def test_voice_pcm_azure_error_falls_back_to_inline_edge(monkeypatch):
    m = _sj()
    monkeypatch.setenv("AZURE_SPEECH_KEY", "az")
    monkeypatch.setenv("AZURE_SPEECH_REGION", "westeurope")
    _fake_edge(monkeypatch)
    monkeypatch.setattr(m, "_tts_mp3_to_pcm16", lambda b: b"pcm:" + b[:1])

    async def boom(*a, **k):
        raise RuntimeError("azure down")

    monkeypatch.setattr(m._voice_tts, "synthesize_mp3", boom)
    assert m._azure_tts_configured() is True
    assert asyncio.run(m._voice_synthesize_pcm16("سلام")) == b"pcm:e"
