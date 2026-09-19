#!/usr/bin/env python3
"""
Roxira Official Speech-to-Text Engine (OpenRouter / Whisper Large V3)
"""
import os
import json
import urllib.request
from output_apps.ecosystem_core.src.factory.llm_client import get_config

def transcribe_audio_blob(audio_b64: str, mime_type: str = "audio/webm") -> str:
    cfg = get_config()
    api_key = cfg.get("api_key")
    if not api_key:
        return "خطا: کلید دسترسی OpenRouter در فایل‌های پیکربندی سرور یافت نشد."

    # استخراج فرمت فایل (مانند webm, mp4, wav)
    fmt = "webm"
    if "mp4" in mime_type: fmt = "mp4"
    elif "wav" in mime_type: fmt = "wav"
    elif "ogg" in mime_type: fmt = "ogg"

    url = "https://openrouter.ai/api/v1/audio/transcriptions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://roxira.ir",
        "X-Title": "Roxira Speech Recognition"
    }

    # پی‌لود رسمی استاندارد OpenRouter STT
    payload = json.dumps({
        "model": "openai/whisper-large-v3",
        "input_audio": {
            "data": audio_b64,
            "format": fmt
        }
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("text", "").strip()
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        print(f"⚠️ خطای OpenRouter STT: {err_msg}")
        # فالبک به مدل whisper-1
        try:
            payload_fb = json.dumps({
                "model": "openai/whisper-1",
                "input_audio": {"data": audio_b64, "format": fmt}
            }).encode("utf-8")
            req_fb = urllib.request.Request(url, data=payload_fb, headers=headers, method="POST")
            with urllib.request.urlopen(req_fb, timeout=40) as resp_fb:
                data_fb = json.loads(resp_fb.read().decode("utf-8"))
                return data_fb.get("text", "").strip()
        except Exception as e_fb:
            return f"خطای پردازش صوت در سرویس ابری: {e_fb}"
    except Exception as e:
        return f"خطای ارتباط با سرور: {e}"
