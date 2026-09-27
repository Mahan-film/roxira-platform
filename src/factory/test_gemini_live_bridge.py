"""Offline unit tests for W20's Gemini Live realtime voice path
(output_apps/ecosystem_core/src/factory/gemini_live_bridge.py) and the
VOICE_REALTIME_PROVIDER branch in smartjudge_live_voice.py.

No real network calls, no real GEMINI_API_KEY, and `google-genai` does not
need to be installed to run these -- a fake `google.genai` module is
injected into sys.modules before the module under test is loaded, same as
tests elsewhere in this repo stub optional heavy dependencies. Mocked
websockets only (a tiny fake with .accept()/.receive()/.send_text()), per
docs/W20_realtime_voice.md and the task's offline-tests requirement.

Both modules live under output_apps/, outside pytest's `testpaths = ["src"]`
(pyproject.toml), so they are loaded dynamically by path -- same pattern as
src/factory/test_persian_sentence_split.py.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

FACTORY_DIR = Path(__file__).resolve().parents[2] / "output_apps" / "ecosystem_core" / "src" / "factory"


def _load_module_by_path(name: str, filename: str):
    module_path = FACTORY_DIR / filename
    spec = importlib.util.spec_from_file_location(name, module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _install_fake_google_genai() -> MagicMock:
    """Injects a minimal fake `google.genai` package into sys.modules so
    gemini_live_bridge.py's `from google import genai` / `from google.genai
    import types` succeed without the real SDK installed. Returns the fake
    `genai` module so a test can configure `genai.Client`."""
    google_pkg = types.ModuleType("google")
    genai_mod = types.ModuleType("google.genai")
    genai_types_mod = types.ModuleType("google.genai.types")

    # Bare attribute stand-ins -- tests only need these to be constructible
    # and to round-trip whatever kwargs they were given, not to behave like
    # the real SDK's validated dataclasses.
    class _Kwargs:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    for cls_name in (
        "LiveConnectConfig", "AudioTranscriptionConfig", "SpeechConfig",
        "VoiceConfig", "PrebuiltVoiceConfig", "Content", "Part", "Blob",
    ):
        setattr(genai_types_mod, cls_name, type(cls_name, (_Kwargs,), {}))
    genai_types_mod.Part.from_text = staticmethod(lambda text: genai_types_mod.Part(text=text))

    genai_mod.types = genai_types_mod
    genai_mod.Client = MagicMock()
    google_pkg.genai = genai_mod

    sys.modules["google"] = google_pkg
    sys.modules["google.genai"] = genai_mod
    sys.modules["google.genai.types"] = genai_types_mod
    return genai_mod


class FakeWebSocket:
    """Enough of starlette's WebSocket surface for run_gemini_realtime_session:
    outbound text messages are recorded; inbound "receive" messages are fed
    in from a queue built by the test (mirroring the {"bytes": ...} /
    {"text": ...} / {"type": "websocket.disconnect"} shapes the real
    websocket.receive() returns)."""

    def __init__(self, inbound: list[dict]):
        self._inbound = list(inbound)
        self.sent: list[dict] = []

    async def receive(self):
        if not self._inbound:
            return {"type": "websocket.disconnect"}
        return self._inbound.pop(0)

    async def send_text(self, text: str):
        self.sent.append(json.loads(text))


@pytest.fixture()
def bridge(monkeypatch):
    monkeypatch.delenv("VOICE_REALTIME_MODEL", raising=False)
    fake_genai = _install_fake_google_genai()
    module = _load_module_by_path("gemini_live_bridge_under_test", "gemini_live_bridge.py")
    return module, fake_genai


def test_model_id_defaults_to_registry_primary(bridge):
    module, _ = bridge
    # config/models.yaml's voice_realtime role primary as of this PR.
    assert module._model_id() == "gemini-3.8-live"


def test_model_id_env_override_wins(bridge, monkeypatch):
    module, _ = bridge
    monkeypatch.setenv("VOICE_REALTIME_MODEL", "gemini-3.1-flash-live-preview")
    assert module._model_id() == "gemini-3.1-flash-live-preview"


def test_no_api_key_sends_error_and_turn_complete(bridge):
    module, _ = bridge
    import os

    async def run():
        old = os.environ.pop("GEMINI_API_KEY", None)
        try:
            ws = FakeWebSocket(inbound=[])
            await module.run_gemini_realtime_session(ws)
            return ws.sent
        finally:
            if old is not None:
                os.environ["GEMINI_API_KEY"] = old

    sent = asyncio.run(run())
    assert sent[0]["event"] == "error"
    assert sent[-1]["event"] == "turn_complete"


def test_fetch_legal_context_returns_empty_on_failure(bridge, monkeypatch):
    module, _ = bridge
    # Force the internal import to fail deterministically (no real Postgres/
    # Qdrant graph reachable offline) by pointing it at a broken stand-in
    # module, instead of relying on whatever happens to be importable in
    # this environment. _fetch_legal_context must swallow the failure, not
    # propagate it.
    broken = types.ModuleType("output_apps.generated_modules.smartjudge.smartjudge_module")

    def _raise(*a, **kw):
        raise RuntimeError("no graph in offline test")

    broken.aquery_knowledge_graph = _raise
    monkeypatch.setitem(
        sys.modules, "output_apps.generated_modules.smartjudge.smartjudge_module", broken
    )
    result = asyncio.run(module._fetch_legal_context("سوال آزمایشی"))
    assert result == ""


def test_fetch_legal_context_returns_formatted_text_on_success(bridge, monkeypatch):
    module, _ = bridge
    fake = types.ModuleType("output_apps.generated_modules.smartjudge.smartjudge_module")

    async def _ok(query_text, limit=3):
        return (["قانون مدنی ماده ۱۰"], ["رای وحدت رویه ۸۰۰"])

    fake.aquery_knowledge_graph = _ok
    monkeypatch.setitem(
        sys.modules, "output_apps.generated_modules.smartjudge.smartjudge_module", fake
    )
    result = asyncio.run(module._fetch_legal_context("سوال آزمایشی"))
    assert "قانون مدنی ماده ۱۰" in result
    assert "رای وحدت رویه ۸۰۰" in result


def _make_fake_session(events, sent_client_content: list):
    """A fake google-genai Live session: `receive()` is an async generator
    yielding the given fake server events; `send_client_content` and
    `send_realtime_input` just record calls."""

    class FakeSession:
        async def receive(self):
            for ev in events:
                yield ev

        async def send_client_content(self, **kwargs):
            sent_client_content.append(kwargs)

        async def send_realtime_input(self, **kwargs):
            pass

    return FakeSession()


def test_full_turn_streams_transcript_audio_and_injects_rag_context(bridge, monkeypatch):
    module, fake_genai = bridge

    async def fake_fetch_context(query_text: str) -> str:
        return f"context-for:{query_text}"

    monkeypatch.setattr(module, "_fetch_legal_context", fake_fetch_context)

    server_content_with_transcript = types.SimpleNamespace(
        input_transcription=types.SimpleNamespace(text="سلام"),
        output_transcription=None,
        turn_complete=False,
    )
    server_content_with_reply = types.SimpleNamespace(
        input_transcription=None,
        output_transcription=types.SimpleNamespace(text="پاسخ کوتاه"),
        turn_complete=False,
    )
    server_content_done = types.SimpleNamespace(
        input_transcription=None, output_transcription=None, turn_complete=True,
    )

    events = [
        types.SimpleNamespace(server_content=server_content_with_transcript, data=None),
        types.SimpleNamespace(server_content=server_content_with_reply, data=None),
        types.SimpleNamespace(server_content=None, data=b"\x00\x01\x02\x03"),
        types.SimpleNamespace(server_content=server_content_done, data=None),
    ]
    sent_client_content: list = []
    fake_session = _make_fake_session(events, sent_client_content)

    class FakeLiveConnectCM:
        async def __aenter__(self_inner):
            return fake_session

        async def __aexit__(self_inner, *exc):
            return False

    fake_genai.Client.return_value = MagicMock(
        aio=MagicMock(live=MagicMock(connect=MagicMock(return_value=FakeLiveConnectCM())))
    )

    ws = FakeWebSocket(inbound=[{"type": "websocket.disconnect"}])

    import os

    old = os.environ.get("GEMINI_API_KEY")
    os.environ["GEMINI_API_KEY"] = "test-key-not-real"
    try:
        asyncio.run(module.run_gemini_realtime_session(ws))
    finally:
        if old is None:
            os.environ.pop("GEMINI_API_KEY", None)
        else:
            os.environ["GEMINI_API_KEY"] = old

    events_seen = [m["event"] for m in ws.sent]
    assert "user_transcription" in events_seen
    assert "agent_text_response" in events_seen
    assert "agent_audio_stream" in events_seen
    assert "turn_complete" in events_seen

    audio_msg = next(m for m in ws.sent if m["event"] == "agent_audio_stream")
    assert audio_msg["mime"] == "audio/pcm;rate=24000"

    # RAG context must have been sent as a non-turn-completing client
    # content turn, keyed off the transcribed user text.
    assert len(sent_client_content) == 1
    assert sent_client_content[0]["turn_complete"] is False
