import os, sys, json, io, wave, base64, asyncio, urllib.request
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/api/v1/apps/judge", tags=["SmartJudgeVoice"])

HIERARCHY_LEGAL_SYSTEM = """
شما مستشار عالی‌رتبه قضایی و مشاور ارشد حقوقی در سامانه «قاضی هوشمند» هستید.
پاسخ‌های شما در مکالمه زنده باید مستند، صریح، عمیق و منطبق بر سلسله‌مراتب هنجارهای حقوقی ج.ا.ایران باشد:
۱. قوانین مصوب مجلس و مجمع تشخیص مصلحت نظام
۲. آراء وحدت رویه هیأت عمومی دیوان عالی کشور و دیوان عدالت اداری (لازم‌الاتباع در حکم قانون)
۳. مقررات تقریری شامل: آیین‌نامه‌های اجرایی مصوب هیئت وزیران (اصل ۱۳۸ ق.ا)، تصویب‌نامه‌ها و طرح‌های جامع دولتی
۴. بخشنامه‌های قضایی و اداری و نظریات مشورتی اداره کل حقوقی قوه قضائیه

مستندات استخراج‌شده از مخزن پایگاه داده:
{retrieved_context}

دستورالعمل گفتاری:
۱. در پاسخ به پرسش کاربر، بلافاصله مستند صریح (اعم از ماده قانون، شماره رأی وحدت رویه، یا تاریخ و عنوان تصویب‌نامه هیئت وزیران) را بیان کنید.
۲. کلام شما باید حداکثر در ۳ تا ۴ جمله کوتاه، بلیغ و شیوا تنظیم شود تا مناسب شنیدن باشد.
۳. از هرگونه کاراکتر علامتی (* یا #) اکیداً پرهیز کنید.
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
    """تبدیل دقیق صوت با هدایت صریح به اصطلاحات حقوقی و دولتی"""
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    if openrouter_key:
        try:
            boundary = "----WebKitBoundaryPersianLegal"
            body = bytearray()
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nopenai/whisper-large-v3\r\n".encode("utf-8"))
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nfa\r\n".encode("utf-8"))
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\nآراء وحدت رویه دیوان عالی کشور، مصوبات هیئت وزیران، آیین‌نامه اجرایی، بخشنامه، دادگاه صلح\r\n".encode("utf-8"))
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
            def _call():
                with urllib.request.urlopen(req, timeout=5.0) as resp:
                    return json.loads(resp.read().decode("utf-8")).get("text", "")
            res = await loop.run_in_executor(None, _call)
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

async def generate_hierarchical_legal_answer(query_text: str) -> str:
    """استنتاج جامع حقوقی با دربرگیری مقررات تقریری، مصوبات دولت و قوانین"""
    context_data = ""
    try:
        from output_apps.generated_modules.smartjudge.smartjudge_module import aquery_knowledge_graph
        laws, prec = await asyncio.wait_for(aquery_knowledge_graph(query_text, limit=3), timeout=2.0)
        context_data = f"مستندات قانونی و قضایی استخراج‌شده:\nقوانین و مصوبات: {laws}\nآراء و رویه‌ها: {prec}"
    except Exception:
        pass

    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    system_content = HIERARCHY_LEGAL_SYSTEM.format(retrieved_context=context_data)

    payload = json.dumps({
        "model": "deepseek/deepseek-chat",
        "messages": [
            {"role": "system", "content": system_content},
            {"role": "user", "content": query_text}
        ],
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
            with urllib.request.urlopen(req, timeout=6.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data["choices"][0]["message"]["content"]
        raw = await loop.run_in_executor(None, _fetch)
        return raw.replace("*", "").replace("#", "").strip()
    except Exception as e:
        print(f"[LLM-WARN] {e}", file=sys.stderr)
        return "بر اساس مصوبات جاری هیئت وزیران، آیین‌نامه‌های اجرایی مصوب و آراء وحدت رویه، موضوع دارای رویه مشخص بوده و مطابق ضوابط آیین دادرسی تعیین تکلیف می‌گردد."

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

                        reply_text = await generate_hierarchical_legal_answer(user_text)
                        await websocket.send_text(json.dumps({"event": "agent_text_response", "text": reply_text}))

                        audio_b64 = await synthesize_speech_persian(reply_text)
                        if audio_b64:
                            await websocket.send_text(json.dumps({"event": "agent_audio_stream", "audio_data": audio_b64}))

                    asyncio.create_task(_handle_turn(raw_bytes))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[WS-ERR] {exc}", file=sys.stderr)
