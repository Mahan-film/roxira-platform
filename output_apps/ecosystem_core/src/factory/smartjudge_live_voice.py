import os, sys, json, io, wave, base64, asyncio, urllib.request, urllib.error, re
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, UploadFile, File, Request
from pydantic import BaseModel

from output_apps.ecosystem_core.src.factory.voice_timing import Stopwatch, log_voice_timing
from output_apps.ecosystem_core.src.factory.persian_text import split_persian_sentences

router = APIRouter(prefix="/api/v1/apps/judge", tags=["SmartJudgeVoice"])

HALLUCINATIONS = {"سلامتی.", "سلامتی", "بله.", "بله", "تشکر.", "تشکر", "زیرنویس", "...", "."}

PHONETIC_FIXES = [
    (r"کارگورد", "کاربرد"),
    (r"کار\s*کرد\s*تو", "کاربرد تو"),
    (r"محتم\s*صدیه", "وحدت رویه"),
    (r"وقت\s*رو\s*رویه", "وحدت رویه"),
    (r"قبغذایی", "قوه قضائیه"),
    (r"قوه\s*غذایی", "قوه قضائیه"),
    (r"بخش\s*نامه\s*قبغذایی", "بخشنامه قوه قضائیه"),
    (r"به\s*چه\s*شیر\s*صورت", "به چه صورت"),
    (r"دادگاه\s*صلح\s*و\s*سازش", "دادگاه صلح"),
]

# One model id for both the blocking and the streaming LLM path. Kept on the
# model voice already used in production; moving it to a config/models.yaml
# role is a product change that waits for the W6 legal eval.
VOICE_LLM_MODEL = os.environ.get("VOICE_LLM_MODEL", "").strip() or "deepseek/deepseek-chat"

_STT_FALLBACK_ID = "openai/whisper-large-v3-turbo"


def _default_stt_model() -> str:
    """The registry's `stt` primary (config/models.yaml), else the id this
    module has always hardcoded. Never raises: the registry module does no
    network I/O, but a missing/malformed config/models.yaml, or PyYAML not
    being installed, must not break the voice pipeline (issue #39)."""
    try:
        from output_apps.generated_modules.smartjudge import model_registry

        ids = model_registry.role_models("stt")
        if ids:
            return ids[0]
    except Exception:
        pass
    return _STT_FALLBACK_ID


# STT model id (issue #39: the previously-hardcoded openai/whisper-large-v3-turbo
# is unverifiable against OpenRouter's live GET /api/v1/models catalogue -- see
# config/models.yaml's `stt` role for the full note). VOICE_STT_MODEL always wins
# when set; otherwise this defaults to the registry's stt primary, falling back to
# the historical hardcoded id if config/models.yaml or model_registry.py is
# unavailable.
VOICE_STT_MODEL = os.environ.get("VOICE_STT_MODEL", "").strip() or _default_stt_model()

# Streaming TTS (W7, docs/W7_voice_latency.md), default OFF: split the LLM reply at
# Persian sentence boundaries and start Edge-TTS on the first sentence while later
# sentences are still being generated/synthesized, instead of waiting for the whole
# reply. The websocket transport already supports multiple agent_audio_stream
# messages per turn (the frontend awaits playAudio() per message), so no frontend
# change is needed to land this behind the flag.
VOICE_STREAM_TTS = os.environ.get("VOICE_STREAM_TTS", "0").strip().lower() not in (
    "0", "false", "off", "no",
)

# W20 (docs/W20_realtime_voice.md): optional native speech-to-speech provider,
# default OFF (empty/unset -> the STT/LLM/edge-tts cascade above stays the
# default path). The only supported value today is "gemini" -- see
# gemini_live_bridge.run_gemini_realtime_session(), called below instead of
# the cascade loop when this is set. Any other/unknown value is treated as
# off rather than raising, so a typo in the env never breaks live voice.
VOICE_REALTIME_PROVIDER = os.environ.get("VOICE_REALTIME_PROVIDER", "").strip().lower()


def sanitize_transcription(txt: str) -> str:
    cleaned = txt.strip()
    for pat, rep in PHONETIC_FIXES:
        cleaned = re.sub(pat, rep, cleaned, flags=re.IGNORECASE)
    return cleaned

def pcm_to_wav(pcm_data: bytes, sample_rate: int = 16000) -> bytes:
    wav_io = io.BytesIO()
    with wave.open(wav_io, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_data)
    return wav_io.getvalue()

