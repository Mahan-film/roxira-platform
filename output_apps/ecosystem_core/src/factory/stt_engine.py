#!/usr/bin/env python3
"""
Roxira Dual-Agent Acoustic & Phonetic Correction Engine
Agent 1: In-memory ffmpeg PCM + remote STT over the config/models.yaml `stt`
    role's fallback chain (W15: replaces the dead, retired
    google/gemini-2.0-flash-001 id that used to be hardcoded here -- see
    config/models.yaml's `stt` role note and issue #39).
Agent 2: Technical Domain Phonetic Rescorer (Corrects acoustic slips)
"""
import os
import json, logging, subprocess, base64, urllib.request, urllib.error, re
from output_apps.ecosystem_core.src.factory.llm_client import get_config, ask_deepseek

logger = logging.getLogger(__name__)

# Used only if config/models.yaml / model_registry.py cannot be read (missing
# file, malformed YAML, PyYAML not installed) -- must never be the dead
# google/gemini-2.0-flash-001 id. Mirrors the registry's current `stt` role
# order so the behaviour is the same whether or not the registry loads.
_DEFAULT_STT_CHAIN = ["openai/whisper-large-v3-turbo", "openai/gpt-audio"]


def _stt_model_chain() -> list:
    """Ordered STT model ids to try: config/models.yaml's `stt` role
    (primary first, then fallbacks), else _DEFAULT_STT_CHAIN. Never raises --
    a missing/malformed registry file must not break this local-engine
    fallback path (same contract as smartjudge_live_voice.py's
    _default_stt_model)."""
    try:
        from output_apps.generated_modules.smartjudge import model_registry

        ids = model_registry.role_models("stt")
        if ids:
            return ids
    except Exception:
        pass
    return list(_DEFAULT_STT_CHAIN)


def _call_stt_model(model_id: str, clean_b64: str, headers: dict) -> str:
    """Call one STT model id with the request shape its endpoint expects:
    dedicated Whisper ids use OpenRouter's /audio/transcriptions endpoint,
    everything else (general multimodal chat models) uses /chat/completions
    with an input_audio content part."""
    is_whisper = "whisper" in model_id.lower()
    if is_whisper:
        url = "https://openrouter.ai/api/v1/audio/transcriptions"
        payload = {
            "model": model_id,
            "input_audio": {"data": clean_b64, "format": "wav"},
            "language": "fa",
            "temperature": 0,
            "prompt": STT_PROMPT,
        }
    else:
        url = "https://openrouter.ai/api/v1/chat/completions"
        payload = json.dumps(
            {
                "model": model_id,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": (
                                    "Transcribe this audio verbatim in "
                                    "Persian/English technical context."
                                ),
                            },
                            {
                                "type": "input_audio",
                                "input_audio": {"data": clean_b64, "format": "wav"},
                            },
                        ],
                    }
                ],
                "temperature": 0.0,
            }
        )

    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if not is_whisper or error.code not in (400, 422):
            raise
        fallback_payload = {
            key: value
            for key, value in payload.items()
            if key not in {"language", "temperature", "prompt"}
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(fallback_payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    if "choices" in data:
        return (data["choices"][0]["message"]["content"] or "").strip()
    return (data.get("text") or "").strip()

STT_PROMPT = "فارسی ایران. سامانه قاضی هوشمند؛ قوه قضائیه؛ دادگاه؛ دادخواست؛ لایحه؛ رأی وحدت رویه؛ سلام، تو کی هستی."
STT_PHRASE_CORRECTIONS = {"سلام از فتیر دویستی": "سلام تو کی هستی"}


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
    (r'\bچی استش\b', 'چیست')
]

def apply_phrase_corrections(text: str) -> str:
    """Apply exact corrections for known Whisper transcription failures."""
    normalized = text.strip().replace("ي", "ی").replace("ك", "ک")
    return STT_PHRASE_CORRECTIONS.get(normalized, text)


def apply_rule_based_phonetics(text: str) -> str:
    """اصلاح مستقیم و بدون تاخیر لغزش‌های رایج آوایی با Regex"""
    text = apply_phrase_corrections(text)
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

    if os.environ.get("ROXIRA_STT_LOCAL") == "1":
        try:
            from .stt_local_whisper import is_confident, transcribe_local

            local_text, min_logprob = transcribe_local(wav_bytes, STT_PROMPT)
            if is_confident(local_text, min_logprob):
                return phonetic_rescorer_agent(local_text)
        except Exception as exc:
            logger.warning("Local faster-whisper transcription failed: %s", exc)
    clean_b64 = base64.b64encode(wav_bytes).decode("utf-8")

    # عامل اول: استخراج اولیه صوت -- زنجیره فال‌بک از نقش stt در config/models.yaml
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://roxira.ir",
    }

    chain = _stt_model_chain()
    raw_text = ""
    last_error: Exception | None = None
    for idx, model_id in enumerate(chain):
        try:
            raw_text = _call_stt_model(model_id, clean_b64, headers)
        except Exception as e:
            last_error = e
            logger.warning("[STT-FALLBACK] model %r failed (%s); trying next in chain", model_id, e)
            continue
        if raw_text:
            if idx > 0:
                logger.warning(
                    "[STT-FALLBACK] used fallback STT model %r (position %d/%d, stt role chain)",
                    model_id, idx + 1, len(chain),
                )
            break

    if not raw_text and last_error is not None:
        return f"خطا در موتور صوت: {last_error}"

    # عامل ۲: پالایش و بازسازی فونتیک بدون خطا
    if raw_text:
        return phonetic_rescorer_agent(raw_text)
    return ""
