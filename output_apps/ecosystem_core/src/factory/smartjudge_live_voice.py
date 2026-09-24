import os, sys, json, io, wave, base64, asyncio, urllib.request, urllib.error, re
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, UploadFile, File, Request
from pydantic import BaseModel

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

async def transcribe_audio_payload(audio_bytes: bytes, audio_fmt: str = "wav") -> str:
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
                "model": "openai/whisper-large-v3-turbo",
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

async def analyze_legal_query(query_text: str) -> str:
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
        "model": "deepseek/deepseek-chat",
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

async def synthesize_speech_persian(text: str) -> str:
    try:
        import edge_tts
        comm = edge_tts.Communicate(text, "fa-IR-DilaraNeural", rate="+15%")
        buf = bytearray()
        async def _stream():
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    buf.extend(chunk["data"])
            return base64.b64encode(buf).decode("utf-8")
        return await asyncio.wait_for(_stream(), timeout=2.8)
    except Exception:
        return ""

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

                    asyncio.create_task(_handle_turn(raw_bytes))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[WS-ERR] {exc}", file=sys.stderr)
