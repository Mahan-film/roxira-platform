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
                # تبدیل این جمله به صوت
                sentence_to_speak = sentence_buffer.strip()
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
                comm = edge_tts.Communicate(sentence_buffer.strip(), self.tts_voice)
                async for audio_chunk in comm.stream():
                    if audio_chunk["type"] == "audio":
                        yield audio_chunk["data"]
            except Exception as exc:
                logger.error(f"TTS trailing buffer error: {exc}")

        self._is_speaking = False
