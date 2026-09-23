import os, sys, json, io, wave, base64, asyncio, urllib.request, re
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/apps/judge", tags=["SmartJudgeVoice"])

# ۱. تعریف اندپوینت چت متنی جهت رفع خطای ۴۰۴
class ChatRequest(BaseModel):
    message: str
    conversation_id: str = None

@router.post("/chat")
async def judge_text_chat(req: ChatRequest):
    """اندپوینت چت متنی پایدار متصل به پایگاه داده قوانین و هوش تحلیلی"""
    reply = await analyze_legal_query(req.message)
    return {"reply": reply, "conversation_id": req.conversation_id or "conv_vip_default"}

BROAD_LEGAL_SYSTEM_PROMPT = """
امروز در سال ۱۴۰۵ هجری خورشیدی (۲۰۲۶ میلادی) قرار داریم.
شما مستشار ارشد دیوان و مشاور حقوقی-اقتصادی سامانه «قاضی هوشمند» هستید.
حیطه پاسخ‌گویی شما جامع بوده و کل نظام حقوقی، مالیاتی و تجاری ج.ا.ایران را در بر می‌گیرد:
۱. قوانین مدنی، تجارت، مجازات اسلامی، کار و آیین دادرسی
۲. آراء وحدت رویه دیوان عالی کشور و دیوان عدالت اداری
۳. مصوبات، آیین‌نامه‌ها و طرح‌های جامع هیئت وزیران (اصل ۱۳۸ قانون اساسی)
۴. بخشنامه‌ها و دستورالعمل‌های بانک مرکزی (ارزی، ریالی، تعهدات ارزی و چک صیادی)
۵. بخشنامه‌ها و مقررات وزارت صنعت، معدن و تجارت (سامانه جامع تجارت و ثبت سفارش)
۶. دستورالعمل‌های سازمان امور مالیاتی و سامانه مودیان

مستندات پایگاه داده:
{retrieved_context}

دستورالعمل تولید پاسخ:
۱. پاسخ شما باید بسیار مستند، عمیق و حاوی عنوان بخشنامه یا ماده قانون مرتبط باشد.
۲. کلام را حداکثر در ۳ تا ۴ جمله کوتاه، شیوا و رسا تنظیم کنید تا برای شنیدن روان باشد.
۳. در جمله آخر یک راهکار عملی یا سوال جهت تدقیق پرونده مطرح کنید.
۴. مطلقاً از علائم نگارشی مثل ستاره (*) و هشتگ (#) استفاده نکنید.
"""

# لیست فیلتر توهمات رایج ویسپر روی سکوت و نویز
HALLUCINATIONS = {"سلامتی.", "سلامتی", "بله.", "بله", "تشکر.", "تشکر", "زیرنویس", "...", "."}

PHONETIC_FIXES = [
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

async def transcribe_speech_persian(wav_bytes: bytes) -> str:
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    if openrouter_key:
        try:
            boundary = "----WebKitBoundaryLegalLiveSTT"
            body = bytearray()
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nopenai/whisper-large-v3\r\n".encode("utf-8"))
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nfa\r\n".encode("utf-8"))
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\nبخشنامه های قوه قضائیه، آراء وحدت رویه دیوان عالی، مصوبات هیئت وزیران، بانک مرکزی، صمت، قوانین سال ۱۴۰۵\r\n".encode("utf-8"))
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\n".encode("utf-8"))
            body.extend(wav_bytes)
            body.extend(f"\r\n--{boundary}--\r\n".encode("utf-8"))

            req = urllib.request.Request(
                "https://openrouter.ai/api/v1/audio/transcriptions",
                data=bytes(body),
                headers={"Authorization": f"Bearer {openrouter_key}", "Content-Type": f"multipart/form-data; boundary={boundary}"},
                method="POST"
            )
            loop = asyncio.get_running_loop()
            def _stt():
                with urllib.request.urlopen(req, timeout=4.0) as resp:
                    return json.loads(resp.read().decode("utf-8")).get("text", "")
            raw = await loop.run_in_executor(None, _stt)
            if raw:
                return sanitize_transcription(raw)
        except Exception as e:
            print(f"[STT-WARN] {e}", file=sys.stderr)

    try:
        from output_apps.ecosystem_core.src.factory.stt_engine import transcribe_audio_blob
        b64 = base64.b64encode(wav_bytes).decode("utf-8")
        loop = asyncio.get_running_loop()
        res = await loop.run_in_executor(None, transcribe_audio_blob, b64, "audio/wav")
        return sanitize_transcription(str(res or ""))
    except Exception:
        return ""

async def analyze_legal_query(query_text: str) -> str:
    context_data = ""
    try:
        from output_apps.generated_modules.smartjudge.smartjudge_module import aquery_knowledge_graph
        laws, prec = await asyncio.wait_for(aquery_knowledge_graph(query_text, limit=3), timeout=2.0)
        context_data = f"مستندات بازیابی‌شده:\nقوانین و مصوبات: {laws}\nآراء و بخشنامه‌ها: {prec}"
    except Exception:
        pass

    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    system_prompt = BROAD_LEGAL_SYSTEM_PROMPT.format(retrieved_context=context_data)

    payload = json.dumps({
        "model": "deepseek/deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query_text}
        ],
        "temperature": 0.2,
        "max_tokens": 240
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
            with urllib.request.urlopen(req, timeout=6.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data["choices"][0]["message"]["content"]
        raw = await loop.run_in_executor(None, _fetch)
        return raw.replace("*", "").replace("#", "").strip()
    except Exception as e:
        print(f"[LLM-WARN] {e}", file=sys.stderr)
        return "بر اساس مصوبات جاری هیئت وزیران و آخرین رویه قضایی، موضوع بر اساس صلاحیت مراجع صالحه و موازین قانونی تعیین تکلیف می‌گردد."

async def synthesize_speech_persian(text: str) -> str:
    """تبدیل متن به صوت با سقف زمانی محافظت‌شده ۳.۵ ثانیه‌ای"""
    try:
        import edge_tts
        comm = edge_tts.Communicate(text, "fa-IR-DilaraNeural", rate="+15%")
        buf = bytearray()
        
        async def _stream():
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    buf.extend(chunk["data"])
            return base64.b64encode(buf).decode("utf-8")

        return await asyncio.wait_for(_stream(), timeout=3.5)
    except Exception as e:
        print(f"[TTS-TIMEOUT/ERR] {e}", file=sys.stderr)
        return ""

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
                            # فیلتر صداهای کمتر از ۰.۴ ثانیه برای جلوگیری از نویز
                            if len(audio_data) < 6400:
                                await websocket.send_text(json.dumps({"event": "turn_complete"}))
                                return

                            wav_data = pcm_to_wav(audio_data, 16000)
                            user_text = await transcribe_speech_persian(wav_data)

                            # فیلتر توهمات ویسپر (مانند سلامتی، بله، تشکر)
                            if not user_text or len(user_text.strip()) < 3 or user_text in HALLUCINATIONS:
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

                        except Exception as exc:
                            print(f"[TURN-EXEC-ERR] {exc}", file=sys.stderr)
                            await websocket.send_text(json.dumps({"event": "turn_complete"}))

                    asyncio.create_task(_handle_turn(raw_bytes))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[WS-ERR] {exc}", file=sys.stderr)
