"""Offline tests for the voice reliability fixes (docs/ops/VOICE_DIAGNOSIS_2026-10-11.md).

No network, no API key, no faster-whisper: httpx is replaced by MockTransport and the
local model by a stub. Nothing here runs at import time.
"""

from __future__ import annotations

import asyncio
import json
import time

import httpx
import pytest

from output_apps.generated_modules.smartjudge import key_rotation, model_registry, voice_stt


@pytest.fixture(autouse=True)
def _only_the_openrouter_key_passed_in(monkeypatch):
    """These tests cover the OpenRouter chain: no key slot from the environment, fresh cooldowns."""
    for base in ("ASSEMBLYAI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY"):
        for name in (base, f"{base}_2", f"{base}_3", f"{base}_4"):
            monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("ASSEMBLYAI_API_KEYS", raising=False)
    monkeypatch.delenv("VOICE_STT_ORDER", raising=False)
    key_rotation.COOLDOWNS.reset()
    yield
    key_rotation.COOLDOWNS.reset()


def _install_transport(monkeypatch, handler):
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(*args, **kwargs)

    monkeypatch.setattr(voice_stt.httpx, "AsyncClient", factory)


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# model chain
# ---------------------------------------------------------------------------


def test_registry_stt_primary_is_the_model_production_actually_uses():
    ids = model_registry.role_models("stt")
    assert ids[0] == "openai/whisper-large-v3"
    assert "openai/whisper-large-v3-turbo" in ids


def test_stt_model_chain_skips_chat_audio_models_and_dedupes():
    chain = voice_stt.stt_model_chain()
    assert chain[0] == "openai/whisper-large-v3"
    assert all("whisper" in m for m in chain)
    assert len(chain) == len(set(chain))


def test_stt_model_chain_survives_a_broken_registry(monkeypatch):
    def boom(_role):
        raise RuntimeError("no yaml")

    monkeypatch.setattr(model_registry, "role_models", boom)
    assert voice_stt.stt_model_chain() == voice_stt._FALLBACK_CHAIN


# ---------------------------------------------------------------------------
# remote providers
# ---------------------------------------------------------------------------


def test_success_on_first_model(monkeypatch):
    seen = []

    def handler(request: httpx.Request):
        seen.append(json.loads(request.content)["model"])
        return httpx.Response(200, json={"text": "سلام"})

    _install_transport(monkeypatch, handler)
    res = _run(voice_stt.transcribe(b"x" * 2000, "m4a", api_key="k", local_fallback=None))
    assert (res.text, res.reachable, res.provider) == ("سلام", True, "openai/whisper-large-v3")
    assert seen == ["openai/whisper-large-v3"]


def test_429_moves_to_next_model_without_trying_multipart(monkeypatch):
    calls = []

    def handler(request: httpx.Request):
        ctype = request.headers.get("content-type", "")
        calls.append("json" if ctype.startswith("application/json") else "multipart")
        if len(calls) == 1:
            return httpx.Response(429, json={"error": "rate"})
        return httpx.Response(200, json={"text": "متن"})

    _install_transport(monkeypatch, handler)
    res = _run(voice_stt.transcribe(b"x" * 2000, "webm", api_key="k", local_fallback=None))
    assert res.text == "متن"
    assert calls == ["json", "json"]


def test_422_on_json_falls_back_to_multipart_same_model(monkeypatch):
    calls = []

    def handler(request: httpx.Request):
        ctype = request.headers.get("content-type", "")
        calls.append("json" if ctype.startswith("application/json") else "multipart")
        if ctype.startswith("application/json"):
            return httpx.Response(422, json={"error": "shape"})
        return httpx.Response(200, json={"text": "ok"})

    _install_transport(monkeypatch, handler)
    res = _run(voice_stt.transcribe(b"x" * 2000, "m4a", api_key="k", local_fallback=None))
    assert res.text == "ok"
    assert calls == ["json", "multipart"]


def test_empty_text_from_a_working_provider_is_silence_not_an_outage(monkeypatch):
    _install_transport(monkeypatch, lambda r: httpx.Response(200, json={"text": ""}))
    res = _run(voice_stt.transcribe(b"x" * 2000, "m4a", api_key="k", local_fallback=None))
    assert res.text == "" and res.reachable is True