async def _transcribe_audio_payload_impl(audio_bytes: bytes, audio_fmt: str = "wav") -> str:
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    if openrouter_key:
        try:
            b64_data = base64.b64encode(audio_bytes).decode("utf-8")
            fmt = audio_fmt.lower().replace("audio/", "").replace("codecs=opus", "").replace(";", "").strip()
            if fmt in ["mp4", "aac"]:
                fmt = "m4a"
            elif fmt not in ["wav", "m4a", "webm", "mp3", "ogg"]:
                fmt = "wav"

            payload = {
                "model": VOICE_STT_MODEL,
                "input_audio": {
                    "data": b64_data,
                    "format": fmt
                },
                "language": "fa"
            }

            req = urllib.request.Request(
                "https://openrouter.ai/api/v1/audio/transcriptions",
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {openrouter_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://ghazihoushmand.ir",
                    "X-Title": "Smart Judge Legal Platform"
                },
                method="POST"
            )
            loop = asyncio.get_running_loop()
            def _stt():
                with urllib.request.urlopen(req, timeout=8.0) as resp:
                    return json.loads(resp.read().decode("utf-8")).get("text", "")
            raw = await loop.run_in_executor(None, _stt)
            if raw and len(raw.strip()) > 1:
                return sanitize_transcription(raw)
        except Exception as e:
            print(f"[STT-WARN] {e}", file=sys.stderr)

    # فال‌بک به انجین محلی
    try:
        from output_apps.ecosystem_core.src.factory.stt_engine import transcribe_audio_blob
        b64 = base64.b64encode(audio_bytes).decode("utf-8")
        loop = asyncio.get_running_loop()
        res = await loop.run_in_executor(None, transcribe_audio_blob, b64, f"audio/{audio_fmt}")
        return sanitize_transcription(str(res or ""))
    except Exception:
        return ""


async def transcribe_audio_payload(audio_bytes: bytes, audio_fmt: str = "wav") -> str:
    """STT stage. Times the whole call (OpenRouter Whisper, falling back to the
    local engine) and logs `stt_ms` -- no transcript text in the log line."""
    sw = Stopwatch()
    try:
        return await _transcribe_audio_payload_impl(audio_bytes, audio_fmt)
    finally:
        log_voice_timing("stt", stt_ms=sw.elapsed_ms())

