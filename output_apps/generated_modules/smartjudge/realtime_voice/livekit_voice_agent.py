"""
Real-Time Speech-to-Speech (S2S) WebRTC Agent Interface.
Implements the LiveKit Agents paradigm:
- Low-latency Audio Stream Management (< 250ms target)
- Voice Activity Detection (VAD) with natural conversational pause
- Interruption Handling (Barge-in / User speech interrupts AI playback)
- Streaming TTS Chunks back to WebRTC / AudioContext
"""
from __future__ import annotations

import asyncio
import io
import logging
import time
from typing import AsyncGenerator, Callable, Dict, List, Optional
from dataclasses import dataclass

try:
    from ..security.pii_scrubber import (
        scrub_pii_with_counts as _scrub_pii_with_counts,
        unmask_pii_entities as _unmask_pii_entities,
    )
except ImportError:  # pragma: no cover - top-level script import
    from security.pii_scrubber import (
        scrub_pii_with_counts as _scrub_pii_with_counts,
        unmask_pii_entities as _unmask_pii_entities,
    )

logger = logging.getLogger("smartjudge.realtime_voice")


@dataclass
class AudioFrame:
    data: bytes
    sample_rate: int = 16000
    channels: int = 1
    timestamp_ms: float = 0.0


class LiveKitCompatibleVoiceAgent:
    """ایجنت صوتی بلادرنگ نسل ۲۰۲۶ با قابلیت درک قطع مکالمه و استریم دوطرفه."""

    def __init__(self, tts_voice: str = "fa-IR-FaridNeural", vad_silence_threshold_ms: int = 1800):
        self.tts_voice = tts_voice
        self.vad_silence_threshold_ms = vad_silence_threshold_ms
        self._is_speaking = False
        self._interrupted = False

    def scrub_user_transcript(self, transcript: str) -> tuple[str, Dict[str, str]]:
        """Scrub Persian/Latin PII from an STT transcript before any external LLM/judge call."""
        scrubbed, mapping, _ = _scrub_pii_with_counts(transcript, context="voice_agent_stt")
        return scrubbed, mapping

    def restore_assistant_text(self, text: str, mapping: Dict[str, str]) -> str:
        """Restore typed PII placeholders in the assistant's response."""
        return _unmask_pii_entities(text, mapping)

    async def on_user_speech_frame(self, frame: AudioFrame):
        """دریافت فریم‌های صوتی کاربر و تشخیص قطع صحبت دستیار (Barge-in)."""
        if self._is_speaking:
            # کاربر شروع به صحبت کرد در حالی که دستیار در حال حرف زدن بود
            logger.info("Barge-in detected: User interrupted AI playback")
            self._interrupted = True
            self._is_speaking = False

    async def stream_tts_audio(self, text_stream: AsyncGenerator[str, None]) -> AsyncGenerator[bytes, None]:
        """
        تولید همزمان فریم‌های صوتی به موازات تولید توکن‌های متنی از مدل زبانی.
        هر زمان یک جمله کوتاه کامل شد، بایت‌های صوتی فورا تولید و استریم می‌شوند.
        """
        self._is_speaking = True
        self._interrupted = False

        sentence_buffer = ""
        delimiters = (".", "!", "?", "؛", "،", "\n")

        async for text_chunk in text_stream:
            if self._interrupted:
                logger.info("TTS stream aborted due to user interruption")
                break

            sentence_buffer += text_chunk
            if any(d in sentence_buffer for d in delimiters) and len(sentence_buffer.strip()) > 15:
                # تبدیل این جمله به صوت (ابتدا پاکسازی PII پیش از ارسال به سرویس TTS بیرونی)
                sentence_to_speak, _, _ = _scrub_pii_with_counts(
                    sentence_buffer.strip(), context="voice_agent_tts"
                )
                sentence_buffer = ""

                try:
                    import edge_tts
                    comm = edge_tts.Communicate(sentence_to_speak, self.tts_voice)
                    async for audio_chunk in comm.stream():
                        if self._interrupted:
                            break
                        if audio_chunk["type"] == "audio":
                            yield audio_chunk["data"]
                except Exception as exc:
                    logger.error(f"TTS frame streaming error: {exc}")

        # باقیمانده بافر
        if sentence_buffer.strip() and not self._interrupted:
            try:
                import edge_tts
                trailing_text, _, _ = _scrub_pii_with_counts(
                    sentence_buffer.strip(), context="voice_agent_tts"
                )
                comm = edge_tts.Communicate(trailing_text, self.tts_voice)
                async for audio_chunk in comm.stream():
                    if audio_chunk["type"] == "audio":
                        yield audio_chunk["data"]
            except Exception as exc:
                logger.error(f"TTS trailing buffer error: {exc}")

        self._is_speaking = False
