#!/usr/bin/env python3
"""
Roxira Speech-to-Text with AI Post-Correction (Bilingual Technical Transcribe)
"""
import os, json, urllib.request
from output_apps.ecosystem_core.src.factory.llm_client import get_config, ask_deepseek

def post_correct_transcription(raw_text: str) -> str:
    if not raw_text or len(raw_text.strip()) < 3:
        return raw_text

    system_prompt = (
        "You are an expert speech recognition post-processing engine specializing in software engineering, cloud, and modern AI architectures. "
        "The input is a raw, transcribed speech from a developer speaking Persian, English, or mixed technical terms. "
        "Your task: Correct phonetic transcription errors, typos, and acoustic artifacts (e.g. fix 'ویب' to 'وب', 'فرانس' to 'فرانت‌اند', 'هست' to 'هاست', 'راه اندازه' to 'راه‌اندازی'). "
        "Maintain the exact user intent. Do NOT answer the prompt. Output ONLY the polished, grammatically correct text without any quotes or commentary."
    )

    corrected = ask_deepseek(f"متن خام ضبط‌شده:\n{raw_text}", system_prompt)
    return corrected.strip().strip('"').strip("'") if corrected else raw_text

def transcribe_audio_blob(audio_b64: str, mime_type: str = "audio/webm") -> str:
    cfg = get_config()
    api_key = cfg.get("api_key")
    if not api_key:
        return "خطا: کلید دسترسی OpenRouter یافت نشد."

    fmt = "webm"
    if "mp4" in mime_type: fmt = "mp4"
    elif "wav" in mime_type: fmt = "wav"

    url = "https://openrouter.ai/api/v1/audio/transcriptions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://roxira.ir",
        "X-Title": "Roxira Speech Recognition"
    }

    payload = json.dumps({
        "model": "openai/whisper-large-v3",
        "input_audio": {"data": audio_b64, "format": fmt}
    }).encode("utf-8")

    raw_text = ""
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            raw_text = data.get("text", "").strip()
    except Exception as e:
        # فالبک به whisper-1 در صورت شلوغی سرور
        try:
            payload_fb = json.dumps({
                "model": "openai/whisper-1",
                "input_audio": {"data": audio_b64, "format": fmt}
            }).encode("utf-8")
            req_fb = urllib.request.Request(url, data=payload_fb, headers=headers, method="POST")
            with urllib.request.urlopen(req_fb, timeout=40) as resp_fb:
                data_fb = json.loads(resp_fb.read().decode("utf-8"))
                raw_text = data_fb.get("text", "").strip()
        except Exception:
            return f"خطای ارتباط با سرور صوت: {e}"

    if raw_text:
        # پالایش و تصحیح غلط‌های املایی صوتی
        return post_correct_transcription(raw_text)
    return ""
