"""Tiny local TTS sidecar for the voice agent with local Persian Sherpa-ONNX & edge-tts fallback (T251).

POST /tts {"text", "voice", "rate", "pitch"} -> audio/mpeg or audio/wav. GET /health.
One long-lived process shared by all calls: no Python start-up per sentence.
When LOCAL_TTS_ENABLED=1, synthesizes via permissively licensed sherpa-onnx (Apache-2.0)
+ Piper voice (MIT), without GPL espeak-ng. Falls back cleanly to edge-tts.
Outbound traffic for edge-tts goes through the proxy (PROXY_URL); listens on 127.0.0.1 only.
"""

from __future__ import annotations

import asyncio
import os
import re
import sys
from typing import Optional

try:
    from output_apps.generated_modules.smartjudge.persian_spoken_normaliser import (
        StreamingClauseFlusher,
        normalize_persian_speech,
    )
except ImportError:
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)
    try:
        from output_apps.generated_modules.smartjudge.persian_spoken_normaliser import (
            StreamingClauseFlusher,
            normalize_persian_speech,
        )
    except ImportError:
        def normalize_persian_speech(t: str) -> str:
            return t

        StreamingClauseFlusher = None

import edge_tts
from aiohttp import web

PROXY = os.environ.get("PROXY_URL", "http://127.0.0.1:10808") or None
PORT = int(os.environ.get("EDGE_TTS_PORT", "5055"))
PITCH_RE = re.compile(r"^[+-]\d{1,2}Hz$")

LOCAL_TTS_ENABLED = os.environ.get("LOCAL_TTS_ENABLED", "0").lower() in ("1", "true", "yes")
SHERPA_TTS_MODEL = os.environ.get("SHERPA_TTS_MODEL", "/srv/data/phone/models/sherpa-fa/model.onnx")
SHERPA_TTS_TOKENS = os.environ.get("SHERPA_TTS_TOKENS", "/srv/data/phone/models/sherpa-fa/tokens.txt")
SHERPA_TTS_DATA_DIR = os.environ.get("SHERPA_TTS_DATA_DIR", "")


def pitch_of(body: dict) -> str:
    """edge-tts pitch such as "-2Hz"; anything else (or missing, from an older agent) is the default."""
    p = str(body.get("pitch") or "")
    return p if PITCH_RE.match(p) else "+0Hz"


FALLBACK_VOICE = {"fa-IR-DilaraNeural": "fa-IR-FaridNeural", "fa-IR-FaridNeural": "fa-IR-DilaraNeural"}


def synth_sherpa(text: str) -> Optional[bytes]:
    """Synthesize speech using local sherpa-onnx + Piper voice (Apache-2.0 / MIT)."""
    if not LOCAL_TTS_ENABLED:
        return None
    try:
        import sherpa_onnx
    except ImportError:
        return None

    if not (os.path.exists(SHERPA_TTS_MODEL) and os.path.exists(SHERPA_TTS_TOKENS)):
        return None

    try:
        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                    model=SHERPA_TTS_MODEL,
                    tokens=SHERPA_TTS_TOKENS,
                    data_dir=SHERPA_TTS_DATA_DIR,
                )
            )
        )
        tts_engine = sherpa_onnx.OfflineTts(config)
        audio = tts_engine.generate(text)
        if not audio or len(audio.samples) == 0:
            return None

        import io
        import struct
        import wave

        int16_samples = [max(-32768, min(32767, int(s * 32767))) for s in audio.samples]
        raw_frames = struct.pack(f"<{len(int16_samples)}h", *int16_samples)

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(audio.sample_rate)
            wf.writeframes(raw_frames)
        return buf.getvalue()
    except Exception as exc:  # noqa: BLE001
        print(f"[tts-sherpa] error: {exc}", flush=True)
        return None


async def synth(text: str, voice: str, rate: str, pitch: str = "+0Hz") -> bytes:
    buf = bytearray()
    async for chunk in edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, proxy=PROXY).stream():
        if chunk["type"] == "audio":
            buf.extend(chunk["data"])
    return bytes(buf)


async def tts(request: web.Request) -> web.Response:
    body = await request.json()
    raw_text = str(body.get("text") or "").strip()[:1500]
    if not raw_text:
        return web.json_response({"error": "empty text"}, status=400)
    text = normalize_persian_speech(raw_text)

    # 1. Try local permissive sherpa-onnx voice if enabled and present
    if LOCAL_TTS_ENABLED:
        local_audio = synth_sherpa(text)
        if local_audio and len(local_audio) > 200:
            return web.Response(body=local_audio, content_type="audio/wav")

    # 2. Fall back to edge-tts
    voice = body.get("voice") or "fa-IR-DilaraNeural"
    rate = body.get("rate") or "+0%"
    for v in (voice, voice, FALLBACK_VOICE.get(voice, voice)):
        try:
            audio = await asyncio.wait_for(synth(text, v, rate, pitch_of(body)), timeout=15)
            if len(audio) > 200:
                return web.Response(body=audio, content_type="audio/mpeg")
        except Exception as exc:  # noqa: BLE001
            print(f"[tts] {v} {type(exc).__name__}: {exc}", flush=True)
    return web.json_response({"error": "tts failed"}, status=502)


async def tts_stream(request: web.Request) -> web.StreamResponse:
    """Streams audio as chunks are produced. Retries / voice fallback only before the first byte."""
    body = await request.json()
    raw_text = str(body.get("text") or "").strip()[:1500]
    if not raw_text:
        return web.json_response({"error": "empty text"}, status=400)
    text = normalize_persian_speech(raw_text)

    # 1. Local sherpa-onnx if enabled and present
    if LOCAL_TTS_ENABLED:
        local_audio = synth_sherpa(text)
        if local_audio and len(local_audio) > 200:
            resp = web.StreamResponse(headers={"Content-Type": "audio/wav"})
            await resp.prepare(request)
            chunk_size = 4096
            for i in range(0, len(local_audio), chunk_size):
                await resp.write(local_audio[i : i + chunk_size])
            await resp.write_eof()
            return resp

    # 2. edge-tts streaming fallback
    voice = body.get("voice") or "fa-IR-DilaraNeural"
    rate = body.get("rate") or "+0%"
    resp = web.StreamResponse(headers={"Content-Type": "audio/mpeg"})
    for v in (voice, voice, FALLBACK_VOICE.get(voice, voice)):
        sent = 0
        try:
            async with asyncio.timeout(20):
                async for chunk in edge_tts.Communicate(text, v, rate=rate, pitch=pitch_of(body), proxy=PROXY).stream():
                    if chunk["type"] == "audio" and chunk["data"]:
                        if not resp.prepared:
                            await resp.prepare(request)
                        await resp.write(chunk["data"])
                        sent += len(chunk["data"])
            if sent > 200:
                break
        except Exception as exc:  # noqa: BLE001
            print(f"[tts-stream] {v} {type(exc).__name__}: {exc} (sent {sent} B)", flush=True)
            if sent:
                break
    if resp.prepared:
        await resp.write_eof()
        return resp
    return web.json_response({"error": "tts failed"}, status=502)


async def health(_request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "local_tts_enabled": LOCAL_TTS_ENABLED})


app = web.Application(client_max_size=64 * 1024)
app.add_routes([web.post("/tts", tts), web.post("/tts/stream", tts_stream), web.get("/health", health)])

if __name__ == "__main__":
    web.run_app(app, host="127.0.0.1", port=PORT, print=None)
