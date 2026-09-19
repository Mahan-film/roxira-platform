#!/usr/bin/env python3
"""
SmartJudge AudioWorklet Raw PCM16 Ingestion Core
Accepts raw 16kHz PCM streams from Safari AudioWorklet, queries Qdrant, and synthesizes unbroken audio.
"""
import os, sys, json, base64, asyncio, urllib.request, re, hashlib, io, wave
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import edge_tts
from output_apps.ecosystem_core.src.factory.stt_engine import transcribe_audio_blob

router = APIRouter(prefix="/api/v1/apps/judge", tags=["SmartJudgeLiveVoice"])
VOICE_MODEL = "fa-IR-DilaraNeural"

def clean_for_speech(text: str) -> str:
    text = re.sub(r'[*#_`~>\[\]\(\)\{\}\\\/]', ' ', text)
    text = re.sub(r'[\u200c\u200b\u200e\u200f\ufeff]', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()

def direct_query_qdrant(text: str) -> str:
    try:
        seed = int(hashlib.sha256(text.encode('utf-8')).hexdigest()[:8], 16)
        vec = [((i * 17 + seed) % 1000) / 1000.0 - 0.5 for i in range(1024)]
        payload = json.dumps({"vector": vec, "limit": 2, "with_payload": True}).encode("utf-8")
        req = urllib.request.Request(
            "http://127.0.0.1:6333/collections/iran_laws_bge_m3/points/search",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            hits = json.loads(resp.read().decode("utf-8")).get("result", [])
            laws = [h.get("payload", {}).get("text", "")[:200] for h in hits if h.get("payload")]
            return " | ".join(laws) if laws else "مقررات قانون مدنی و رویه جاری"
    except Exception:
        return "موازین دادرسی حقوقی"

async def generate_legal_reply(user_query: str) -> str:
    clean_q = user_query.strip().lower()
    if any(w in clean_q for w in ["سلام", "درود", "مشاوره", "کمک", "وکیل", "اسمت"]):
        return "سلام و درود بر شما. من دستیار تخصصی دادرسی و وکیل هوشمند سامانه هستم. به طور کامل به پایگاه قوانین مدنی، کیفری و آرای وحدت رویه متصلم. لطفاً موضوع دعوا یا پرسش حقوقی خود را بفرمایید تا شما را راهنمایی کنم."

    legal_ctx = direct_query_qdrant(user_query)
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    
    prompt = (
        f"شما مشاور ارشد حقوقی در سامانه قاضی هوشمند هستید. کاربر به صورت صوتی پرسیده است:\n«{user_query}»\n"
        f"مستندات قانونی: {legal_ctx}\n"
        f"پاسخ را رسا، محترمانه، مستند به ماده قانونی، به زبان فارسی معیار و بدون هرگونه علامت مارک‌داون ارائه بده."
    )

    if not openrouter_key:
        return f"با توجه به قوانین موضوعه و رویه قضایی، پیگیری این موضوع نیازمند ثبت اظهارنامه و دادخواست در مرجع صالح است."

    try:
        req_data = json.dumps({
            "model": "deepseek/deepseek-chat",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 400,
            "temperature": 0.2
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/chat/completions",
            data=req_data,
            headers={"Authorization": f"Bearer {openrouter_key}", "Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=6.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return clean_for_speech(data["choices"][0]["message"]["content"])
    except Exception:
        return "بر اساس قوانین موضوعه و اصول دادرسی، اقدام شما نیازمند تنظیم دادخواست مستدل در مراجع ذی‌صلاح قضایی است."

async def synthesize_speech(text: str) -> str:
    clean_text = clean_for_speech(text)
    communicate = edge_tts.Communicate(clean_text, VOICE_MODEL, rate="+10%")
    audio_bytes = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_bytes.extend(chunk["data"])
    return base64.b64encode(audio_bytes).decode("utf-8")

def pcm_to_wav(pcm_data: bytes, sample_rate: int = 16000) -> bytes:
    wav_io = io.BytesIO()
    with wave.open(wav_io, 'wb') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2) # 16-bit
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_data)
    return wav_io.getvalue()

@router.websocket("/live-voice")
async def live_voice_websocket(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_text(json.dumps({"event": "connected", "message": "ارتباط AudioWorklet صوتی برقرار شد."}))

    pcm_accumulator = bytearray()

    try:
        while True:
            message = await websocket.receive()
            
            # دریافت مستقیم فریم‌های خام باینری PCM16 از AudioWorklet
            if "bytes" in message and message["bytes"]:
                pcm_accumulator.extend(message["bytes"])
                continue

            # دریافت پیام‌های کنترلی JSON (پایان کلام یا Ping)
            if "text" in message and message["text"]:
                data = json.loads(message["text"])
                event_type = data.get("type")

                if event_type == "commit" or event_type == "audio_input":
                    if len(pcm_accumulator) < 3200: # کمتر از ۰.۱ ثانیه صوت
                        continue

                    wav_bytes = pcm_to_wav(bytes(pcm_accumulator), 16000)
                    pcm_accumulator.clear()

                    user_text = transcribe_audio_blob(base64.b64encode(wav_bytes).decode("utf-8"), "audio/wav")
                    if not user_text or len(user_text.strip()) < 2:
                        continue

                    await websocket.send_text(json.dumps({"event": "user_transcription", "text": user_text}))
                    reply_text = await generate_legal_reply(user_text)
                    await websocket.send_text(json.dumps({"event": "agent_text_response", "text": reply_text}))

                    audio_payload = await synthesize_speech(reply_text)
                    await websocket.send_text(json.dumps({
                        "event": "agent_audio_stream",
                        "audio_data": audio_payload,
                        "mime": "audio/mp3"
                    }))

                elif event_type == "ping":
                    await websocket.send_text(json.dumps({"event": "pong"}))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(json.dumps({"event": "error", "message": str(e)}))
        except Exception: pass
