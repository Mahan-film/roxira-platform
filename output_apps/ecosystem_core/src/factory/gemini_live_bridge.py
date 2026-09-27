#!/usr/bin/env python3
"""SmartJudge Gemini Live realtime voice session (W20, docs/W20_realtime_voice.md).

This module holds one function, `run_gemini_realtime_session()`, that owns a
single live-voice websocket connection for its whole lifetime. It is called
from `smartjudge_live_voice.live_voice_websocket()` when
`VOICE_REALTIME_PROVIDER=gemini` -- it is NOT mounted as its own APIRouter
(an earlier prototype of this file did that, at the same
`/api/v1/apps/judge/live-voice` path as the STT/LLM/edge-tts cascade router
in smartjudge_live_voice.py; FastAPI/Starlette match routes in registration
order, and the cascade router was always registered first in
run_unified_server.py, so that prototype's own websocket handler was dead
code -- never reached on any real request. See docs/W20_realtime_voice.md
section 1 for the evidence.)

Design (docs/W20_realtime_voice.md section 3):
  - Only the backend holds GEMINI_API_KEY (server env only -- CLAUDE.md's
    secrets rule -- never sent to the browser).
  - The browser keeps talking to OUR websocket exactly as it always has
    (same PCM-in / JSON-event-out shape); this module is what changes on
    the server side of that same connection.
  - The frontend audio format is base64 **raw PCM**, not an encoded
    container (mp3/wav) like the edge-tts cascade path -- Gemini Live's
    AUDIO response modality streams raw 24kHz mono s16le samples, not an
    encoded clip. Messages therefore carry an explicit
    `"mime": "audio/pcm;rate=24000"` so the frontend can tell the two
    payload shapes apart and decode each correctly (see
    live-voice-modal.tsx's playAudio()).
  - Legal grounding: reuses the same `aquery_knowledge_graph()` RAG lookup
    the STT/LLM/edge-tts cascade path already uses (smartjudge_live_voice.py
    `_analyze_legal_query_impl`), fed by Gemini's own input-audio
    transcription so no separate STT call is needed. The retrieved context
    is sent as a non-turn-completing client content turn -- Google's
    documented pattern for grounding a live session mid-conversation --
    immediately after each user utterance is transcribed, before Gemini
    finishes generating its spoken reply to that utterance.
  - Barge-in: Gemini Live's automatic (server-side) voice activity
    detection is left on (the default) so the model stops speaking as soon
    as it hears the user again, without any client round-trip. The
    frontend's own client-side VAD `commit`/`speech_end` message is still
    forwarded as `audio_stream_end` -- redundant with server VAD most of
    the time, but it closes the turn immediately instead of waiting out
    Gemini's own trailing-silence timeout, which is the main "not
    continuous" latency the owner reported.

Not live-tested end to end (owner-run verification is still needed): a
read-only `client.models.list()` call against the real GEMINI_API_KEY from
5.75.200.67 on 2026-09-26 confirmed the key is valid and that
`gemini-3.8-live` / `gemini-3.1-flash-live-preview` are live model ids; a
full round-trip live session call was blocked by this session's own
sandbox/approval policy (see docs/W20_realtime_voice.md section 1). The
`google-genai` SDK call shapes below (`session.send_realtime_input`,
`types.Blob`, `response.server_content.input_transcription`, ...) match the
SDK version installed in the prod container as of 2026-09-26 but have not
been exercised against a live socket by this change -- flip
VOICE_REALTIME_PROVIDER=gemini on staging/owner-run first.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import sys

from output_apps.ecosystem_core.src.factory.voice_timing import Stopwatch, log_voice_timing

GEMINI_API_KEY_ENV = "GEMINI_API_KEY"
_DEFAULT_MODEL = "gemini-3.8-live"

SYSTEM_INSTRUCTION = """
شما وکیل ارشد و دستیار هوشمند حقوقی در سامانه «قاضی هوشمند» ایران هستید.
امروز در سال ۱۴۰۵ هجری خورشیدی قرار داریم.
پاسخ‌های شما باید مستند، رسا، کاملاً به زبان فارسی معیار و محترمانه باشد.
در گفتگوهای زنده صوتی، پاسخ‌ها را کوتاه (۲ تا ۴ جمله)، موجز و بدون استفاده از
کاراکترهای مارک‌داون بیان کنید. هرگاه پیامی با پیشوند «[منابع حقوقی مرتبط]»
دریافت کردید، آن را فقط به‌عنوان مستند پشتیبان تحلیل خود در نظر بگیرید و
هرگز عین آن متن را با صدای بلند نخوانید.
"""


def _model_id() -> str:
    """`voice_realtime` role primary (config/models.yaml), else
    VOICE_REALTIME_MODEL, else the hardcoded default. Never raises -- same
    resilience contract as smartjudge_live_voice._default_stt_model()."""
    env_override = os.environ.get("VOICE_REALTIME_MODEL", "").strip()
    if env_override:
        return env_override
    try:
        from output_apps.generated_modules.smartjudge import model_registry

        ids = model_registry.role_models("voice_realtime")
        if ids:
            return ids[0]
    except Exception:
        pass
    return _DEFAULT_MODEL


async def _fetch_legal_context(query_text: str) -> str:
    """Same RAG lookup as the cascade path's _analyze_legal_query_impl, kept
    to a 2s timeout so a slow graph query never stalls the live turn."""
    try:
        from output_apps.generated_modules.smartjudge.smartjudge_module import aquery_knowledge_graph

        laws, prec = await asyncio.wait_for(aquery_knowledge_graph(query_text, limit=3), timeout=2.0)
        return f"قوانین و مصوبات: {laws}\nآراء و بخشنامه‌ها: {prec}"
    except Exception:
        return ""


async def run_gemini_realtime_session(websocket) -> None:
    """Own a live-voice websocket end to end via Gemini Live. `websocket` is
    a starlette WebSocket already `.accept()`-ed by the caller (the caller
    also already sent the SESSION_STARTED event, so the wire contract with
    the frontend is identical to the cascade path up to this point)."""
    api_key = os.environ.get(GEMINI_API_KEY_ENV, "")
    if not api_key:
        await websocket.send_text(json.dumps({
            "event": "error", "type": "ERROR",
            "message": "GEMINI_API_KEY تنظیم نشده است.",
        }))
        await websocket.send_text(json.dumps({"event": "turn_complete"}))
        return

    try:
        from google import genai
        from google.genai import types
    except ImportError as exc:
        print(f"[GEMINI-LIVE-ERR] google-genai not installed: {exc}", file=sys.stderr)
        await websocket.send_text(json.dumps({
            "event": "error", "type": "ERROR",
            "message": "وابستگی google-genai روی سرور نصب نیست.",
        }))
        await websocket.send_text(json.dumps({"event": "turn_complete"}))
        return

    client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Zephyr")
            ),
            language_code="fa-IR",
        ),
        system_instruction=types.Content(parts=[types.Part.from_text(text=SYSTEM_INSTRUCTION)]),
    )

    turn_sw = Stopwatch()
    last_context_query: str | None = None

    async def pump_client_audio(session) -> None:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if "bytes" in message and message["bytes"]:
                await session.send_realtime_input(
                    audio=types.Blob(data=message["bytes"], mime_type="audio/pcm;rate=16000")
                )
            elif "text" in message and message["text"]:
                try:
                    data = json.loads(message["text"])
                except Exception:
                    continue
                evt = str(data.get("type") or data.get("event") or "").lower()
                if evt in ("commit", "speech_end", "audio_input"):
                    await session.send_realtime_input(audio_stream_end=True)

    async def pump_gemini_events(session) -> None:
        nonlocal last_context_query, turn_sw
        async for response in session.receive():
            sc = getattr(response, "server_content", None)

            in_tx = getattr(sc, "input_transcription", None) if sc else None
            if in_tx and getattr(in_tx, "text", None):
                text = in_tx.text
                await websocket.send_text(json.dumps({
                    "event": "user_transcription", "type": "TRANSCRIPT", "text": text,
                }))
                if text.strip() and text != last_context_query:
                    last_context_query = text
                    context = await _fetch_legal_context(text)
                    if context:
                        await session.send_client_content(
                            turns=types.Content(
                                role="user",
                                parts=[types.Part(text=f"[منابع حقوقی مرتبط]\n{context}")],
                            ),
                            turn_complete=False,
                        )

            out_tx = getattr(sc, "output_transcription", None) if sc else None
            if out_tx and getattr(out_tx, "text", None):
                await websocket.send_text(json.dumps({
                    "event": "agent_text_response", "type": "ANSWER_TEXT", "text": out_tx.text,
                }))

            if getattr(response, "data", None):
                await websocket.send_text(json.dumps({
                    "event": "agent_audio_stream", "type": "AUDIO_STREAM",
                    "audio_data": base64.b64encode(response.data).decode("utf-8"),
                    "mime": "audio/pcm;rate=24000",
                }))

            if sc and getattr(sc, "turn_complete", False):
                await websocket.send_text(json.dumps({"event": "turn_complete"}))
                log_voice_timing("turn", end_to_end_ms=turn_sw.elapsed_ms(), streamed=True, provider="gemini")
                turn_sw = Stopwatch()

    try:
        async with client.aio.live.connect(model=_model_id(), config=config) as session:
            await asyncio.gather(pump_client_audio(session), pump_gemini_events(session))
    except Exception as exc:
        print(f"[GEMINI-LIVE-ERR] {exc}", file=sys.stderr)
        try:
            await websocket.send_text(json.dumps({"event": "turn_complete"}))
        except Exception:
            pass