def test_total_outage_is_reported_unreachable(monkeypatch):
    _install_transport(monkeypatch, lambda r: httpx.Response(503, text="down"))
    res = _run(voice_stt.transcribe(b"x" * 2000, "m4a", api_key="k", local_fallback=None))
    assert res.text == "" and res.reachable is False and res.error


def test_no_api_key_goes_straight_to_local():
    res = _run(voice_stt.transcribe(b"x", "wav", api_key="", local_fallback=lambda a, e, d: "محلی"))
    assert (res.text, res.provider) == ("محلی", "local-whisper")


# ---------------------------------------------------------------------------
# local fallback must not freeze the event loop, and must respect the budget
# ---------------------------------------------------------------------------


def test_local_fallback_runs_off_the_event_loop(monkeypatch):
    _install_transport(monkeypatch, lambda r: httpx.Response(500))

    def slow_local(audio, ext, deadline):
        time.sleep(0.4)  # would freeze the loop if called inline
        return "کند"

    async def scenario():
        ticks = 0

        async def ticker():
            nonlocal ticks
            while True:
                await asyncio.sleep(0.02)
                ticks += 1

        t = asyncio.create_task(ticker())
        res = await voice_stt.transcribe(b"x" * 2000, "m4a", api_key="k", local_fallback=slow_local)
        t.cancel()
        return res, ticks

    res, ticks = _run(scenario())
    assert res.text == "کند"
    assert ticks >= 5, "event loop was blocked while the local model ran"


def test_local_fallback_skipped_when_budget_is_spent(monkeypatch):
    _install_transport(monkeypatch, lambda r: httpx.Response(500))
    called = []

    def local(audio, ext, deadline):
        called.append(1)
        return "x"

    res = _run(voice_stt.transcribe(b"x" * 2000, "m4a", api_key="k", local_fallback=local, budget_s=3.0))
    assert called == [] and res.text == ""


def test_empty_audio_never_calls_anything():
    res = _run(voice_stt.transcribe(b"", "m4a", api_key="k"))
    assert res.text == "" and res.error == "empty"


# ---------------------------------------------------------------------------
# live-voice socket: non-fatal notices and keepalive
# ---------------------------------------------------------------------------


class _FakeWS:
    def __init__(self):
        self.sent = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))


def test_live_voice_notice_and_keepalive(monkeypatch):
    from output_apps.ecosystem_core.src.factory import smartjudge_live_voice as lv

    ws = _FakeWS()
    _run(lv._notice(ws, "NO_SPEECH", lv.MSG_NO_SPEECH))
    assert ws.sent[0]["event"] == "notice" and ws.sent[0]["code"] == "NO_SPEECH"

    monkeypatch.setattr(lv, "KEEPALIVE_SECONDS", 0.01)

    async def scenario():
        task = asyncio.create_task(lv._keepalive(ws))
        await asyncio.sleep(0.08)
        task.cancel()

    _run(scenario())
    assert any(m == {"event": "ping"} for m in ws.sent)


def test_live_voice_tts_and_llm_timeouts_are_not_the_old_2_8_seconds():
    import inspect

    from output_apps.ecosystem_core.src.factory import smartjudge_live_voice as lv

    src = inspect.getsource(lv.synthesize_speech_persian)
    assert "timeout=2.8" not in src


def test_empty_text_on_long_clip_asks_the_next_model(monkeypatch):
    seen = []

    def handler(request: httpx.Request):
        seen.append(json.loads(request.content)["model"])
        return httpx.Response(200, json={"text": "" if len(seen) == 1 else "گفتار واقعی"})

    _install_transport(monkeypatch, handler)
    res = _run(voice_stt.transcribe(b"x" * 40_000, "m4a", api_key="k", local_fallback=None))
    assert res.text == "گفتار واقعی" and len(seen) == 2


def test_all_providers_empty_on_long_clip_is_no_speech(monkeypatch):
    _install_transport(monkeypatch, lambda r: httpx.Response(200, json={"text": ""}))
    res = _run(voice_stt.transcribe(b"x" * 40_000, "m4a", api_key="k", local_fallback=None))
    assert res.text == "" and res.reachable is True


def test_empty_text_on_short_clip_is_believed_immediately(monkeypatch):
    seen = []

    def handler(request: httpx.Request):
        seen.append(1)
        return httpx.Response(200, json={"text": ""})

    _install_transport(monkeypatch, handler)
    res = _run(voice_stt.transcribe(b"x" * 2000, "m4a", api_key="k", local_fallback=None))
    assert res.reachable is True and len(seen) == 1