async def _analyze_legal_query_impl(query_text: str) -> str:
    q_norm = query_text.lower().replace("؟", "").replace(".", "").strip()

    if q_norm in ["salam", "dorood", "سلام", "درود", "صبح بخیر", "عصر بخیر"] or (len(q_norm) < 15 and "salam" in q_norm):
        return "سلام و احترام. من مستشار تخصصی قضایی سامانه «قاضی هوشمند» هستم. لطفاً شرح دادخواست، پرسش یا پرونده حقوقی خود را بفرمایید تا مستند به قوانین و رویه قضایی راهنماییتان کنم."

    if any(p in q_norm for p in ["اسم تو چیه", "نام شما", "کی هستی", "کاربرد تو", "کارکرد تو"]):
        return "من دستیار و مستشار قضایی سامانه «قاضی هوشمند» هستم. کاربرد اصلی من تحلیل پرونده‌های حقوقی و کیفری، تطبیق با آراء وحدت رویه، مصوبات هیئت وزیران و تنظیم لوایح قضایی است."

    context_data = ""
    try:
        from output_apps.generated_modules.smartjudge.smartjudge_module import aquery_knowledge_graph
        laws, prec = await asyncio.wait_for(aquery_knowledge_graph(query_text, limit=3), timeout=2.0)
        context_data = f"قوانین و مصوبات: {laws}\nآراء و بخشنامه‌ها: {prec}"
    except Exception:
        pass

    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    sys_prompt = f"""
امروز در سال ۱۴۰۵ هجری خورشیدی قرار داریم. شما مستشار عالی‌رتبه قضایی در سامانه «قاضی هوشمند» هستید.
پاسخ شما به پرسش‌های حقوقی باید مستند، رسا، در قالب ۲ الی ۴ جمله و همراه با ذکر شماره مواد قانونی یا شماره رأی وحدت رویه و تصویب‌نامه‌های هیئت وزیران باشد.
مستندات پایگاه داده:
{context_data}
"""

    payload = json.dumps({
        "model": VOICE_LLM_MODEL,
        "messages": [{"role": "system", "content": sys_prompt}, {"role": "user", "content": query_text}],
        "temperature": 0.2,
        "max_tokens": 190
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=payload,
        headers={"Authorization": f"Bearer {openrouter_key}", "Content-Type": "application/json"},
        method="POST"
    )

    try:
        loop = asyncio.get_running_loop()
        def _fetch():
            with urllib.request.urlopen(req, timeout=5.5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data["choices"][0]["message"]["content"]
        raw = await loop.run_in_executor(None, _fetch)
        return raw.replace("*", "").replace("#", "").strip()
    except Exception:
        return "مطابق با موازین قانونی و رویه قضایی جاری، موضوع بر اساس صلاحیت مراجع صالحه و مقررات آیین دادرسی مدنی بررسی و تعیین تکلیف می‌گردد."


async def analyze_legal_query(query_text: str) -> str:
    """LLM stage, non-streaming path (VOICE_STREAM_TTS off, and the default/only
    path today: the OpenRouter call above is a single blocking request, not SSE).
    `llm_first_token_ms` therefore equals `llm_total_ms` here -- there is no
    earlier "first token" to observe without a real streaming call. See
    analyze_legal_query_streaming() for the path that does distinguish them."""
    sw = Stopwatch()
    try:
        return await _analyze_legal_query_impl(query_text)
    finally:
        ms = sw.elapsed_ms()
        log_voice_timing("llm", llm_first_token_ms=ms, llm_total_ms=ms, streamed=False)


async def analyze_legal_query_streaming(query_text: str, on_sentence) -> str:
    """LLM stage, streaming path (VOICE_STREAM_TTS on). Reads OpenRouter's SSE
    `chat/completions` stream via httpx (already a declared dependency), and
    calls `await on_sentence(sentence)` for each complete Persian sentence as
    soon as it appears in the accumulated delta text -- letting the caller
    start Edge-TTS on sentence 1 while later sentences are still generating.

    Falls back to the non-streaming analyze_legal_query() (and calls
    on_sentence once with the whole reply) on any error, so a network hiccup
    never silently drops the turn.

    Returns the full reply text (same contract as analyze_legal_query).
    """
    sw = Stopwatch()
    first_token_ms = None
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not openrouter_key:
        text = await _analyze_legal_query_impl(query_text)
        await on_sentence(text)
        ms = sw.elapsed_ms()
        log_voice_timing("llm", llm_first_token_ms=ms, llm_total_ms=ms, streamed=False)
        return text

    q_norm = query_text.lower().replace("؟", "").replace(".", "").strip()
    if q_norm in ["salam", "dorood", "سلام", "درود", "صبح بخیر", "عصر بخیر"] or (len(q_norm) < 15 and "salam" in q_norm):
        text = await _analyze_legal_query_impl(query_text)
        await on_sentence(text)
        ms = sw.elapsed_ms()
        log_voice_timing("llm", llm_first_token_ms=ms, llm_total_ms=ms, streamed=False)
        return text

    context_data = ""
    try:
        from output_apps.generated_modules.smartjudge.smartjudge_module import aquery_knowledge_graph
        laws, prec = await asyncio.wait_for(aquery_knowledge_graph(query_text, limit=3), timeout=2.0)
        context_data = f"قوانین و مصوبات: {laws}\nآراء و بخشنامه‌ها: {prec}"
    except Exception:
        pass

    sys_prompt = f"""
امروز در سال ۱۴۰۵ هجری خورشیدی قرار داریم. شما مستشار عالی‌رتبه قضایی در سامانه «قاضی هوشمند» هستید.
پاسخ شما به پرسش‌های حقوقی باید مستند، رسا، در قالب ۲ الی ۴ جمله و همراه با ذکر شماره مواد قانونی یا شماره رأی وحدت رویه و تصویب‌نامه‌های هیئت وزیران باشد.
مستندات پایگاه داده:
{context_data}
"""

    try:
        import httpx

        buf = ""
        emitted_count = 0
        async with httpx.AsyncClient(timeout=8.0) as client:
            async with client.stream(
                "POST",
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {openrouter_key}", "Content-Type": "application/json"},
                json={
                    "model": VOICE_LLM_MODEL,
                    "messages": [{"role": "system", "content": sys_prompt}, {"role": "user", "content": query_text}],
                    "temperature": 0.2,
                    "max_tokens": 190,
                    "stream": True,
                },
            ) as resp:
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[len("data:"):].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        delta = chunk["choices"][0]["delta"].get("content") or ""
                    except Exception:
                        continue
                    if not delta:
                        continue
                    if first_token_ms is None:
                        first_token_ms = sw.elapsed_ms()
                    buf += delta

                    sentences = split_persian_sentences(buf)
                    # Emit every complete sentence except a possibly-incomplete
                    # trailing one (the stream may still be mid-sentence).
                    if len(sentences) > emitted_count + 1:
                        for s in sentences[emitted_count:-1]:
                            await on_sentence(s)
                        emitted_count = len(sentences) - 1

        # Stream finished: the last sentence, if any, is now complete too.
        final_sentences = split_persian_sentences(buf)
        for s in final_sentences[emitted_count:]:
            await on_sentence(s)

        full_text = buf.replace("*", "").replace("#", "").strip()
        total_ms = sw.elapsed_ms()
        log_voice_timing(
            "llm",
            llm_first_token_ms=first_token_ms or total_ms,
            llm_total_ms=total_ms,
            streamed=True,
        )
        return full_text or await _analyze_legal_query_impl(query_text)
    except Exception as e:
        print(f"[LLM-STREAM-WARN] {e}", file=sys.stderr)
        text = await _analyze_legal_query_impl(query_text)
        await on_sentence(text)
        total_ms = sw.elapsed_ms()
        log_voice_timing("llm", llm_first_token_ms=total_ms, llm_total_ms=total_ms, streamed=False)
        return text

async def synthesize_speech_persian(text: str) -> str:
    """TTS stage (single-shot, VOICE_STREAM_TTS off or fallback path). edge-tts
    already streams chunks internally; we still buffer them into one clip here
    because this function's contract is "one full utterance in, one full
    base64 clip out" -- times both `tts_first_byte_ms` (first audio chunk from
    edge-tts) and `tts_total_ms` (whole clip) regardless."""
    sw = Stopwatch()
    first_byte_ms = None
    try:
        import edge_tts
        comm = edge_tts.Communicate(text, "fa-IR-DilaraNeural", rate="+15%")
        buf = bytearray()
        async def _stream():
            nonlocal first_byte_ms
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    if first_byte_ms is None:
                        first_byte_ms = sw.elapsed_ms()
                    buf.extend(chunk["data"])
            return base64.b64encode(buf).decode("utf-8")
        return await asyncio.wait_for(_stream(), timeout=2.8)
    except Exception as e:
        # Was a bare `except Exception: return ""` with no logging (W20
        # diagnosis): a missing/broken edge-tts install failed 100% of turns
        # silently, with nothing in `docker logs` to point at it. Printing
        # here costs nothing (no transcript/PII, just the exception) and is
        # the only signal an owner has without VOICE_TIMING_LOG-level tracing.
        print(f"[TTS-WARN] {e}", file=sys.stderr)
        return ""
    finally:
        log_voice_timing("tts", tts_first_byte_ms=first_byte_ms, tts_total_ms=sw.elapsed_ms())


class ChatMessageReq(BaseModel):
    message: str = ""
    prompt: str = ""
    conversation_id: str = "default_conv"

@router.post("/chat")
@router.post("/query")
async def judge_text_chat_api(req: ChatMessageReq):
    query_text = req.message or req.prompt
    if not query_text:
        return {"reply": "پیامی دریافت نشد.", "response": "پیامی دریافت نشد."}
    ans = await analyze_legal_query(query_text)
    return {"reply": ans, "response": ans, "conversation_id": req.conversation_id}

@router.get("/chat")
async def judge_text_chat_status():
    return {"status": "active", "service": "Smart Judge Legal Chat"}

@router.post("/transcribe-audio")
@router.post("/stt")
@router.post("/transcribe")
async def judge_stt_api(request: Request, file: UploadFile = File(None), audio: UploadFile = File(None)):
    target = file or audio
    if not target:
        form = await request.form()
        for k, v in form.items():
            if hasattr(v, "read"):
                target = v
                break

    if not target:
        return {"text": "", "transcription": ""}

    content = await target.read()
    if len(content) < 500:
        return {"text": "", "transcription": ""}

    orig_name = getattr(target, "filename", "audio.mp4") or "audio.mp4"
    content_type = getattr(target, "content_type", "audio/mp4") or "audio/mp4"

    fmt = "wav"
    if "webm" in orig_name.lower() or "webm" in content_type.lower():
        fmt = "webm"
    elif "mp4" in orig_name.lower() or "mp4" in content_type.lower() or "m4a" in content_type.lower():
        fmt = "m4a"

    text = await transcribe_audio_payload(content, fmt)
    return {"text": text, "transcription": text}

@router.websocket("/live-voice")
async def live_voice_websocket(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_text(json.dumps({
        "type": "SESSION_STARTED",
        "event": "connected",
        "message": "ارتباط صوتی با مستشار قضایی برقرار شد.",
        "tier": "VIP",
        "barge_in": True
    }))

    if VOICE_REALTIME_PROVIDER == "gemini":
        # W20: hand the whole (already-accepted) connection to the Gemini
        # Live proxy for its lifetime instead of running the STT/LLM/TTS
        # cascade below. Same SESSION_STARTED contract as the cascade path
        # above, so the frontend needs no branching.
        from output_apps.ecosystem_core.src.factory.gemini_live_bridge import (
            run_gemini_realtime_session,
        )

        await run_gemini_realtime_session(websocket)
        return

    pcm_accumulator = bytearray()

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break

            if "bytes" in message and message["bytes"]:
                pcm_accumulator.extend(message["bytes"])
                continue

            if "text" in message and message["text"]:
                try:
                    data = json.loads(message["text"])
                except Exception:
                    continue

                event_type = str(data.get("type") or data.get("event") or "").lower()

                if event_type in ("commit", "audio_input", "speech_end"):
                    raw_bytes = bytes(pcm_accumulator)
                    pcm_accumulator.clear()

                    async def _handle_turn(audio_data: bytes):
                        turn_sw = Stopwatch()
                        try:
                            if len(audio_data) < 4800:
                                await websocket.send_text(json.dumps({"event": "turn_complete"}))
                                return

                            wav_data = pcm_to_wav(audio_data, 16000)
                            user_text = await transcribe_audio_payload(wav_data, "wav")

                            if not user_text or len(user_text.strip()) < 2 or user_text in HALLUCINATIONS:
                                await websocket.send_text(json.dumps({"event": "turn_complete"}))
                                return

                            await websocket.send_text(json.dumps({
                                "event": "user_transcription",
                                "type": "TRANSCRIPT",
                                "text": user_text
                            }))

                            if VOICE_STREAM_TTS:
                                sent_any = False

                                async def _on_sentence(sentence: str):
                                    nonlocal sent_any
                                    audio_b64 = await synthesize_speech_persian(sentence)
                                    if audio_b64:
                                        sent_any = True
                                        await websocket.send_text(json.dumps({
                                            "event": "agent_audio_stream",
                                            "type": "AUDIO_STREAM",
                                            "audio_data": audio_b64
                                        }))

                                reply_text = await analyze_legal_query_streaming(
                                    user_text, _on_sentence
                                )
                                await websocket.send_text(json.dumps({
                                    "event": "agent_text_response",
                                    "type": "ANSWER_TEXT",
                                    "text": reply_text
                                }))
                                if not sent_any:
                                    await websocket.send_text(json.dumps({"event": "turn_complete"}))
                            else:
                                reply_text = await analyze_legal_query(user_text)
                                await websocket.send_text(json.dumps({
                                    "event": "agent_text_response",
                                    "type": "ANSWER_TEXT",
                                    "text": reply_text
                                }))

                                audio_b64 = await synthesize_speech_persian(reply_text)
                                if audio_b64:
                                    await websocket.send_text(json.dumps({
                                        "event": "agent_audio_stream",
                                        "type": "AUDIO_STREAM",
                                        "audio_data": audio_b64
                                    }))
                                else:
                                    await websocket.send_text(json.dumps({"event": "turn_complete"}))

                        except Exception:
                            await websocket.send_text(json.dumps({"event": "turn_complete"}))
                        finally:
                            log_voice_timing(
                                "turn",
                                end_to_end_ms=turn_sw.elapsed_ms(),
                                streamed=VOICE_STREAM_TTS,
                            )

                    asyncio.create_task(_handle_turn(raw_bytes))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[WS-ERR] {exc}", file=sys.stderr)
