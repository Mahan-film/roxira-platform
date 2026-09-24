#!/usr/bin/env python3
"""
Roxira Live Voice Duplex Bridge (WebRTC / Streaming Audio Core)
Manages low-latency audio streaming, VAD state, and bi-directional voice events.
"""
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from output_apps.ecosystem_core.src.factory.stt_engine import transcribe_audio_blob

router = APIRouter(prefix="/api/v1/factory/live-voice", tags=["LiveVoiceDuplex"])

@router.websocket("/ws")
async def live_voice_websocket(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_text(json.dumps({
        "event": "connected",
        "message": "کانال ارتباط صوتی دوطرفه زنده (Roxira LiveKit-Ready Bridge) فعال است.",
        "protocol": "WebRTC-Stream-v1"
    }))
    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            evt_type = payload.get("type")

            if evt_type == "audio_chunk":
                audio_b64 = payload.get("data", "")
                mime = payload.get("mime", "audio/webm")
                # پردازش آنی چانک صدا
                text_stream = transcribe_audio_blob(audio_b64, mime)
                await websocket.send_text(json.dumps({
                    "event": "transcription_delta",
                    "text": text_stream,
                    "is_final": payload.get("is_final", False)
                }))

            elif evt_type == "ping":
                await websocket.send_text(json.dumps({"event": "pong"}))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(json.dumps({"event": "error", "message": str(e)}))
        except Exception: pass
