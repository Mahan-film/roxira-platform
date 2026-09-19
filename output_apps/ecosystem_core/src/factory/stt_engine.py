#!/usr/bin/env python3
import json
import urllib.request
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
        "X-Title": "Roxira Speech Recognition Engine"
    }

    prompt = (
        "Transcribe this audio verbatim. "
        "The user might speak Persian (Farsi), English, or both mixed together. "
        "Detect the language automatically. "
        "Do NOT translate. Output ONLY the exact transcribed text without any quotes, conversational filler, or commentary."
    )

    models = [
        "google/gemini-2.0-flash-001",
        "google/gemini-flash-1.5",
        "google/gemini-2.0-flash-exp:free"
    ]

    for model in models:
        payload = json.dumps({
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{clean_mime};base64,{audio_b64}"
                            }
                        }
                    ]
                }
            ],
            "temperature": 0.0
        }).encode("utf-8")

        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                text = data["choices"][0]["message"]["content"].strip()
                if text:
                    return text
        except Exception as e:
            print(f"⚠️ تلاش با مدل {model} با خطا مواجه شد: {e}")
            continue

    return ""
