import os, sys, json, io, wave, base64, asyncio, urllib.request
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/api/v1/apps/judge", tags=["SmartJudgeVoice"])

HIERARCHY_LEGAL_PROMPT = """
شما مستشار عالی‌رتبه قضایی و حقوق‌دان ارشد سامانه «قاضی هوشمند» هستید و به صورت گفتگوی صوتی زنده پاسخ می‌دهید.
پاسخ شما باید مستند، دقیق، باوقار و منطبق بر سلسله‌مراتب هنجارهای حقوقی ج.ا.ایران باشد:
۱. قوانین عام و خاص مصوب مجلس شورای اسلامی و مجمع تشخیص مصلحت نظام
۲. آراء وحدت رویه هیأت عمومی دیوان عالی کشور و دیوان عدالت اداری (در حکم قانون)
۳. مقررات تقریری و آیین‌نامه‌های اجرایی مصوب هیئت وزیران (اصل ۱۳۸ قانون اساسی) و تصویب‌نامه‌های دولتی
۴. بخشنامه‌ها و دستورالعمل‌های اداری-قضایی و نظریات مشورتی اداره کل حقوقی قوه قضائیه

مستندات استخراج‌شده از مخزن پایگاه داده:
{retrieved_context}

اصول مکالمه صوتی:
۱. مستقیماً به استناد قانونی، شماره رأی وحدت رویه، یا تاریخ و عنوان تصویب‌نامه هیئت وزیران اشاره کنید.
۲. پاسخ را کامل، بدون ابهام و در قالب حداکثر ۳ تا ۵ جمله رسا بیان کنید.
۳. در جمله پایانی، راهکار اجرایی پرونده یا سوال تکمیلی را مطرح کنید.
۴. مطلقاً از علائم نگارشی نظیر ستاره (*) و هشتگ (#) استفاده نکنید تا صوت پیوسته و روان پخش شود.
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
    """تبدیل دقیق صوت با فیلتر واژگان تخصصی حقوقی، آیین‌نامه‌ها و مصوبات"""
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    if openrouter_key:
        try:
            boundary = "----WebKitBoundaryLegalPersianVoice"
            body = bytearray()
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nopenai/whisper-large-v3\r\n".encode("utf-8"))
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nfa\r\n".encode("utf-8"))
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\nقوانین مدنی، آراء وحدت رویه دیوان عالی کشور، مصوبات هیئت وزیران، آیین‌نامه اجرایی، بخشنامه قوه قضائیه، دادگاه صلح\r\n".encode("utf-8"))
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
    """استنتاج تحلیلی جامع بر پایه ادله حقوقی و مقررات دولتی"""
    context_data = ""
    try:
        from output_apps.generated_modules.smartjudge.smartjudge_module import aquery_knowledge_graph
        laws, prec = await asyncio.wait_for(aquery_knowledge_graph(query_text, limit=3), timeout=2.2)
        context_data = f"مستندات قانونی و قضایی استخراج‌شده از مخزن:\nقوانین و مصوبات دولت: {laws}\nآراء وحدت رویه و دادنامه‌ها: {prec}"
    except Exception:
        pass

    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    system_prompt = HIERARCHY_LEGAL_PROMPT.format(retrieved_context=context_data)

    payload = json.dumps({
        "model": "deepseek/deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query_text}
        ],
        "temperature": 0.2,
        "max_tokens": 220
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=payload,
        headers={"Authorization": f"Bearer {openrouter_key}", "Content-Type": f"application/json"},
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
        return "بر اساس مصوبات جاری هیئت وزیران، آیین‌نامه‌های اجرایی و آراء وحدت رویه دیوان عالی کشور، موضوع دارای احکام مشخص قانونی بوده و طبق صلاحیت ذاتی مراجع صالحه تعیین تکلیف می‌گردد."

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
    await websocket.send_text(json.dumps({"event": "connected", "message": "ارتباط صوتی با مستشار قضایی برقرار شد."}))

    pcm_accumulator = bytearray()

    try:
        while True:
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                pcm_accumulator.extend(message["bytes"])
                continue

            if "text" in message and message["text"]:
                data = json.loads(message["text"])
                event_type = str(data.get("type", "")).lower()

                if event_type in ("commit", "audio_input", "speech_end"):
                    if len(pcm_accumulator) < 4800:
                        continue

                    raw_bytes = bytes(pcm_accumulator)
                    pcm_accumulator.clear()

                    async def _handle_turn(audio_data: bytes):
                        wav_data = pcm_to_wav(audio_data, 16000)
                        user_text = await transcribe_speech_persian(wav_data)
                        if not user_text or len(user_text.strip()) < 2:
                            return

                        await websocket.send_text(json.dumps({"event": "user_transcription", "text": user_text}))

                        # تحلیل جامع حقوقی همراه با مصوبات
                        reply_text = await analyze_hierarchical_legal(user_text)
                        await websocket.send_text(json.dumps({"event": "agent_text_response", "text": reply_text}))

                        # سنتز صوت و ارسال کامل
                        audio_b64 = await synthesize_speech_persian(reply_text)
                        if audio_b64:
                            await websocket.send_text(json.dumps({"event": "agent_audio_stream", "audio_data": audio_b64}))

                    asyncio.create_task(_handle_turn(raw_bytes))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[WS-ERR] {exc}", file=sys.stderr)
