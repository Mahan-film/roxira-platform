#!/usr/bin/env python3
"""
Roxira High-Speed Multimodal Voice Engine (< 1s Latency)
In-memory ffmpeg 16kHz PCM conversion + One-Shot Gemini 2.0 Flash Audio Transcription
"""
import os, json, subprocess, base64, urllib.request
from output_apps.ecosystem_core.src.factory.llm_client import get_config

SYSTEM_PROMPT = (
    "You are a professional software engineering transcription engine. "
    "Transcribe the provided audio verbatim with 100% precision. "
    "Accurately recognize mixed Persian and English technical terminology "
    "(e.g., STT, TTS, S2S, LiveKit, WebRTC, API, RAG, Python, FastAPI, Docker, Microservices, ERP, CRM). "
    "Correct phonetic and acoustic slips seamlessly. Do NOT translate. "
    "Output ONLY the exact transcribed text without any quotes, preambles, or conversational filler."
)

def convert_to_wav_pcm(audio_bytes: bytes) -> bytes:
    """تبدیل فوق‌سریع هرگونه جریان صوتی (WebM, Opus, MP4) به استاندارد 16kHz Mono WAV در رم"""
    try:
        cmd = [
            "ffmpeg", "-y", "-i", "pipe:0",
            "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
            "-f", "wav", "pipe:1"
        ]
        proc = subprocess.run(cmd, input=audio_bytes, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3)
        if proc.returncode == 0 and len(proc.stdout) > 44:
            return proc.stdout
    except Exception:
        pass
    return audio_bytes

def transcribe_audio_blob(audio_b64: str, mime_type: str = "audio/webm") -> str:
    cfg = get_config()
    api_key = cfg.get("api_key")
    if not api_key:
        return "خطا: کلید ارتباطی در سرور موجود نیست."

    try:
        raw_audio = base64.b64decode(audio_b64)
    except Exception as e:
        return f"خطا در کدگشایی داده صوتی: {e}"

    # تبدیل صدا در حافظه رم به استاندارد ۱۶ کیلوهرتز WAV
    wav_bytes = convert_to_wav_pcm(raw_audio)
    clean_b64 = base64.b64encode(wav_bytes).decode("utf-8")

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://roxira.ir",
        "X-Title": "Roxira Realtime Speech"
    }

    # ارسال تک‌مرحله‌ای با ساختار استاندارد input_audio
    payload = json.dumps({
        "model": "google/gemini-2.0-flash-001",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": SYSTEM_PROMPT},
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": clean_b64,
                            "format": "wav"
                        }
                    }
                ]
            }
        ],
        "temperature": 0.0
    }).encode("utf-8")

    try:
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            text = data["choices"][0]["message"]["content"].strip()
            return text.strip('"').strip("'")
    except Exception as e:
        # فالبک سریع به مدل Whisper Large v3 Turbo در صورت اختلال
        try:
            url_w = "https://openrouter.ai/api/v1/audio/transcriptions"
            payload_w = json.dumps({
                "model": "openai/whisper-large-v3",
                "input_audio": {"data": clean_b64, "format": "wav"}
            }).encode("utf-8")
            req_w = urllib.request.Request(url_w, data=payload_w, headers=headers, method="POST")
            with urllib.request.urlopen(req_w, timeout=8) as resp_w:
                data_w = json.loads(resp_w.read().decode("utf-8"))
                return data_w.get("text", "").strip()
        except Exception:
            return f"خطا در پردازش صوت: {e}"
