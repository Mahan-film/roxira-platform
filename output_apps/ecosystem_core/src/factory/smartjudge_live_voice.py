import os, sys, json, io, wave, base64, asyncio, urllib.request
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/api/v1/apps/judge", tags=["SmartJudgeVoice"])

HIERARCHY_LEGAL_SYSTEM = """
شما مستشار عالی‌رتبه قضایی و حقوق‌دان ارشد در سامانه «قاضی هوشمند» هستید.
پاسخ‌های شما باید مستند، عمیق، فصیح و بر پایه سلسله‌مراتب هنجارهای حقوقی ج.ا.ایران تنظیم شود:
۱. قوانین مدنی، تجارت، مجازات اسلامی و آیین دادرسی دادگاه‌ها
۲. آراء وحدت رویه دیوان عالی کشور و دیوان عدالت اداری
۳. مقررات تقریری شامل: آیین‌نامه‌های اجرایی، تصویب‌نامه‌های هیئت وزیران (اصل ۱۳۸ ق.ا) و نظام‌نامه‌های دولتی
۴. بخشنامه‌ها و نظریه‌های مشورتی اداره کل حقوقی قوه قضائیه

مستندات بازیابی‌شده از مخزن داده:
{retrieved_context}

اصول پاسخ‌گویی صوتی:
۱. مستقیماً به شماره مواد، شماره رأی وحدت رویه، یا تاریخ و عنوان تصویب‌نامه هیئت وزیران استناد نمایید.
۲. کلام شما باید حداکثر در ۳ تا ۴ جمله رسا، روشن و کامل باشد تا شنونده به راحتی متوجه شود.
۳. در جمله آخر، آثار عملی پرونده یا پیشنهاد دادرسی را مطرح نمایید.
۴. از به کار بردن علائم نگارشی مثل ستاره (*) و هشتگ (#) پرهیز کنید تا صوت کاملاً پیوسته خوانده شود.
"""

def pcm_to_wav(pcm_data: bytes, sample_rate: int = 16000) -> bytes:
    wav_io = io.BytesIO()
    with wave.open(wav_io, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_data)
    return wav_io.getvalue()

async def transcribe_speech_persian(wav_bytes: bytes) -> str:
    """تبدیل دقیق صوت با فیلتر زبان فارسی و واژگان تخصصی حقوقی و مصوبات دولتی"""
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    if openrouter_key:
        try:
            boundary = "----WebKitFormPersianVoice"
            body = bytearray()
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nopenai/whisper-large-v3\r\n".encode("utf-8"))
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nfa\r\n".encode("utf-8"))
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\nآراء وحدت رویه دیوان عالی کشور، مصوبات هیئت وزیران، آیین‌نامه اجرایی، قوانین مدنی و کیفری، دادگاه صلح\r\n".encode("utf-8"))
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
                with urllib.request.urlopen(req, timeout=5.0) as resp:
                    return json.loads(resp.read().decode("utf-8")).get("text", "")
            res = await loop.run_in_executor(None, _stt)
            if res and len(res.strip()) > 1:
                return res.strip()
        except Exception as e:
            print(f"[STT-WARN] {e}", file=sys.stderr)

    try:
        from output_apps.ecosystem_core.src.factory.stt_engine import transcribe_audio_blob
        b64 = base64.b64encode(wav_bytes).decode("utf-8")
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, transcribe_audio_blob, b64, "audio/wav")
    except Exception:
        return ""

async def analyze_hierarchical_legal(query_text: str) -> str:
    """استنتاج جامع حقوقی با دربرگیری مقررات تقریری و تصویب‌نامه‌های هیئت وزیران"""
    context_data = ""
    try:
        from output_apps.generated_modules.smartjudge.smartjudge_module import aquery_knowledge_graph
        laws, prec = await asyncio.wait_for(aquery_knowledge_graph(query_text, limit=3), timeout=2.2)
        context_data = f"مستندات قانونی و قضایی استخراج‌شده از مخزن پایگاه داده:\nقوانین و مصوبات هیئت وزیران: {laws}\nآراء وحدت رویه و دادنامه‌ها: {prec}"
    except Exception:
        pass

    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    system_prompt = HIERARCHY_LEGAL_SYSTEM.format(retrieved_context=context_data)

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
            with urllib.request.urlopen(req, timeout=7.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data["choices"][0]["message"]["content"]
        raw = await loop.run_in_executor(None, _fetch)
        return raw.replace("*", "").replace("#", "").strip()
    except Exception as e:
        print(f"[LLM-WARN] {e}", file=sys.stderr)
        return "مطابق با مقررات تقریری مصوب هیئت وزیران و آراء وحدت رویه دیوان عالی کشور، موضوع بر اساس صلاحیت ذاتی مراجع قضایی و قواعد حاکم بر آیین دادرسی بررسی و تعیین تکلیف می‌گردد."

async def synthesize_speech_persian(text: str) -> str:
    try:
        import edge_tts
        comm = edge_tts.Communicate(text, "fa-IR-DilaraNeural", rate="+15%")
        buf = bytearray()
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                buf.extend(chunk["data"])
        return base64.b64encode(buf).decode("utf-8")
    except Exception as e:
        print(f"[TTS-ERR] {e}", file=sys.stderr)
        return ""

@router.websocket("/live-voice")
async def live_voice_websocket(websocket: WebSocket):
    await websocket.accept()
    # ارسال پیام آغاز ارتباط پایدار با سازگاری دوگانه فرانت‌اند
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
            # استفاده از ساختار استاندارد دریافت پیام وب‌سوکت
            message = await websocket.receive()
            msg_type = message.get("type")

            # خروج تمیز در صورت قطع ارتباط بدون پرتاب Exception
            if msg_type == "websocket.disconnect":
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
                    if len(pcm_accumulator) < 3200:
                        continue

                    raw_bytes = bytes(pcm_accumulator)
                    pcm_accumulator.clear()

                    async def _process_turn(audio_data: bytes):
                        wav_data = pcm_to_wav(audio_data, 16000)
                        user_text = await transcribe_speech_persian(wav_data)
                        if not user_text or len(user_text.strip()) < 2:
                            return

                        # ارسال با فرمت استاندارد دوگانه
                        await websocket.send_text(json.dumps({
                            "event": "user_transcription",
                            "type": "TRANSCRIPT",
                            "text": user_text
                        }))

                        # تحلیل حقوقی و استخراج ادله
                        reply_text = await analyze_hierarchical_legal(user_text)
                        await websocket.send_text(json.dumps({
                            "event": "agent_text_response",
                            "type": "ANSWER_TEXT",
                            "text": reply_text
                        }))

                        # سنتز صوت و استریم
                        audio_b64 = await synthesize_speech_persian(reply_text)
                        if audio_b64:
                            await websocket.send_text(json.dumps({
                                "event": "agent_audio_stream",
                                "type": "AUDIO_STREAM",
                                "audio_data": audio_b64
                            }))

                    asyncio.create_task(_process_turn(raw_bytes))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[WS-ERR] {exc}", file=sys.stderr)
