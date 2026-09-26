"""Unit tests for output_apps/ecosystem_core/src/factory/stt_engine.py (W15).

Covers the STT fallback chain: it must come from config/models.yaml's `stt`
role (not the retired, hardcoded google/gemini-2.0-flash-001 id this replaces
-- see config/models.yaml's `stt` role note and issue #39), fall through to a
safe hardcoded default if the registry can't be read, try each model in
order on failure, and log a warning whenever a non-primary model is used.

All HTTP is mocked (no network, no API key, no real audio/ffmpeg). Safe for
`pytest -m "not integration"`.

stt_engine.py lives under output_apps/, outside pytest's `testpaths = ["src"]`
(see pyproject.toml), so it is loaded dynamically inside a fixture rather than
imported at module level -- see src/factory/test_agent_runner.py for the same
pattern and src/ci_quarantine.py for why module-level side effects in a
src/test_*.py file are forbidden.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

stt_engine = None  # populated by _load_stt_engine() before any test runs


@pytest.fixture(scope="session", autouse=True)
def _load_stt_engine():
    global stt_engine
    if stt_engine is None:
        module_path = (
            Path(__file__).resolve().parents[1]
            / "output_apps"
            / "ecosystem_core"
            / "src"
            / "factory"
            / "stt_engine.py"
        )
        spec = importlib.util.spec_from_file_location("stt_engine", module_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["stt_engine"] = module
        spec.loader.exec_module(module)
        stt_engine = module
    return stt_engine


# ---------------------------------------------------------------------------
# _stt_model_chain: registry-driven, never the dead gemini id, never raises
# ---------------------------------------------------------------------------


def test_default_chain_never_contains_the_retired_gemini_id():
    assert "google/gemini-2.0-flash-001" not in stt_engine._DEFAULT_STT_CHAIN


def test_chain_uses_registry_when_available():
    with patch(
        "output_apps.generated_modules.smartjudge.model_registry.role_models",
        return_value=["vendor/primary-stt", "vendor/fallback-stt"],
    ):
        assert stt_engine._stt_model_chain() == ["vendor/primary-stt", "vendor/fallback-stt"]


def test_chain_falls_back_to_default_when_registry_raises():
    with patch(
        "output_apps.generated_modules.smartjudge.model_registry.role_models",
        side_effect=RuntimeError("config/models.yaml is missing"),
    ):
        assert stt_engine._stt_model_chain() == stt_engine._DEFAULT_STT_CHAIN


def test_chain_falls_back_to_default_when_registry_import_fails():
    # Simulates PyYAML not being installed / the module not existing.
    with patch.dict(sys.modules, {"output_apps.generated_modules.smartjudge.model_registry": None}):
        assert stt_engine._stt_model_chain() == stt_engine._DEFAULT_STT_CHAIN


def test_chain_falls_back_to_default_when_registry_returns_empty():
    with patch(
        "output_apps.generated_modules.smartjudge.model_registry.role_models",
        return_value=[],
    ):
        assert stt_engine._stt_model_chain() == stt_engine._DEFAULT_STT_CHAIN


def test_real_registry_stt_role_never_contains_the_retired_gemini_id():
    """The actual config/models.yaml `stt` role -- this is the whole point of
    the fix: production must never route STT to the retired id again."""
    from output_apps.generated_modules.smartjudge import model_registry

    ids = model_registry.role_models("stt")
    assert ids, "stt role has no models configured"
    assert "google/gemini-2.0-flash-001" not in ids


# ---------------------------------------------------------------------------
# _call_stt_model: request shape per model id
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, body: bytes):
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_call_stt_model_whisper_uses_transcriptions_endpoint():
    captured = {}

    def fake_urlopen(req, timeout=8):
        captured["url"] = req.full_url
        return _FakeResponse(b'{"text": "salam donya"}')

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        result = stt_engine._call_stt_model("openai/whisper-large-v3-turbo", "YWJj", {})

    assert result == "salam donya"
    assert captured["url"] == "https://openrouter.ai/api/v1/audio/transcriptions"


def test_call_stt_model_chat_model_uses_chat_completions_endpoint():
    captured = {}

    def fake_urlopen(req, timeout=8):
        captured["url"] = req.full_url
        return _FakeResponse(b'{"choices": [{"message": {"content": "hello world"}}]}')

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        result = stt_engine._call_stt_model("openai/gpt-audio", "YWJj", {})

    assert result == "hello world"
    assert captured["url"] == "https://openrouter.ai/api/v1/chat/completions"


# ---------------------------------------------------------------------------
# transcribe_audio_blob: fallback order, error handling, logging
# ---------------------------------------------------------------------------


@pytest.fixture
def valid_b64():
    import base64

    return base64.b64encode(b"fake-audio-bytes").decode("utf-8")


def _patch_common(monkeypatch, module):
    # No ffmpeg / real API key involved: get_config supplies a fake key, and
    # convert_to_wav_pcm's own ffmpeg subprocess call is bypassed.
    monkeypatch.setattr(module, "get_config", lambda: {"api_key": "test-key"})
    monkeypatch.setattr(module, "convert_to_wav_pcm", lambda b: b)
    monkeypatch.setattr(module, "phonetic_rescorer_agent", lambda t: t)


def test_transcribe_uses_primary_model_and_does_not_log_fallback(monkeypatch, valid_b64, caplog):
    _patch_common(monkeypatch, stt_engine)
    monkeypatch.setattr(stt_engine, "_stt_model_chain", lambda: ["primary/model", "backup/model"])

    calls = []

    def fake_call(model_id, clean_b64, headers):
        calls.append(model_id)
        return "متن نمونه"

    monkeypatch.setattr(stt_engine, "_call_stt_model", fake_call)

    with caplog.at_level("WARNING"):
        result = stt_engine.transcribe_audio_blob(valid_b64)

    assert result == "متن نمونه"
    assert calls == ["primary/model"]
    assert "STT-FALLBACK" not in caplog.text


def test_transcribe_falls_through_chain_and_logs_fallback(monkeypatch, valid_b64, caplog):
    _patch_common(monkeypatch, stt_engine)
    monkeypatch.setattr(stt_engine, "_stt_model_chain", lambda: ["primary/model", "backup/model"])

    def fake_call(model_id, clean_b64, headers):
        if model_id == "primary/model":
            raise RuntimeError("HTTP Error 429: Too Many Requests")
        return "recovered text"

    monkeypatch.setattr(stt_engine, "_call_stt_model", fake_call)

    with caplog.at_level("WARNING"):
        result = stt_engine.transcribe_audio_blob(valid_b64)

    assert result == "recovered text"
    assert "STT-FALLBACK" in caplog.text
    assert "backup/model" in caplog.text


def test_transcribe_all_models_fail_returns_persian_error(monkeypatch, valid_b64):
    _patch_common(monkeypatch, stt_engine)
    monkeypatch.setattr(stt_engine, "_stt_model_chain", lambda: ["primary/model", "backup/model"])

    def fake_call(model_id, clean_b64, headers):
        raise RuntimeError(f"{model_id} unreachable")

    monkeypatch.setattr(stt_engine, "_call_stt_model", fake_call)

    result = stt_engine.transcribe_audio_blob(valid_b64)

    assert result.startswith("خطا در موتور صوت")


def test_transcribe_without_api_key_returns_persian_error(monkeypatch, valid_b64):
    monkeypatch.setattr(stt_engine, "get_config", lambda: {"api_key": ""})
    result = stt_engine.transcribe_audio_blob(valid_b64)
    assert result == "خطا: کلید API در سرور یافت نشد."


def test_transcribe_bad_base64_returns_persian_error(monkeypatch):
    _patch_common(monkeypatch, stt_engine)
    result = stt_engine.transcribe_audio_blob("not-valid-base64!!!")
    assert result.startswith("خطا در دیکود فایل صوتی")
