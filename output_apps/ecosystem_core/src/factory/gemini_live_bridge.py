#!/usr/bin/env python3
"""
SmartJudge Gemini 3.8 Live API Native Duplex Bridge (2026 Standard)
Bypasses slow STT/TTS cascades, delivering sub-300ms speech-to-speech interaction.
"""
import os, json, asyncio, base64
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

router = APIRouter(prefix="/api/v1/apps/judge", tags=["GeminiLiveVoice"])

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL_NAME = "models/gemini-3.8-live"

SYSTEM_INSTRUCTION = """
شما وکیل ارشد و دستیار هوشمند حقوقی در سامانه «قاضی هوشمند» ایران هستید.
پاسخ‌های شما باید مستند، رسا، کاملاً به زبان فارسی معیار و محترمانه باشد.
در گفتگوهای زنده صوتی، پاسخ‌ها را کوتاه، موجز و بدون استفاده از کاراکترهای مارک‌داون بیان کنید تا شنونده به راحتی متوجه شود.
"""

@router.websocket("/live-voice")
async def live_voice_gemini(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_json({"type": "SESSION_STARTED", "tier": "VIP", "engine": "Gemini-3.8-Live"})

    api_key = os.environ.get("GEMINI_API_KEY") or GEMINI_API_KEY
    if not api_key:
        await websocket.send_json({"type": "error", "message": "کلید GEMINI_API_KEY تنظیم نشده است."})
        await websocket.close()
        return

    client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Zephyr")
            )
        ),
        system_instruction=types.Content(parts=[types.Part.from_text(text=SYSTEM_INSTRUCTION)])
    )

    try:
        async with client.aio.live.connect(model=MODEL_NAME, config=config) as session:
            
            # حلقه ۱: دریافت صدا از کلاینت و ارسال مستقیم فریم‌های PCM به جمینای
            async def receive_from_client():
                try:
                    while True:
                        msg = await websocket.receive()
                        if "bytes" in msg and msg["bytes"]:
                            # ارسال فریم خام صوتی ۱۶ کیلوهرتزی میکروفون به جمینای
                            await session.send(input={"data": msg["bytes"], "mime_type": "audio/pcm;rate=16000"})
                        elif "text" in msg and msg["text"]:
                            data = json.loads(msg["text"])
                            if data.get("type") == "INTERRUPT":
                                # در صورت تشخیص قطع صحبت
                                pass
                except Exception:
                    pass

            # حلقه ۲: دریافت استریم بومی صدا از جمینای و ارسال درجا به اسپیکر مرورگر
            async def send_to_client():
                try:
                    while True:
                        turn = session.receive()
                        async for response in turn:
                            # ارسال متن بازشناسی‌شده (Transcript)
                            if response.text:
                                await websocket.send_json({"type": "TRANSCRIPT", "text": response.text})
                            
                            # ارسال داده‌های صوتی ۲۴ کیلوهرتزی تولیدشده توسط مدل
                            if response.data:
                                audio_b64 = base64.b64encode(response.data).decode("utf-8")
                                await websocket.send_json({
                                    "type": "AUDIO_STREAM",
                                    "audio_data": audio_b64,
                                    "mime": "audio/pcm;rate=24000"
                                })
                except Exception:
                    pass

            await asyncio.gather(receive_from_client(), send_to_client())

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception: pass
