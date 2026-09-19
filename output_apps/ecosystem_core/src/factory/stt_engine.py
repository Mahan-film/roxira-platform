#!/usr/bin/env python3
"""
Roxira High-Speed Speech-to-Text Engine (< 1.5s latency)
Uses Gemini 2.0 Flash One-Shot Audio Transcription + Technical Polishing
"""
import os, json, urllib.request
from output_apps.ecosystem_core.src.factory.llm_client import get_config

def transcribe_audio_blob(audio_b64: str, mime_type: str = "audio/webm") -> str:
    cfg = get_config()
    api_key = cfg.get("api_key")
    if not api_key:
        return "خطا: کلید دسترسی OpenRouter در سرور یافت نشد."

    clean_mime = mime_type.split(";")[0].strip() or "audio/webm"
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://roxira.ir",
        "X-Title": "Roxira High-Speed Voice Engine"
    }

    # پرامپت تلفیقی: تبدیل صوت + تشخیص همزمان زبان + تصحیح غلط‌های تلفظی در ۱ مرحله
    prompt = (
        "Transcribe this audio verbatim. The speaker may speak Persian, English, or mixed technical terms. "
        "Correct phonetic mistakes (e.g. 'ویب' to 'وب', 'فرانس' to 'فرانت‌اند', 'هست' to 'هاست'). "
        "Do NOT translate. Output ONLY the polished, final transcription text without any conversational filler."
    )

    payload = json.dumps({
        "model": "google/gemini-2.0-flash-001",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{clean_mime};base64,{audio_b64}"}}
                ]
            }
        ],
        "temperature": 0.0
    }).encode("utf-8")

    try:
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"].strip().strip('"').strip("'")
    except Exception as e:
        # فالبک سریع در صورت اختلال کلود
        try:
            url_w = "https://openrouter.ai/api/v1/audio/transcriptions"
            fmt = "mp4" if "mp4" in clean_mime else "webm"
            payload_w = json.dumps({"model": "openai/whisper-large-v3", "input_audio": {"data": audio_b64, "format": fmt}}).encode("utf-8")
            req_w = urllib.request.Request(url_w, data=payload_w, headers=headers, method="POST")
            with urllib.request.urlopen(req_w, timeout=10) as resp_w:
                data_w = json.loads(resp_w.read().decode("utf-8"))
                return data_w.get("text", "").strip()
        except Exception:
            return f"خطا در پردازش صوت: {e}"
