#!/usr/bin/env python3
"""
Roxira Dual-Agent Acoustic & Phonetic Correction Engine
Agent 1: In-memory ffmpeg PCM + One-Shot Gemini 2.0 Flash Candidate
Agent 2: Technical Domain Phonetic Rescorer (Corrects acoustic slips)
"""
import os, json, subprocess, base64, urllib.request, re
from output_apps.ecosystem_core.src.factory.llm_client import get_config, ask_deepseek

PHONETIC_REPLACEMENT_RULES = [
    (r'\bجاییتر\b', 'جدیدترین'),
    (r'\bتکلیجی\b', 'تکنولوژی'),
    (r'\bتکنولوجی\b', 'تکنولوژی'),
    (r'\bصدا به مچ\b', 'صوت به متن'),
    (r'\bصوت به مچ\b', 'صوت به متن'),
    (r'\bصوت به مت\b', 'صوت به متن'),
    (r'\bصدا به مت\b', 'صوت به متن'),
    (r'\bلایف چات\b', 'لایو چت'),
    (r'\bلایف اسپیک\b', 'لایو اسپیک'),
    (r'\bجیسرش\b', 'ریسرچ'),
    (r'\bویب\b', 'وب'),
    (r'\bفرانس\b', 'فرانت‌اند'),
    (r'\bهست\b', 'هاست'),
    (r'\bچی استش\b', 'چیست')
]

def apply_rule_based_phonetics(text: str) -> str:
    """اصلاح مستقیم و بدون تاخیر لغزش‌های رایج آوایی با Regex"""
    result = text
    for pattern, replacement in PHONETIC_REPLACEMENT_RULES:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    return result

def phonetic_rescorer_agent(raw_text: str) -> str:
    """عامل هوشمند انطباق آوایی برای تضمین درستی کامل اصطلاحات مهندسی"""
    pre_cleaned = apply_rule_based_phonetics(raw_text)
    if not pre_cleaned or len(pre_cleaned.strip()) < 4:
        return pre_cleaned

    # اگر لغزش‌های مشکوک هنوز باقی مانده باشد، عامل زبانی سریع آن را پالایش می‌کند
    sys_prompt = (
        "شما یک عامل متخصص بازسازی آوایی و تصحیح گفتار برای مهندسان نرم‌افزار هستید. "
        "متن ورودی حاصل تبدیل صوت به متن است که ممکن است به دلیل نویز میکروفون دچار لغزش‌های آوایی شده باشد "
        "(مثلاً تبدیل 'جدیدترین' به 'جاییتر' یا 'تکنولوژی' به 'تکلیجی' یا 'متن' به 'مت'). "
        "مقصود دقیق گوینده را با رعایت نگارش استاندارد مهندسی فارسی و اصطلاحات انگلیسی بازسازی کنید. "
        "فقط و فقط جمله اصلاح‌شده نهایی را بدون هیچ توضیح اضافی یا علامت گیومه خروجی دهید."
    )

    refined = ask_deepseek(f"متن ورودی:\n{pre_cleaned}", sys_prompt)
    return refined.strip().strip('"').strip("'") if refined else pre_cleaned

def convert_to_wav_pcm(audio_bytes: bytes) -> bytes:
    try:
        cmd = ["ffmpeg", "-y", "-i", "pipe:0", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"]
        proc = subprocess.run(cmd, input=audio_bytes, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3)
        if proc.returncode == 0 and len(proc.stdout) > 44:
            return proc.stdout
    except Exception: pass
    return audio_bytes

def transcribe_audio_blob(audio_b64: str, mime_type: str = "audio/webm") -> str:
    cfg = get_config()
    api_key = cfg.get("api_key")
    if not api_key:
        return "خطا: کلید API در سرور یافت نشد."

    try:
        raw_audio = base64.b64decode(audio_b64)
    except Exception as e:
        return f"خطا در دیکود فایل صوتی: {e}"

    wav_bytes = convert_to_wav_pcm(raw_audio)
    clean_b64 = base64.b64encode(wav_bytes).decode("utf-8")

    # عامل ۱: استخراج اولیه صوت
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "HTTP-Referer": "https://roxira.ir"}

    payload = json.dumps({
        "model": "google/gemini-2.0-flash-001",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "Transcribe this audio verbatim in Persian/English technical context."},
                {"type": "input_audio", "input_audio": {"data": clean_b64, "format": "wav"}}
            ]
        }],
        "temperature": 0.0
    }).encode("utf-8")

    raw_text = ""
    try:
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            raw_text = data["choices"][0]["message"]["content"].strip()
    except Exception:
        # فالبک اضطراری به Whisper
        try:
            url_w = "https://openrouter.ai/api/v1/audio/transcriptions"
            p_w = json.dumps({"model": "openai/whisper-large-v3", "input_audio": {"data": clean_b64, "format": "wav"}}).encode("utf-8")
            req_w = urllib.request.Request(url_w, data=p_w, headers=headers, method="POST")
            with urllib.request.urlopen(req_w, timeout=8) as resp_w:
                data_w = json.loads(resp_w.read().decode("utf-8"))
                raw_text = data_w.get("text", "").strip()
        except Exception as e2:
            return f"خطا در موتور صوت: {e2}"

    # عامل ۲: پالایش و بازسازی فونتیک بدون خطا
    if raw_text:
        return phonetic_rescorer_agent(raw_text)
    return ""
