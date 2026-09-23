import os, sys, json, io, wave, base64, asyncio, urllib.request, re
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/apps/judge", tags=["SmartJudgeVoice"])

# لیست فیلتر توهمات ویسپر روی سکوت
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

async def universal_transcribe(audio_bytes: bytes, filename: str = "audio.wav", content_type: str = "audio/wav") -> str:
    """تبدیل صوت به متن با پشتیبانی از انواع پسوندها و فرمت‌های مرورگرها"""
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    if openrouter_key:
        try:
            boundary = "----WebKitFormUniversalSTTBoundary"
            body = bytearray()
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nopenai/whisper-large-v3\r\n".encode("utf-8"))
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nfa\r\n".encode("utf-8"))
            sample_prompt = "سلام، پرسش حقوقی پرونده، آراء وحدت رویه دیوان عالی، مصوبات هیئت وزیران، دادگاه صلح سال ۱۴۰۵."
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\n{sample_prompt}\r\n".encode("utf-8"))
            
            # ارسال با پسوند و نوع داده واقعی جهت ممانعت از خطای دیکودر Whisper
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n".encode("utf-8"))
            body.extend(audio_bytes)
            body.extend(f"\r\n--{boundary}--\r\n".encode("utf-8"))

            req = urllib.request.Request(
                "https://openrouter.ai/api/v1/audio/transcriptions",
                data=bytes(body),
                headers={"Authorization": f"Bearer {openrouter_key}", "Content-Type": f"multipart/form-data; boundary={boundary}"},
                method="POST"
            )
            loop = asyncio.get_running_loop()
            def _call():
                with urllib.request.urlopen(req, timeout=6.0) as resp:
                    return json.loads(resp.read().decode("utf-8")).get("text", "")
            raw_text = await loop.run_in_executor(None, _call)
            if raw_text:
                return sanitize_transcription(raw_text)
        except Exception as e:
            print(f"[UNIVERSAL-STT-WARN] {e}", file=sys.stderr)

    try:
        from output_apps.ecosystem_core.src.factory.stt_engine import transcribe_audio_blob
        b64 = base64.b64encode(audio_bytes).decode("utf-8")
        loop = asyncio.get_running_loop()
        res = await loop.run_in_executor(None, transcribe_audio_blob, b64, content_type)
        return sanitize_transcription(str(res or ""))
    except Exception:
        return ""

async def analyze_legal_query(query_text: str) -> str:
    q_norm = query_text.lower().replace("؟", "").replace(".", "").strip()
    
    # شناسایی عبارات احوالپرسی فارسی و فینگلیش
    if q_norm in ["salam", "dorood", "سلام", "درود", "صبح بخیر", "عصر بخیر", "سلام علیکم"] or (len(q_norm) < 15 and "salam" in q_norm):
        return "سلام و احترام. من مستشار قضایی و دستیار هوشمند سامانه «قاضی هوشمند» هستم. لطفاً شرح دادخواست، پرسش یا پرونده حقوقی خود را بفرمایید تا بر اساس قوانین جاری و رویه قضایی راهنماییتان کنم."

    if any(p in q_norm for p in ["اسم تو چیه", "نام شما", "کی هستی", "کاربرد تو", "کارکرد تو", "who are you"]):
        return "من مستشار تخصصی قضایی سامانه «قاضی هوشمند» هستم. کاربرد اصلی من تحلیل پرونده‌های حقوقی و کیفری، استناد به آراء وحدت رویه، مصوبات هیئت وزیران و تنظیم اوراق قضایی است."

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
از علائم ستاره (*) و هشتگ (#) استفاده نکنید.
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
            with urllib.request.urlopen(req, timeout=5.0) as resp:
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

@router.post("/stt")
@router.post("/transcribe")
async def judge_stt_api(request: Request, file: UploadFile = File(None), audio: UploadFile = File(None)):
    """اندپوینت فراگیر تبدیل صوت به متن جهت دریافت ضبط مرورگرها"""
    target = file or audio
    if not target:
        form = await request.form()
        for k, v in form.items():
            if hasattr(v, "read"):
                target = v
                break

    if not target:
        return {"text": "", "error": "فایل صوتی یافت نشد."}

    content = await target.read()
    orig_name = getattr(target, "filename", "audio.mp4") or "audio.mp4"
    content_type = getattr(target, "content_type", "audio/mp4") or "audio/mp4"

    text = await universal_transcribe(content, orig_name, content_type)
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
                            user_text = await universal_transcribe(wav_data, "audio.wav", "audio/wav")

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
