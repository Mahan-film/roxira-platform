#!/usr/bin/env python3
"""
Roxira Voice Engine with Engineering Context Injection & Semantic Correction
"""
import os, json, urllib.request
from output_apps.ecosystem_core.src.factory.llm_client import get_config, ask_deepseek

ENGINEERING_CONTEXT_PROMPT = (
    "واژگان و اصطلاحات کلیدی: تبدیل صوت به متن (STT)، تبدیل متن به صوت (TTS)، "
    "صوت به صوت (Speech to Speech / S2S)، لایو چت، لایو اسپیک، مدل‌های زبانی، "
    "WebRTC، وب‌اپلیکیشن، هوش مصنوعی، عامل‌های خودکار، پایگاه داده، فرانت‌اند، بک‌اند."
)

def repair_transcription_phonetics(raw_text: str) -> str:
    """اصلاح فوری اشتباهات شنیداری گفتار با حفظ ۱۰۰٪ مقصود کاربر"""
    if not raw_text or len(raw_text.strip()) < 3:
        return raw_text

    sys_p = (
        "You are an expert speech recognition error correction engine for software engineers. "
        "Fix obvious phonetically mistranscribed Persian words based on technical programming context: "
        "e.g. 'صدا به مچ' -> 'صدا به متن / صوت به متن', 'تبیل' -> 'تبدیل', 'لایف چات' -> 'لایو چت', "
        "'جیسرش' -> 'ریسرچ', 'ویب' -> 'وب', 'فرانس' -> 'فرانت‌اند'. "
        "Keep the exact natural question intent. Output ONLY the repaired sentence without quotes or intro."
    )
    repaired = ask_deepseek(f"متن خام:\n{raw_text}", sys_p)
    return repaired.strip().strip('"').strip("'") if repaired else raw_text

def transcribe_audio_blob(audio_b64: str, mime_type: str = "audio/webm") -> str:
    cfg = get_config()
    api_key = cfg.get("api_key")
    if not api_key:
        return "خطا: کلید OpenRouter در سرور موجود نیست."

    clean_mime = mime_type.split(";")[0].strip() or "audio/webm"
    fmt = "mp4" if "mp4" in clean_mime else "webm"

    url_w = "https://openrouter.ai/api/v1/audio/transcriptions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://roxira.ir",
        "X-Title": "Roxira Precision Voice"
    }

    # پی‌لود مجهز به prompt اولیه برای جلوگیری از خطای شنیداری
    payload = json.dumps({
        "model": "openai/whisper-large-v3",
        "input_audio": {"data": audio_b64, "format": fmt},
        "prompt": ENGINEERING_CONTEXT_PROMPT
    }).encode("utf-8")

    raw_text = ""
    try:
        req = urllib.request.Request(url_w, data=payload, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            raw_text = data.get("text", "").strip()
    except Exception:
        # فالبک تک‌مرحله‌ای با جمینای در صورت وقفه
        try:
            url_g = "https://openrouter.ai/api/v1/chat/completions"
            p_g = json.dumps({
                "model": "google/gemini-2.0-flash-001",
                "messages": [{"role": "user", "content": [
                    {"type": "text", "text": "Transcribe this verbatim with accurate Persian technical spelling."},
                    {"type": "image_url", "image_url": {"url": f"data:{clean_mime};base64,{audio_b64}"}}
                ]}]
            }).encode("utf-8")
            req_g = urllib.request.Request(url_g, data=p_g, headers=headers, method="POST")
            with urllib.request.urlopen(req_g, timeout=10) as resp_g:
                data_g = json.loads(resp_g.read().decode("utf-8"))
                raw_text = data_g["choices"][0]["message"]["content"].strip()
        except Exception as e2:
            return f"خطا در پردازش صوت: {e2}"

    if raw_text:
        return repair_transcription_phonetics(raw_text)
    return ""
