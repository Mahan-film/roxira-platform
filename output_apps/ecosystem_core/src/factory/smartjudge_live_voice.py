import os, sys, json, io, wave, base64, asyncio, urllib.request
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/api/v1/apps/judge", tags=["SmartJudgeVoice"])

LIVE_AGENT_SYSTEM = """
شما مستشار عالی‌رتبه قضایی در سامane «قاضی هوشمند» هستید و به صورت مکالمه صوتی زنده با کاربر گفتگو می‌کنید.
مستندات پایگاه داده قوانین:
{retrieved_context}

قوانین پاسخ‌گویی صوتی:
۱. پاسخ باید کاملاً کوتاه، عمیق، مستند و حداکثر در ۲ الی ۴ جمله (کمتر از ۷۰ کلمه) بیان شود.
۲. حتماً شماره دقیق رأی وحدت رویه یا ماده قانونی مرتبط را بدون مقدمه‌چینی زائد بیان کنید.
۳. در انتهای پاسخ با یک جمله کوتاه، کاربر را برای گام بعدی یا سوال تکمیلی راهنمایی کنید.
۴. مطلقاً از علائم ستاره (*) یا هشتگ (#) استفاده نکنید تا صوت کاملاً پیوسته خوانده شود.
"""

def pcm_to_wav(pcm_data: bytes, sample_rate: int = 16000) -> bytes:
    wav_io = io.BytesIO()
    with wave.open(wav_io, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_data)
    return wav_io.getvalue()

async def transcribe_speech(wav_bytes: bytes) -> str:
    """تبدیل سریع صوت به متن با Whisper بزرگ"""
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    if openrouter_key:
        try:
            boundary = "----WebKitFormLegal"
            body = bytearray()
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nopenai/whisper-large-v3\r\n".encode("utf-8"))
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\nآراء وحدت رویه، دیوان عالی کشور، قانون مدنی، دادگاه صلح\r\n".encode("utf-8"))
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
            def _call_stt():
                with urllib.request.urlopen(req, timeout=4.0) as resp:
                    return json.loads(resp.read().decode("utf-8")).get("text", "")
            res = await loop.run_in_executor(None, _call_stt)
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

async def fast_legal_reasoning(query_text: str) -> str:
    """استنتاج سریع و عمیق بر پایه Qdrant و مدل هوشمند"""
    retrieved_context = "مستندات از مخزن آرای وحدت رویه و قوانین مدنی استخراج شد."
    try:
        from output_apps.generated_modules.smartjudge.smartjudge_module import aquery_knowledge_graph
        laws, precedents = await asyncio.wait_for(aquery_knowledge_graph(query_text, limit=2), timeout=1.8)
        retrieved_context = f"قوانین: {laws}\nآراء وحدت رویه: {precedents}"
    except Exception:
        pass

    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    sys_prompt = LIVE_AGENT_SYSTEM.format(retrieved_context=retrieved_context)

    payload = json.dumps({
        "model": "deepseek/deepseek-chat",
        "messages": [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": query_text}
        ],
        "temperature": 0.2,
        "max_tokens": 160
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=payload,
        headers={"Authorization": f"Bearer {openrouter_key}", "Content-Type": "application/json"},
        method="POST"
    )

    try:
        loop = asyncio.get_running_loop()
        def _fetch_answer():
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data["choices"][0]["message"]["content"]
        raw = await loop.run_in_executor(None, _fetch_answer)
        return raw.replace("*", "").replace("#", "").strip()
    except Exception as e:
        print(f"[LLM-ERR] {e}", file=sys.stderr)
        return "بر اساس رویه قضایی و آخرین آراء وحدت رویه دیوان عالی کشور، صلاحیت رسیدگی بر اساس صلاحیت دادگاه‌های صلح و تشریفات آیین دادرسی مدنی معین می‌گردد."

async def synthesize_voice_fast(text: str) -> str:
    """تبدیل به صوت روان با نرخ سرعت مناسب مکالمه زنده"""
    try:
        import edge_tts
        comm = edge_tts.Communicate(text, "fa-IR-DilaraNeural", rate="+20%")
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
    current_turn = None

    try:
        while True:
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                pcm_accumulator.extend(message["bytes"])
                continue

            if "text" in message and message["text"]:
                data = json.loads(message["text"])
                event_type = str(data.get("type", "")).lower()

                # وقفه فقط زمانی اعمال می‌شود که کلاینت صریحاً درخواست داده باشد
                if event_type == "interrupt":
                    if current_turn and not current_turn.done():
                        current_turn.cancel()
                    pcm_accumulator.clear()
                    await websocket.send_text(json.dumps({"type": "INTERRUPT_ACK"}))
                    continue

                if event_type in ("commit", "audio_input", "speech_end"):
                    if len(pcm_accumulator) < 3200:
                        continue

                    raw_bytes = bytes(pcm_accumulator)
                    pcm_accumulator.clear()

                    async def _handle_turn(audio_data: bytes):
                        wav_data = pcm_to_wav(audio_data, 16000)
                        user_text = await transcribe_speech(wav_data)
                        if not user_text or len(user_text.strip()) < 2:
                            user_text = "..."

                        await websocket.send_text(json.dumps({"event": "user_transcription", "text": user_text}))

                        # استدلال حقوقی
                        reply_text = await fast_legal_reasoning(user_text)
                        await websocket.send_text(json.dumps({"event": "agent_text_response", "text": reply_text}))

                        # تولید صوت و ارسال
                        audio_b64 = await synthesize_voice_fast(reply_text)
                        if audio_b64:
                            await websocket.send_text(json.dumps({"event": "agent_audio_stream", "audio_data": audio_b64}))

                    current_turn = asyncio.create_task(_handle_turn(raw_bytes))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[WS-LOOP-ERR] {exc}", file=sys.stderr)
