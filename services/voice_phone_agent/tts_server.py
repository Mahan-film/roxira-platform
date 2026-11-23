"""Tiny local edge-tts sidecar for the voice agent.

POST /tts {"text", "voice", "rate", "pitch"} -> audio/mpeg. GET /health.
One long-lived process shared by all calls: no Python start-up per sentence.
Outbound traffic to Microsoft goes through the proxy (PROXY_URL); it listens on 127.0.0.1 only.
"""
import asyncio
import os
import re

import edge_tts
from aiohttp import web

PROXY = os.environ.get("PROXY_URL", "http://127.0.0.1:10808") or None
PORT = int(os.environ.get("EDGE_TTS_PORT", "5055"))
PITCH_RE = re.compile(r"^[+-]\d{1,2}Hz$")


def pitch_of(body: dict) -> str:
    """edge-tts pitch such as "-2Hz"; anything else (or missing, from an older agent) is the default."""
    p = str(body.get("pitch") or "")
    return p if PITCH_RE.match(p) else "+0Hz"


FALLBACK_VOICE = {"fa-IR-DilaraNeural": "fa-IR-FaridNeural", "fa-IR-FaridNeural": "fa-IR-DilaraNeural"}


async def synth(text: str, voice: str, rate: str, pitch: str = "+0Hz") -> bytes:
    buf = bytearray()
    async for chunk in edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, proxy=PROXY).stream():
        if chunk["type"] == "audio":
            buf.extend(chunk["data"])
    return bytes(buf)


async def tts(request: web.Request) -> web.Response:
    body = await request.json()
    text = str(body.get("text") or "").strip()[:1500]
    if not text:
        return web.json_response({"error": "empty text"}, status=400)
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
    """Same as /tts but forwards mp3 chunks as Microsoft sends them (first audio in ~0.5 s, not after the
    whole sentence). Retries / voice fallback only before the first byte; after that the stream just ends."""
    body = await request.json()
    text = str(body.get("text") or "").strip()[:1500]
    if not text:
        return web.json_response({"error": "empty text"}, status=400)
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
    return web.json_response({"ok": True})


app = web.Application(client_max_size=64 * 1024)
app.add_routes([web.post("/tts", tts), web.post("/tts/stream", tts_stream), web.get("/health", health)])

if __name__ == "__main__":
    web.run_app(app, host="127.0.0.1", port=PORT, print=None)
