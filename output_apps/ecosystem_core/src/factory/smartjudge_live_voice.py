import os, sys, json, io, wave, base64, asyncio, urllib.request, re
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/api/v1/apps/judge", tags=["SmartJudgeVoice"])

CURRENT_LEGAL_DATE_PROMPT = """
امروز در سال ۱۴۰۵ هجری خورشیدی (سال ۲۰۲۶ میلادی) قرار داریم.
شما مستشار عالی‌رتبه قضایی سامانه «قاضی هوشمند» هستید.
پاسخ شما به کاربر باید کاملاً منطبق بر آخرین تحولات قضایی تا سال ۱۴۰۵ باشد:
۱. در پاسخ به پرسش‌های مربوط به «آخرین رأی وحدت رویه» یا «آخرین بخشنامه قوه قضائیه»، مطلقاً به آرای منسوخ یا قدیمی سال‌های ۱۴۰۱ و ۱۴۰۲ به عنوان «آخرین رأی» استناد نکنید.
۲. اگر در مستندات پایگاه داده، رکوردهای جدید سال‌های ۱۴۰۴ و ۱۴۰۵ موجود است، به شماره و مفاد دقیق آن‌ها اشاره فرمایید. در غیر این صورت، صراحتاً اعلام کنید که آخرین موارد ثبتی در پایگاه تا دوره اخیر چه مواردی بوده است.
۳. سلسله‌مراتب هنجارها (قوانین مجلس، آراء وحدت رویه، مصوبات هیئت وزیران و بخشنامه‌های اداری-قضایی) را رعایت نمایید.
۴. لحن کلام باید فاخر، صریح و بدون به کار بردن علامت‌های ستاره (*) یا هشتگ (#) باشد.
"""

# جدول انطباق و تصحیح خطاهای شنیداری رایج در گفتار حقوقی
PHONETIC_CORRECTIONS = [
    (r"محتم\s*صدیه", "وحدت رویه"),
    (r"وقت\s*رو\s*رویه", "وحدت رویه"),
    (r"قبغذایی", "قوه قضائیه"),
    (r"قوه\s*غذایی", "قوه قضائیه"),
    (r"به\s*چه\s*شیر\s*صورت", "به چه صورت"),
    (r"دادگاه\s*صلح\s*و\s*سازش", "دادگاه صلح"),
]

def correct_legal_phonetics(text: str) -> str:
    cleaned = text
    for pattern, repl in PHONETIC_CORRECTIONS:
        cleaned = re.sub(pattern, repl, cleaned, flags=re.IGNORECASE)
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
            boundary = "----WebKitBoundaryLegalPersianVoice"
            body = bytearray()
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nopenai/whisper-large-v3\r\n".encode("utf-8"))
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nfa\r\n".encode("utf-8"))
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\nآراء وحدت رویه دیوان عالی کشور، بخشنامه های رئیس قوه قضائیه، مصوبات هیئت وزیران، سال ۱۴۰۵ و ۱۴۰۴، قوانین دادگاه صلح\r\n".encode("utf-8"))
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
                with urllib.request.urlopen(req, timeout=4.5) as resp:
                    return json.loads(resp.read().decode("utf-8")).get("text", "")
            raw_text = await loop.run_in_executor(None, _stt)
            if raw_text:
                return correct_legal_phonetics(raw_text.strip())
        except Exception as e:
            print(f"[STT-WARN] {e}", file=sys.stderr)

    try:
        from output_apps.ecosystem_core.src.factory.stt_engine import transcribe_audio_blob
        b64 = base64.b64encode(wav_bytes).decode("utf-8")
        loop = asyncio.get_running_loop()
        res = await loop.run_in_executor(None, transcribe_audio_blob, b64, "audio/wav")
        return correct_legal_phonetics(str(res or "").strip())
    except Exception:
        return ""

async def retrieve_time_aware_legal_context(query_text: str) -> str:
    """استخراج ادله با تفکیک جستجوی زمانی برای پرسش‌های مربوط به آخرین مصوبات"""
    is_temporal = any(w in query_text for w in ["آخرین", "جدیدترین", "اخیرا", "تازه ترین", "امسال"])
    context_data = ""

    try:
        from output_apps.generated_modules.smartjudge.smartjudge_module import aquery_knowledge_graph
        # در پرسش‌های مربوط به آخرین آراء، دامنه کاوش افزایش می‌یابد
        limit_val = 5 if is_temporal else 3
        laws, prec = await asyncio.wait_for(aquery_knowledge_graph(query_text, limit=limit_val), timeout=2.2)
        context_data = f"مستندات قانونی و قضایی استخراج‌شده از مخزن پایگاه داده:\nقوانین و مصوبات: {laws}\nآراء وحدت رویه و بخشنامه‌ها: {prec}"
    except Exception:
        pass

    return context_data

async def analyze_hierarchical_legal(query_text: str) -> str:
    context_data = await retrieve_time_aware_legal_context(query_text)
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")

    system_prompt = f"{CURRENT_LEGAL_DATE_PROMPT}\n\nمستندات موجود در پایگاه داده:\n{context_data}"

    payload = json.dumps({
        "model": "deepseek/deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query_text}
        ],
        "temperature": 0.15,
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
            with urllib.request.urlopen(req, timeout=6.5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data["choices"][0]["message"]["content"]
        raw = await loop.run_in_executor(None, _fetch)
        return raw.replace("*", "").replace("#", "").strip()
    except Exception as e:
        print(f"[LLM-WARN] {e}", file=sys.stderr)
        return "مطابق با موازین قانونی و آخرین رویه‌های قضایی دیوان عالی کشور و مصوبات هیئت وزیران، موضوع بر اساس صلاحیت مراجع صالحه و ضوابط دادرسی تعیین تکلیف می‌گردد."

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
        print(f"[TTS-WARN] {e}", file=sys.stderr)
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

                    async def _process_turn(audio_data: bytes):
                        try:
                            if len(audio_data) < 3200:
                                await websocket.send_text(json.dumps({
                                    "event": "user_transcription",
                                    "type": "TRANSCRIPT",
                                    "text": "..."
                                }))
                                await websocket.send_text(json.dumps({
                                    "event": "agent_text_response",
                                    "type": "ANSWER_TEXT",
                                    "text": "صدایی دریافت نشد؛ لطفاً مجدداً بفرمایید."
                                }))
                                await websocket.send_text(json.dumps({"event": "turn_complete"}))
                                return

                            wav_data = pcm_to_wav(audio_data, 16000)
                            user_text = await transcribe_speech_persian(wav_data)

                            if not user_text or len(user_text.strip()) < 2:
                                await websocket.send_text(json.dumps({
                                    "event": "user_transcription",
                                    "type": "TRANSCRIPT",
                                    "text": "..."
                                }))
                                await websocket.send_text(json.dumps({
                                    "event": "agent_text_response",
                                    "type": "ANSWER_TEXT",
                                    "text": "پرسش شما مفهوم نبود؛ لطفاً مجدداً سوال حقوقی خود را بفرمایید."
                                }))
                                await websocket.send_text(json.dumps({"event": "turn_complete"}))
                                return

                            await websocket.send_text(json.dumps({
                                "event": "user_transcription",
                                "type": "TRANSCRIPT",
                                "text": user_text
                            }))

                            reply_text = await analyze_hierarchical_legal(user_text)
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
                            print(f"[TURN-ERR] {exc}", file=sys.stderr)
                            await websocket.send_text(json.dumps({"event": "turn_complete"}))

                    asyncio.create_task(_process_turn(raw_bytes))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[WS-ERR] {exc}", file=sys.stderr)
