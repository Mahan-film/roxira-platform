"""Unit tests for T251 local Persian TTS adapter & fallback chain."""

from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, patch

import output_apps.generated_modules.smartjudge.voice_tts as voice_tts
from output_apps.generated_modules.smartjudge.voice_tts import (
    local_sherpa_tts,
    synthesize_mp3,
)


def test_synthesize_mp3_normalizes_persian_speech():
    """Verify that synthesize_mp3 runs normalize_persian_speech on input."""

    async def _run():
        raw_text = "طبق ماده ۱۲ ق.م. در تاریخ ۱۴۰۳/۰۸/۱۵ اقدام شد."
        with patch(
            "output_apps.generated_modules.smartjudge.voice_tts.edge_mp3",
            new_callable=AsyncMock,
        ) as mock_edge:
            mock_edge.return_value = b"X" * 300
            audio, provider = await synthesize_mp3(raw_text)
            assert provider == "edge-tts"
            assert len(audio) == 300
            mock_edge.assert_called_once()
            called_text = mock_edge.call_args[0][0]
            # Should be normalized:
            assert "ماده دوازده" in called_text
            assert "قانون مدنی" in called_text
            assert "پانزدهم آبان هزار و چهارصد و سه" in called_text

    asyncio.run(_run())


def test_synthesize_mp3_local_sherpa_when_enabled():
    """Verify that when LOCAL_TTS_ENABLED=1 and sherpa succeeds, sherpa-onnx is selected."""

    async def _run():
        fake_wav = b"RIFF" + b"\x00" * 300
        with patch.object(voice_tts, "LOCAL_TTS_ENABLED", True):
            with patch(
                "output_apps.generated_modules.smartjudge.voice_tts.local_sherpa_tts",
                return_value=fake_wav,
            ) as mock_sherpa:
                with patch(
                    "output_apps.generated_modules.smartjudge.voice_tts.edge_mp3",
                    new_callable=AsyncMock,
                ) as mock_edge:
                    audio, provider = await synthesize_mp3("سلام و درود.")
                    assert provider == "sherpa-onnx"
                    assert audio == fake_wav
                    mock_sherpa.assert_called_once()
                    mock_edge.assert_not_called()

    asyncio.run(_run())


def test_synthesize_mp3_fallback_when_local_fails():
    """Verify seamless fallback from sherpa-onnx to edge-tts when local synthesis fails."""

    async def _run():
        fake_edge_mp3 = b"ID3" + b"\x00" * 300
        with patch.object(voice_tts, "LOCAL_TTS_ENABLED", True):
            with patch(
                "output_apps.generated_modules.smartjudge.voice_tts.local_sherpa_tts",
                return_value=None,
            ):
                with patch(
                    "output_apps.generated_modules.smartjudge.voice_tts.edge_mp3",
                    new_callable=AsyncMock,
                    return_value=fake_edge_mp3,
                ) as mock_edge:
                    audio, provider = await synthesize_mp3("تست بازگشت به اج-تی‌تی‌اس.")
                    assert provider == "edge-tts"
                    assert audio == fake_edge_mp3
                    mock_edge.assert_called_once()

    asyncio.run(_run())


def test_local_sherpa_tts_disabled_by_default():
    """When LOCAL_TTS_ENABLED is False, local_sherpa_tts immediately returns None."""
    with patch.object(voice_tts, "LOCAL_TTS_ENABLED", False):
        res = local_sherpa_tts("سلام")
        assert res is None


def test_local_sherpa_tts_handles_missing_model():
    """When LOCAL_TTS_ENABLED is True but model files are absent, returns None without crashing."""
    with patch.object(voice_tts, "LOCAL_TTS_ENABLED", True):
        with patch.dict(
            os.environ,
            {
                "SHERPA_TTS_MODEL": "/nonexistent/model.onnx",
                "SHERPA_TTS_TOKENS": "/nonexistent/tokens.txt",
            },
        ):
            res = local_sherpa_tts("متن نمونه")
            assert res is None
