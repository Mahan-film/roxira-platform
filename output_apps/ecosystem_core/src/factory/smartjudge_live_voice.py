import os, sys, json, io, wave, base64, asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/api/v1/apps/judge", tags=["SmartJudgeVoice"])

def pcm_to_wav(pcm_data: bytes, sample_rate: int = 16000) -> bytes:
    wav_io = io.BytesIO()
    with wave.open(wav_io, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_data)
    return wav_io.getvalue()

async def safe_transcribe(wav_bytes: bytes) -> str:
    """تبدیل صوت به متن با اولویت Whisper محلی"""
    try:
        from output_apps.ecosystem_core.src.factory.stt_engine import transcribe_audio_blob
        b64_audio = base64.b64encode(wav_bytes).decode("utf-8")
        loop = asyncio.get_running_loop()
        text = await loop.run_in_executor(None, transcribe_audio_blob, b64_audio, "audio/wav")
        return str(text or "").strip()
    except Exception as e:
        print(f"[VOICE-STT-ERR] {e}", file=sys.stderr)
        return ""

async def fast_legal_reply(user_query: str) -> str:
    """تولید سریع پاسخ حقوقی با استفاده از استدلال حقوقی"""
    try:
        from output_apps.generated_modules.smartjudge.smartjudge_module import _voice_build_answer, aquery_knowledge_graph
        try:
            # استعلام سریع با سقف زمانی ۲ ثانیه برای جلوگیری از فریز شدن مکالمه
            laws, precedents = await asyncio.wait_for(aquery_knowledge_graph(user_query, limit=2), timeout=2.5)
        except Exception:
            laws, precedents = [], []
        reply = _voice_build_answer(user_query, laws, precedents)
        return reply.replace("*", "").replace("#", "")
    except Exception as e:
        print(f"[VOICE-LLM-ERR] {e}", file=sys.stderr)
        return f"در خصوص پرسش شما پیرامون «{user_query}»، طبق اصول حقوقی و مقررات جاری موضوع نیازمند بررسی مدارک و انطباق با قوانین ماهوی است."

async def fast_synthesize_speech(text: str) -> str:
    """تبدیل متن به صوت با استفاده از edge-tts درون کانتینر"""
    try:
        import edge_tts
        # انتخاب صدای فارسی پرسرعت و روان
        comm = edge_tts.Communicate(text, "fa-IR-DilaraNeural", rate="+15%")
        buf = bytearray()
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                buf.extend(chunk["data"])
        return base64.b64encode(buf).decode("utf-8")
    except Exception as e:
        print(f"[VOICE-TTS-ERR] {e}", file=sys.stderr)
        return ""

@router.websocket("/live-voice")
async def live_voice_websocket(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_text(json.dumps({"event": "connected", "message": "ارتباط AudioWorklet صوتی برقرار شد."}))

    pcm_accumulator = bytearray()
    current_task = None

    try:
        while True:
            message = await websocket.receive()
            
            if "bytes" in message and message["bytes"]:
                pcm_accumulator.extend(message["bytes"])
                continue

            if "text" in message and message["text"]:
                data = json.loads(message["text"])
                event_type = str(data.get("type", "")).lower()

                # دریافت وقفه جهت لغو پاسخ قبلی (Barge-in)
                if event_type == "interrupt":
                    if current_task and not current_task.done():
                        current_task.cancel()
                    pcm_accumulator.clear()
                    await websocket.send_text(json.dumps({"type": "INTERRUPT_ACK"}))
                    continue

                if event_type in ("commit", "audio_input", "speech_end"):
                    if len(pcm_accumulator) < 3200:
                        continue

                    raw_pcm = bytes(pcm_accumulator)
                    pcm_accumulator.clear()

                    async def _process_turn(audio_data: bytes):
                        wav_bytes = pcm_to_wav(audio_data, 16000)
                        user_text = await safe_transcribe(wav_bytes)
                        
                        if not user_text or len(user_text) < 2:
                            # در صورت نامفهوم بودن صدا
                            await websocket.send_text(json.dumps({
                                "event": "user_transcription",
                                "text": "..."
                            }))
                            await websocket.send_text(json.dumps({
                                "event": "agent_text_response",
                                "text": "متوجه کلام شما نشدم، لطفاً مجدداً بفرمایید."
                            }))
                            audio_b64 = await fast_synthesize_speech("متوجه کلام شما نشدم، لطفاً مجدداً بفرمایید.")
                            if audio_b64:
                                await websocket.send_text(json.dumps({
                                    "event": "agent_audio_stream",
                                    "audio_data": audio_b64
                                }))
                            return

                        # ارسال بلافاصله متن کاربر به چت‌باکس
                        await websocket.send_text(json.dumps({
                            "event": "user_transcription",
                            "text": user_text
                        }))

                        # تولید پاسخ حقوقی و ارسال هم‌زمان
                        reply_text = await fast_legal_reply(user_text)
                        await websocket.send_text(json.dumps({
                            "event": "agent_text_response",
                            "text": reply_text
                        }))

                        # سنتز صوت و پخش فوری
                        audio_b64 = await fast_synthesize_speech(reply_text)
                        if audio_b64:
                            await websocket.send_text(json.dumps({
                                "event": "agent_audio_stream",
                                "audio_data": audio_b64
                            }))

                    current_task = asyncio.create_task(_process_turn(raw_pcm))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[VOICE-LOOP-ERR] {exc}", file=sys.stderr)
