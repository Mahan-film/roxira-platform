"""
ROXIRA SMARTJUDGE — موتور قضایی واقعی مبتنی بر Dual-Level LightRAG + OpenRouter LLM

معماری کامل بدون هیچ Mock / داده ساختگی:
  • لایه برداری (Vector): Qdrant — iran_laws_bge_m3 / judicial_precedents /
    judiciary_circulars / legal_advisory_opinions
  • لایه گراف (Graph): PostgreSQL — پیمایش graph_nodes و graph_edges با روابط
    MODIFIES / EXCEPTS / GOVERNS / REFERENCES (منطق Dual-Level بازیابی LightRAG)
  • دیسپچر چندسطحی LLM روی https://openrouter.ai/api/v1/chat/completions:
      Tier 1 (فوق‌ارزان/سریع):  google/gemini-3.5-flash-lite | deepseek/deepseek-v4-flash-0731 | z-ai/glm-5.3-flash
      Tier 2 (دقت بالا):   openai/gpt-5.6-luna | deepseek/deepseek-v4-pro | google/gemini-3.8-flash
      Tier 3 (تحلیل عمیق): openai/gpt-5.6-luna | deepseek/deepseek-v4-pro | google/gemini-3.8-flash
    سقف توکن سخت‌گیرانه: tier1=2000 / tier2=3500 / tier3=4500 (حذف ارورهای 402)
  • پرووایدر Kira AI روی https://kiraai.vn/api/v1 — موتور استدلال سنگین قضایی:
      glm-5.3-free (استدلال عمیق؛ استخراج reasoning_content و content با سقف ۲۰۰۰ توکن)
      kira-mini-1.0 (پشتیبان بدون هزینه با بافر ورودی ۱ میلیون توکن — Fallback Engine)
  • تبدیل گفتار به متن فارسی سمت سرور: استخر کلیدهای AssemblyAI (۵ کلید با
    غیرفعال‌سازی فوری کلید مردود/مصرف‌شده روی 401/402/429 و ارسال همان‌لحظه‌ای
    درخواست با کلید بعدی — speech_model=best و language_code=fa) →
    پشتیبان سریع Groq Whisper-large-v3-turbo → faster-whisper محلی

هر پاسخ حقوقی «فقط» با استنتاج زنده LLM روی اسناد واقعی بازیابی‌شده تولید می‌شود.
در نبود سرویس خارجی، خطای صادقانه (502/503) برمی‌گردد — نه پاسخ ساختگی.
"""
import asyncio
import json
import logging
import os
import pathlib
import re
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

logger = logging.getLogger("roxira.smartjudge")

router = APIRouter(prefix="/api/v1/apps/judge", tags=["سامانه قاضی هوشمند و استدلال حقوقی (Legal Suite)"])


def _read_env_key(name: str) -> str:
    val = os.getenv(name, "").strip()
    if val:
        return val
    env_p = pathlib.Path("/opt/roxira_platform/.env")
    if not env_p.exists():
        env_p = pathlib.Path("/app/.env")
    if env_p.exists():
        try:
            for line in env_p.read_text(encoding="utf-8", errors="ignore").splitlines():
                if line.startswith(f"{name}="):
                    return line.split("=", 1)[1].strip().strip("'\"")
        except Exception:
            pass
    return ""


# ─────────────────────────────────────────────────────────────────────────────
# پیکربندی لایه‌های بازیابی (Vector + Graph) و کلیدهای سرویس‌های ابری
# ─────────────────────────────────────────────────────────────────────────────
QDRANT_HOST = _read_env_key("QDRANT_HOST") or "qdrant_prod"
QDRANT_PORT = _read_env_key("QDRANT_PORT") or "6333"
QDRANT_BASE = f"http://{QDRANT_HOST}:{QDRANT_PORT}"
OPENROUTER_BASE = (_read_env_key("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1").rstrip("/")

# کالکشن‌های برداری واقعی (لایه ۱ — Vector)
VECTOR_COLLECTIONS: Dict[str, str] = {
    "laws": "iran_laws_bge_m3",
    "precedents": "judicial_precedents",
    "circulars": "judiciary_circulars",
    "advisories": "legal_advisory_opinions",
}

# روابط گراف حقوقی (لایه ۲ — Graph / PostgreSQL)
GRAPH_RELATIONS = ["MODIFIES", "EXCEPTS", "GOVERNS", "REFERENCES"]
GRAPH_MAX_HOPS = 2
GRAPH_MAX_NODES = 24
GRAPH_MAX_EDGES = 48
DEFAULT_DATABASE_URL = "postgresql://enterprise_admin:REDACTED_SECRET_19@postgres_prod:5432/enterprise_db"

OPENROUTER_KEY = _read_env_key("OPENROUTER_API_KEY") or _read_env_key("LLM_API_KEY")
OPENAI_API_KEY = _read_env_key("OPENAI_API_KEY")
GROQ_API_KEY = _read_env_key("GROQ_API_KEY")
GROQ_STT_MODEL = _read_env_key("GROQ_STT_MODEL") or "whisper-large-v3-turbo"

# ─────────────────────────────────────────────────────────────────────────────
# AssemblyAI — استخر چندکلیدی گفتاربه‌متن (ASSEMBLYAI_API_KEYS با جداکننده کاما)
#   در مواجهه با خطای 401/402/429 کلید به‌صورت خودکار چرخش می‌کند تا خط لوله
#   STT هرگز روی یک کلید نامعتبر/مصرف‌شده متوقف نشود.
# ─────────────────────────────────────────────────────────────────────────────
ASSEMBLYAI_API_KEYS: List[str] = [
    k.strip()
    for k in (
        _read_env_key("ASSEMBLYAI_API_KEYS") or _read_env_key("ASSEMBLYAI_API_KEY")
    ).split(",")
    if k.strip()
]
ASSEMBLYAI_BASE = (_read_env_key("ASSEMBLYAI_BASE_URL") or "https://api.assemblyai.com/v2").rstrip("/")
# speech_model='best' — بالاترین دقت پردازش گفتار فارسی (fa)؛ «nano» به‌عنوان سبک‌وزن.
ASSEMBLYAI_STT_MODEL = _read_env_key("ASSEMBLYAI_STT_MODEL") or "best"
# معادل رسمی جدید «best» (در صورت deprecation پارامتر speech_model) — ترتیب اولویت دقت.
ASSEMBLYAI_BEST_MODELS = ["universal-3-5-pro", "universal-2"]
ASSEMBLYAI_ROTATE_STATUS = {401, 402, 429}

# ─────────────────────────────────────────────────────────────────────────────
# پرووایدر Kira AI — موتور استدلال سنگین قضایی + پشتیبان بدون هزینه
#   • KIRA_REASONING_MODEL = glm-5.3-free : تسک‌های استدلال قضایی عمیق
#     (استخراج هم‌زمان reasoning_content و content با سقف سخت ۲۰۰۰ توکن)
#   • KIRA_FALLBACK_MODEL  = kira-mini-1.0 : پرونده‌های حجیم با بافر ورودی
#     ۱ میلیون توکن به‌عنوان Fallback Engine رایگان (در نبود/شکست OpenRouter)
# ─────────────────────────────────────────────────────────────────────────────
KIRA_BASE = (_read_env_key("KIRA_BASE_URL") or "https://kiraai.vn/api/v1").rstrip("/")
KIRA_KEY = _read_env_key("KIRA_API_KEY") or "REDACTED_SECRET_07"
KIRA_REASONING_MODEL = _read_env_key("KIRA_REASONING_MODEL") or "glm-5.3-free"
KIRA_FALLBACK_MODEL = _read_env_key("KIRA_FALLBACK_MODEL") or "kira-mini-1.0"
KIRA_REASONING_MAX_TOKENS = 2000
KIRA_FALLBACK_CONTEXT_TOKENS = 1_000_000
KIRA_FALLBACK_OUTPUT_TOKENS = 8192
# سقف سخت تایم‌اوت Kira AI (۵ ثانیه): در صورت تأخیر/خطای 504 بلافاصله به
# OpenRouter هدایت می‌شود تا پاسخ کاربر معطل درگاه کندِ Kira نماند.
KIRA_MAX_TIMEOUT = 5.0

# ─────────────────────────────────────────────────────────────────────────────
# سوگیری واژگان تخصصی حقوقی برای گفتاربه‌متن فارسی (Task 1 — High-Precision STT)
# این پرامپت مدل Whisper را روی واژگان دقیق قضایی قفل می‌کند تا تحریف‌های آوایی
# (مثل «رئیم باحتت ربیه») به معادل صحیح («رأی وحدت رویه هیئت عمومی دیوان عالی کشور»)
# اصلاح شوند.
# Task 3 — رفع برش دنباله (Tail Truncation): عبارت پایانی گفتاری
# «لطفاً به صورت خیلی خلاصه توضیح دهید» مدل را به تکمیل تمیز انتهای گفتار و
# پرهیز از قطع ناگهانی جمله آخر سوق می‌دهد؛ دسته دادگاه‌های انتظامی/نظامی نیز افزوده شد.
# ─────────────────────────────────────────────────────────────────────────────
LEGAL_STT_PROMPT = (
    "سامانه هوشمند استدلال قضایی و حقوقی ایران. واژگان کلیدی: رأی وحدت رویه هیئت عمومی دیوان عالی کشور، "
    "دادگاه صلح، دادگاه عمومی حقوقی و کیفری، خسارت تأخیر تأدیه، ماده ۵۲۲ آیین دادرسی مدنی، "
    "قانون صدور چک، سامانه صیاد، مسئولیت تضامنی صادرکننده، ظهرنویس و ضامن، اعاده دادرسی ماده ۴۷۴، "
    "فرجام‌خواهی، نظریه مشورتی اداره کل حقوقی قوه قضاییه، لایحه دفاعیه، دادخواست، شکواییه، "
    "لطفاً به صورت خیلی خلاصه توضیح دهید، دادگاه انتظامی قضات، دادگاه انتظامی وکلا، دادگاه نظامی."
)

# ─────────────────────────────────────────────────────────────────────────────
# دیسپچر چندسطحی OpenRouter (OpenAI-compatible) — Task 1.3
# ─────────────────────────────────────────────────────────────────────────────
TIER_MODELS: Dict[str, List[str]] = {
    "tier1": [
        "google/gemini-3.5-flash-lite",
        "deepseek/deepseek-v4-flash-0731",
        "z-ai/glm-5.3-flash"
    ],
    "tier2": [
        "openai/gpt-5.6-luna",
        "deepseek/deepseek-v4-pro",
        "google/gemini-3.8-flash"
    ],
    "tier3": [
        "openai/gpt-5.6-luna",
        "deepseek/deepseek-v4-pro",
        "google/gemini-3.8-flash"
    ]
}
# زنجیره اضطراری مشترک اگر مدل سطح انتخابی در دسترس نباشد
_EMERGENCY_MODELS = [
    "google/gemini-3.5-flash-lite",
    "openai/gpt-5.6-luna",
    "deepseek/deepseek-v4-flash-0731"
]
TIER_LABELS = {
    "tier1": "سطح ۱ — موتور پایه (سریع)",
    "tier2": "سطح ۲ — دقت بالا (دادرسی پیشرفته)",
    "tier3": "سطح ۳ — تحلیل عمیق قضایی و انشای لایحه",
}
# سقف سخت‌گیرانه توکن‌ها برای جلوگیری از ارور 402/حد توکن OpenRouter (هرگز 32000 توکن درخواست نشود)
TIER_MAX_TOKENS = {
    "tier1": 2000,
    "tier2": 3500,
    "tier3": 4500
}


def _tier_map(engine_tier_value: str) -> str:
    v = (engine_tier_value or "").strip().lower()
    if v in ("tier1", "free-ox-alpha", "basic", "1", "tier_1", "flash", "fast"):
        return "tier1"
    if v in ("tier3", "deepseek-v4-pro", "pro", "3", "tier_3", "divan", "max", "ultra", "nemotron", "deep"):
        return "tier3"
    return "tier2"


def _model_chain(tier: str) -> List[str]:
    """زنجیره مدل‌های سطح انتخابی + اضطراری — بدون تکرار."""
    seen: set = set()
    chain: List[str] = []
    for m in TIER_MODELS.get(tier, []) + _EMERGENCY_MODELS:
        if m and m not in seen:
            seen.add(m)
            chain.append(m)
    return chain


# ─────────────────────────────────────────────────────────────────────────────
# کلاینت‌های چندپرووایدری: OpenRouter (اصلی) + Kira AI (استدلال سنگین/پشتیبان)
# ─────────────────────────────────────────────────────────────────────────────
def _kira_configured() -> bool:
    """آیا پرووایدر Kira AI (موتور استدلال سنگین/پشتیبان) فعال است."""
    return bool(KIRA_KEY)


def _approx_tokens(text: str) -> int:
    """تخمین محافظه‌کارانه تعداد توکن بر مبنای طول کاراکتر (فارسی ≈ ۴ کاراکتر/توکن)."""
    return max(1, len(text) // 4)


def _trim_messages_to_budget(
    messages: List[Dict[str, str]], token_budget: Optional[int]
) -> List[Dict[str, str]]:
    """برش پیام‌ها برای ماندن در بودجه توکن ورودی (بافر ۱M توکن موتور پشتیبان).

    پیام‌های system به‌صورت کامل حفظ می‌شوند؛ در صورت سرریز، محتوای پیام‌های
    کاربر از انتها برش داده می‌شود تا هرگز از بودجه فراتر نرود.
    """
    if not token_budget:
        return messages
    used = sum(_approx_tokens(m.get("content", "")) for m in messages)
    if used <= token_budget:
        return messages

    system_chars = sum(
        len(m.get("content", "")) for m in messages if m.get("role") == "system"
    )
    remaining = max(0, token_budget * 4 - system_chars)
    trimmed: List[Dict[str, str]] = []
    for m in messages:
        if m.get("role") == "system":
            trimmed.append(m)
            continue
        content = m.get("content", "")
        if len(content) > remaining:
            content = content[:remaining]
        remaining -= len(content)
        trimmed.append({**m, "content": content})
    return trimmed


async def _openrouter_chat_completion(
    messages: List[Dict[str, str]], models: List[str],
    max_tokens: int, temperature: float, timeout: float,
) -> Tuple[str, str]:
    """تلاش ترتیبی روی مدل‌های OpenRouter — خروجی: (متن, مدل)."""
    last_err = ""
    for model in models:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                r = await client.post(
                    f"{OPENROUTER_BASE}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {OPENROUTER_KEY}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "https://ghazihoushmand.ir",
                        "X-Title": "Roxira SmartJudge",
                    },
                    json={
                        "model": model,
                        "messages": messages,
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                    },
                )
            if r.status_code != 200:
                last_err = f"{model}: HTTP {r.status_code} {r.text[:180]}"
                logger.warning("[SMARTJUDGE] LLM non-200 %s", last_err)
                continue
            body = r.json()
            msg = ((body.get("choices") or [{}])[0].get("message") or {})
            content = (msg.get("content") or "").strip()
            if not content and msg.get("reasoning_content"):
                # مدل‌های reasoning ممکن است خروجی را در فیلد reasoning_content بدهند
                content = str(msg.get("reasoning_content")).strip()
            if not content and msg.get("reasoning"):
                content = str(msg.get("reasoning")).strip()
            if content:
                return content.strip(), model
            last_err = f"{model}: empty content"
        except Exception as exc:
            last_err = f"{model}: {exc}"
            logger.warning("[SMARTJUDGE] LLM call failed %s", last_err)
    raise RuntimeError(last_err or "هیچ مدل OpenRouterای موفق نشد.")


async def _kira_chat_completion(
    messages: List[Dict[str, str]],
    model: str = KIRA_REASONING_MODEL,
    max_tokens: int = KIRA_REASONING_MAX_TOKENS,
    temperature: float = 0.2,
    timeout: float = KIRA_MAX_TIMEOUT,
    context_budget: Optional[int] = None,
) -> Tuple[str, str]:
    """فراخوانی Chat Completions پرووایدر Kira AI (OpenAI-compatible).

    موتور استدلال عمیق (glm-5.3-free) هر دو فیلد `reasoning_content` و
    `content` را برمی‌گرداند؛ ابتدا `content` و در نبود آن `reasoning_content`
    استخراج می‌شود و سقف خروجی از طریق max_tokens (۲۰۰۰ توکن) اعمال می‌گردد.
    موتور پشتیبان (kira-mini-1.0) بافر ورودی ۱ میلیون توکنی دارد.
    """
    if not KIRA_KEY:
        raise RuntimeError("KIRA_API_KEY تنظیم نشده است.")
    prepared = _trim_messages_to_budget(messages, context_budget)
    # سقف سخت ۶ ثانیه — هرگز فراخوانی Kira بیش از این معطل نمی‌ماند.
    timeout = min(timeout, KIRA_MAX_TIMEOUT)
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(
            f"{KIRA_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {KIRA_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://ghazihoushmand.ir",
                "X-Title": "Roxira SmartJudge (Kira AI)",
            },
            json={
                "model": model,
                "messages": prepared,
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
        )
    if r.status_code != 200:
        raise RuntimeError(f"{model}: HTTP {r.status_code} {r.text[:180]}")

    body = r.json()
    msg = ((body.get("choices") or [{}])[0].get("message") or {})
    content = (msg.get("content") or "").strip()
    reasoning = str(msg.get("reasoning_content") or msg.get("reasoning") or "").strip()
    if not content and reasoning:
        content = reasoning
    if not content:
        raise RuntimeError(f"{model}: empty content")
    return content, model


def _kira_engine_chain(max_tokens: int) -> List[Tuple[str, int, Optional[int]]]:
    """زنجیره Kira AI: (مدل، سقف خروجی، بودجه ورودی) — استدلال عمیق سپس پشتیبان."""
    reasoning_cap = min(max_tokens, KIRA_REASONING_MAX_TOKENS) or KIRA_REASONING_MAX_TOKENS
    return [
        (KIRA_REASONING_MODEL, reasoning_cap, None),
        # پشتیبان بدون هزینه با بافر ۱ میلیون توکن برای پرونده‌های حجیم
        (KIRA_FALLBACK_MODEL, max(KIRA_FALLBACK_OUTPUT_TOKENS, max_tokens), KIRA_FALLBACK_CONTEXT_TOKENS),
    ]


def _is_kira_gateway_failure(exc: Exception) -> bool:
    """آیا خطای Kira از نوع درگاه در دسترس‌نبودن (504) یا تایم‌اوت است؟

    در این حالت طبق قرارداد، به‌جای مصرف بودجه روی زنجیره Kira، همان لحظه
    کنترل به OpenRouter منتقل می‌شود.
    """
    text = str(exc).lower()
    return "504" in text or "timeout" in text or "timed out" in text


async def _chat_completion(messages: List[Dict[str, str]], models: List[str],
                           max_tokens: int = 1800, temperature: float = 0.2,
                           timeout: float = 90.0,
                           prefer_kira: bool = False) -> Tuple[str, str]:
    """فراخوانی چندپرووایدری Chat Completions با تلاش ترتیبی. خروجی: (متن, مدل).

    ترتیب:
      ۱) در حالت `prefer_kira` (تسک‌های استدلال سنگین قضایی): ابتدا Kira AI
      ۲) سپس زنجیره مدل‌های OpenRouter
      ۳) در نهایت Fallback Engine رایگان Kira (kira-mini-1.0 با بافر ۱M توکن)
    در نبود کلید OpenRouter، تنها از Kira AI استفاده می‌شود.
    """
    if not models and not _kira_configured():
        raise RuntimeError("هیچ مدلی برای فراخوانی تعریف نشده است.")

    errors: List[str] = []

    if prefer_kira and _kira_configured():
        for kmodel, kcap, kbudget in _kira_engine_chain(max_tokens):
            try:
                content, used = await _kira_chat_completion(
                    messages, model=kmodel, max_tokens=kcap,
                    temperature=temperature, timeout=timeout,
                    context_budget=kbudget,
                )
                if content:
                    return content, used
            except Exception as exc:
                errors.append(f"{kmodel}: {exc}")
                logger.warning("[SMARTJUDGE] Kira AI call failed %s", errors[-1])
                # درگاه Kira پاسخ 504 داد یا تایم‌اوت شد ⇒ بلافاصله به OpenRouter
                if _is_kira_gateway_failure(exc):
                    logger.warning("[SMARTJUDGE] Kira AI gateway unavailable (504/timeout) — bypassing to OpenRouter")
                    break

    if OPENROUTER_KEY:
        try:
            return await _openrouter_chat_completion(
                messages, models or _EMERGENCY_MODELS, max_tokens, temperature, timeout
            )
        except RuntimeError as exc:
            errors.append(str(exc))
            logger.warning("[SMARTJUDGE] OpenRouter chain failed: %s", exc)
    else:
        errors.append("OPENROUTER_API_KEY تنظیم نشده است.")

    # Fallback Engine رایگان Kira AI (بدون هزینه) — برای پرونده‌های حجیم
    if _kira_configured():
        for kmodel, kcap, kbudget in _kira_engine_chain(max_tokens):
            try:
                content, used = await _kira_chat_completion(
                    messages, model=kmodel, max_tokens=kcap,
                    temperature=temperature, timeout=timeout,
                    context_budget=kbudget,
                )
                if content:
                    return content, used
            except Exception as exc:
                errors.append(f"{kmodel}: {exc}")
                logger.warning("[SMARTJUDGE] Kira AI fallback failed %s", errors[-1])

    raise RuntimeError("تمام موتورهای LLM ناموفق بودند | " + " | ".join(errors[-6:]))


def _extract_json_block(text: str) -> Optional[Dict[str, Any]]:
    """استخراج JSON از خروجی LLM (حتی داخل code fence)."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
    candidates = [cleaned, text.strip()]
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        candidates.append(m.group(0))
    for cand in candidates:
        try:
            obj = json.loads(cand)
            if isinstance(obj, dict):
                return obj
        except Exception:
            continue
    return None


def _repair_truncated_json(fragment: str) -> Optional[Dict[str, Any]]:
    """بازسازی JSON بریده‌شده (قطع در اثر max_tokens) با بستن رشته‌ها و براکت‌های نیمه‌باز."""
    if not fragment or not fragment.lstrip().startswith("{"):
        return None
    stack: List[str] = []
    in_str = False
    esc = False
    for ch in fragment:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]":
            if stack:
                stack.pop()
    repaired = fragment
    if esc and repaired.endswith("\\"):
        repaired = repaired[:-1]
    if in_str:
        repaired += '"'
    for closer in reversed(stack):
        repaired += closer
    try:
        obj = json.loads(repaired, strict=False)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


def _salvage_string_field(raw: str, field: str) -> str:
    """استخراج تمیز مقدار متنی یک فیلد حتی از JSON ناقص/بریده‌شده — خروجی فارسی روان بدون براکت."""
    m = re.search(r'"' + field + r'"\s*:\s*"((?:[^"\\]|\\.)*)', raw or "", re.S)
    if not m:
        return ""
    val = m.group(1)
    if val.endswith("\\"):
        val = val[:-1]
    try:
        return str(json.loads('"' + val + '"')).strip()
    except Exception:
        return val.replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\").replace("\\/", "/").strip()


def _salvage_string_list(raw: str, field: str, limit: int = 8) -> List[str]:
    """استخراج فهرست رشته‌ای از JSON ناقص (مثل cited_precedents) — تا جایی که کامل ثبت شده باشد."""
    m = re.search(r'"' + field + r'"\s*:\s*\[', raw or "")
    if not m:
        return []
    rest = raw[m.end():]
    close = rest.find("]")
    scan = rest[:close] if close != -1 else rest
    items: List[str] = []
    for it in re.findall(r'"((?:[^"\\]|\\.)*)"', scan):
        try:
            clean = str(json.loads('"' + it + '"')).strip()
        except Exception:
            clean = it.strip()
        if clean:
            items.append(clean)
        if len(items) >= limit:
            break
    return items


def _deep_json_parse(text: str, max_depth: int = 3) -> Optional[Dict[str, Any]]:
    """پارس عمیق JSON — خروجی LLM گاهی دوباره انکد می‌شود (رشتهٔ JSON داخل رشته).

    مثال باگ: مدل به‌جای آبجکت، یک رشتهٔ JSON برمی‌گرداند؛ پارس ساده رشته برمی‌گرداند
    و کل متن خام JSON داخل «legal_advisory» می‌نشیند. این تابع لایه‌به‌لایه باز می‌کند و
    در انتها حتی JSON بریده‌شده (max_tokens) را بازسازی می‌کند.
    """
    current: Any = text
    for _ in range(max_depth):
        if not isinstance(current, str):
            break
        candidate = re.sub(r"^```(?:json)?\s*|\s*```$", "", current.strip(), flags=re.MULTILINE).strip()
        if not candidate:
            return None
        obj: Any = None
        try:
            obj = json.loads(candidate, strict=False)
        except Exception:
            m = re.search(r"\{[\s\S]*\}", candidate)
            if m:
                try:
                    obj = json.loads(m.group(0), strict=False)
                except Exception:
                    obj = None
            if not isinstance(obj, dict):
                # تلاش نهایی: بازسازی JSON بریده‌شده (ناتمام در اثر سقف توکن)
                obj = _repair_truncated_json(candidate)
        if isinstance(obj, dict):
            return obj
        if isinstance(obj, str):
            current = obj  # لایه دوم انکودینگ — دوباره پارس می‌شود
            continue
        return None
    return None
# ─────────────────────────────────────────────────────────────────────────────
# مدل‌های درخواست
# ─────────────────────────────────────────────────────────────────────────────
class InflationCalcRequest(BaseModel):
    principal_amount_irr: float
    start_year: int
    end_year: int = 1404

class JurisdictionRequest(BaseModel):
    dispute_type: str
    claim_amount_irr: float
    city: str = "تهران"

class MasterLegalSearchRequest(BaseModel):
    query: str
    limit: int = 3

class LegalJudicialRequest(BaseModel):
    case_description: str
    action_type: str = "VERDICT_DRAFT"
    limit: int = 3

class AnalyzeCaseRequest(BaseModel):
    case_text: str
    engine_tier: str = "tier2"
    attached_files: List[str] = []

class InferAdvisoryRequest(BaseModel):
    query: str
    limit: int = 5


class RetrialEvalRequest(BaseModel):
    """درخواست سنجش اعاده دادرسی — Task 4 (گیت احراز هویت OTP + سهمیه رایگان)."""
    case_description: str                 # شرح ادله جدید و ابطال‌خواهی
    verdict_details: str = ""             # متن/خلاصه دادنامه واخواهی
    retrial_type: str = "CRIMINAL_474"    # CRIMINAL_474 | CIVIL_426 | SPECIAL_477
    user_identifier: str                  # شناسه کاربر (یوزرنیم/موبایل/ایمیل)
    is_verified: bool = False             # خروجی OTP پیامک/ایمیل


# ─────────────────────────────────────────────────────────────────────────────
# RAG: بازیابی داده واقعی از Qdrant + رتبه‌بندی واژگانی فارسی
# ─────────────────────────────────────────────────────────────────────────────
_FA_MAP = str.maketrans({"ي": "ی", "ك": "ک", "ة": "ه", "\u200c": " ", "أ": "ا", "إ": "ا", "ؤ": "و", "ئ": "ی"})
_FA_TO_ASCII = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")
_ASCII_TO_FA = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def _normalize_fa(text: str) -> str:
    return (text or "").translate(_FA_MAP).lower()


def _fa_tokens(text: str) -> List[str]:
    return [t for t in re.split(r"[^\w\u0600-\u06FF]+", _normalize_fa(text)) if len(t) > 1]


def _extract_article_numbers(text: str) -> List[int]:
    """استخراج شماره مواد قانونی («ماده ۱۰»، «ماده 522») از متن فارسی برای Seed گراف."""
    nums: List[int] = []
    for m in re.finditer(r"ماده\s*([0-9\u06F0-\u06F9]+)", _normalize_fa(text)):
        raw = m.group(1).translate(_FA_TO_ASCII)
        try:
            n = int(raw)
        except ValueError:
            continue
        if 0 < n < 2000 and n not in nums:
            nums.append(n)
    return nums[:6]


def _score_payload(payload: Dict[str, Any], q_tokens: List[str]) -> float:
    """امتیاز ارتباط واژگانی واقعی — بدون امتیاز ساختگی."""
    title = _normalize_fa(str(payload.get("title") or payload.get("name") or ""))
    body = _normalize_fa(str(payload.get("content") or payload.get("text") or ""))[:4000]
    if not q_tokens:
        return 0.0
    score = 0.0
    tset = set(q_tokens)
    title_tokens = set(_fa_tokens(title))
    body_tokens = set(_fa_tokens(body))
    hit_title = len(tset & title_tokens)
    hit_body = len(tset & body_tokens)
    score += hit_title * 3.0          # تطبیق عنوان ارزشمندتر است
    score += hit_body * 1.0
    if hit_title >= max(1, len(q_tokens) // 2):
        score += 2.0                  # پوشش بالای عنوان
    return score


async def _scroll_collection(client: httpx.AsyncClient, collection: str, pool: int) -> List[Dict[str, Any]]:
    try:
        r = await client.post(
            f"{QDRANT_BASE}/collections/{collection}/points/scroll",
            json={"limit": pool, "with_payload": True},
        )
        if r.status_code != 200:
            return []
        out = []
        for p in r.json().get("result", {}).get("points", []):
            pl = p.get("payload", {})
            if isinstance(pl, dict):
                out.append(pl)
        return out
    except Exception as exc:
        logger.warning("[SMARTJUDGE] scroll %s failed: %s", collection, exc)
        return []


# Task 1 — آستانه ارتباط: اسناد با امتیاز صفر (فیلترشده به‌عنوان fallback عمومی مانند
# مواد ۱ تا ۵ آیین دادرسی کیفری) حذف می‌شوند؛ واژه‌های پیش‌گفتار محاوره پیش از امتیازدهی
# از توکن‌های پرسش حذف می‌شوند تا هیچ‌گاه امتیاز ساختگی تولید نکنند.
_RELEVANCE_THRESHOLD = 1.0

# واژگان محاوره‌ای/پرسشی — هرگز در امتیازدهی ارتباط لحاظ نمی‌شوند
_QUERY_STOPWORDS = frozenset({
    "سلام", "علیکم", "خوبید", "خوبی", "ممنون", "مرسی", "سپاس", "تشکر", "خب",
    "لطفا", "بگو", "بده", "دهید", "چه", "بود", "هست", "آیا", "یعنی",
    "چیست", "چی", "خلاصه", "توضیح", "ارتباط", "اخیر", "آخرین", "است",
    "شما", "چیه", "های",
})


async def _rag_retrieve(query: str, per_collection: int = 5, pool: int = 1400) -> Dict[str, Any]:
    """لایه برداری: بازیابی واقعی از هر ۴ کالکشن Qdrant + رتبه‌بندی واژگانی فارسی.

    Task 1 — فقط اسناد «مستقیماً مرتبط» (امتیاز >= آستانه) برگردانده می‌شوند؛
    توکن‌های محاوره‌ای پرسش نادیده گرفته می‌شوند تا پیش‌گفتارها امتیاز نسازند.
    """
    q_tokens = [t for t in _fa_tokens(_repair_legal_phonetics(query)) if t not in _QUERY_STOPWORDS]
    async with httpx.AsyncClient(timeout=10.0) as client:
        laws = await _scroll_collection(client, VECTOR_COLLECTIONS["laws"], pool)
        precedents = await _scroll_collection(client, VECTOR_COLLECTIONS["precedents"], pool)
        circulars = await _scroll_collection(client, VECTOR_COLLECTIONS["circulars"], pool)
        advisories = await _scroll_collection(client, VECTOR_COLLECTIONS["advisories"], pool)

    # Task 1 — فیلتر اکید ارتباط: اسناد با امتیاز زیر آستانه (تطابق صفر یا صرفاً
    # واژه‌های پیش‌گفتار محاوره) به‌کل حذف می‌شوند تا مواد بی‌ربط به پاسخ نشت نکنند.
    diagnostics = {"scanned": 0, "filtered_below_threshold": 0, "max_score": 0.0}

    def ranked(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        scored = [(_score_payload(it, q_tokens), it) for it in items]
        scored.sort(key=lambda x: x[0], reverse=True)
        diagnostics["scanned"] += len(scored)
        diagnostics["filtered_below_threshold"] += sum(1 for s, _ in scored if s < _RELEVANCE_THRESHOLD)
        if scored:
            diagnostics["max_score"] = max(diagnostics["max_score"], scored[0][0])
        return [it for s, it in scored if s >= _RELEVANCE_THRESHOLD][:per_collection]

    return {
        "laws": ranked(laws),
        "precedents": ranked(precedents),
        "circulars": ranked(circulars),
        "advisories": ranked(advisories),
        "retrieval": {
            "mode": "qdrant+lexical-rerank",
            "relevance_threshold": _RELEVANCE_THRESHOLD,
            **diagnostics,
        },
    }


def _payload_text(payload: Dict[str, Any], limit: int = 500) -> str:
    return str(payload.get("content") or payload.get("text") or payload.get("description") or "")[:limit]


def _payload_title(payload: Dict[str, Any]) -> str:
    return str(payload.get("title") or payload.get("name") or payload.get("article") or "سند حقوقی")


def _payload_meta(payload: Dict[str, Any]) -> str:
    parts = []
    for k in ("category", "node_type", "law_name", "source", "number", "precedent_number"):
        v = payload.get(k)
        if v:
            parts.append(f"{k}: {v}")
    return " | ".join(parts)
# ─────────────────────────────────────────────────────────────────────────────
# پرامپت‌ها و لایه‌های بازیابی — برداری، گراف و تلفیق (Task 1.2 / 1.4)
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
# لایه ۲ — گراف دانش حقوقی در PostgreSQL (graph_nodes / graph_edges)
# پیمایش Dual-Level با روابط MODIFIES / EXCEPTS / GOVERNS / REFERENCES
# ─────────────────────────────────────────────────────────────────────────────
def _db_dsn() -> str:
    """DSN فعال — در صورت اتصال موفق، از حافظه کش خوانده می‌شود (Task 2.1)."""
    if _working_db_dsn:
        return _working_db_dsn
    return _iter_db_dsns()[0]


def _postgres_compose_dsn() -> str:
    user = os.getenv("POSTGRES_USER", "")
    if not user:
        return ""
    return (
        f"postgresql://{user}:{os.getenv('POSTGRES_PASSWORD', '')}"
        f"@{os.getenv('POSTGRES_HOST', 'postgres_prod')}:{os.getenv('POSTGRES_PORT', '5432')}"
        f"/{os.getenv('POSTGRES_DB', 'enterprise_db')}"
    )


def _legacy_database_dsn() -> str:
    name = os.getenv("DATABASE_NAME", "")
    if not name:
        return ""
    return (
        f"postgresql://{os.getenv('DATABASE_USER', 'postgres')}:{os.getenv('DATABASE_PASSWORD', '')}"
        f"@{os.getenv('DATABASE_HOST', '127.0.0.1')}:{os.getenv('DATABASE_PORT', '5432')}/{name}"
    )


def _iter_db_dsns() -> List[str]:
    """فهرست DSNهای کاندید به ترتیب اولویت — بدون موارد تکراری."""
    candidates: List[str] = []
    for cand in (
        _read_env_key("SMARTJUDGE_DATABASE_URL"),
        _read_env_key("DATABASE_URL"),
        _postgres_compose_dsn(),
        _legacy_database_dsn(),
        DEFAULT_DATABASE_URL,
    ):
        if cand and cand not in candidates:
            candidates.append(cand)
    return candidates


_db_dsn_lock = threading.Lock()
_working_db_dsn: Optional[str] = None


def _probe_db_dsn() -> str:
    """انتخاب اولین DSN واقعاً قابل‌اتصال و کش کردن آن — گراف هرگز روی DSN شکسته گیر نمی‌کند."""
    global _working_db_dsn
    if _working_db_dsn:
        return _working_db_dsn
    with _db_dsn_lock:
        if _working_db_dsn:
            return _working_db_dsn
        import psycopg

        last_exc: Optional[Exception] = None
        for cand in _iter_db_dsns():
            host_part = cand.split("@")[-1] if "@" in cand else cand
            try:
                with psycopg.connect(cand, connect_timeout=3, options="-c statement_timeout=3000") as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT 1")
                        cur.fetchone()
                _working_db_dsn = cand
                logger.info("[SMARTJUDGE] graph DB DSN verified: %s", host_part)
                return cand
            except Exception as exc:
                last_exc = exc
                logger.warning("[SMARTJUDGE] DSN candidate failed (%s): %s", host_part, str(exc)[:120])
        raise RuntimeError(f"هیچ DSN پایگاه داده گراف قابل‌اتصال نبود: {str(last_exc)[:200]}")



def _seed_conditions(query: str) -> Tuple[List[str], List[Any]]:
    """گره‌های Seed: شماره مواد استخراج‌شده + توکن‌های معنادار عنوان/متن."""
    conds: List[str] = []
    params: List[Any] = []
    for art in _extract_article_numbers(query):
        fa_art = str(art).translate(_ASCII_TO_FA)
        conds.append("title ILIKE %s")
        params.append(f"%ماده {fa_art}%")
        conds.append("node_id ILIKE %s")
        params.append(f"%-ART-{art}")
    for tok in _fa_tokens(query)[:8]:
        conds.append("title ILIKE %s")
        params.append(f"%{tok}%")
        conds.append("content ILIKE %s")
        params.append(f"%{tok}%")
    return conds, params


def _graph_context_sync(query: str, max_nodes: int = GRAPH_MAX_NODES,
                        max_edges: int = GRAPH_MAX_EDGES, max_hops: int = GRAPH_MAX_HOPS) -> Dict[str, Any]:
    """پیمایش واقعی گراف (Recursive CTE) — همگام؛ فراخوانی از asyncio.to_thread."""
    import psycopg  # وابستگی سنگین — فقط هنگام نیاز بارگذاری می‌شود

    conds, params = _seed_conditions(query)
    if not conds:
        return {"status": "EMPTY_QUERY", "nodes": [], "relations": []}

    seed_where = " OR ".join(conds)
    traversal_sql = f"""
        WITH RECURSIVE seeded(node_id, depth) AS (
            SELECT node_id, 0::int FROM (
                SELECT node_id FROM graph_nodes WHERE {seed_where} LIMIT 48
            ) seedq
            UNION
            SELECT (CASE WHEN e.source_node_id = f.node_id
                         THEN e.target_node_id ELSE e.source_node_id END)::varchar(128),
                   f.depth + 1
            FROM seeded f
            JOIN graph_edges e
              ON e.source_node_id = f.node_id OR e.target_node_id = f.node_id
            WHERE f.depth < %s AND e.relation_type = ANY(%s)
        )
        SELECT n.node_id, n.node_type, n.title, n.category,
               LEFT(COALESCE(n.content, ''), 420) AS content,
               MIN(s.depth) AS depth
        FROM seeded s
        JOIN graph_nodes n ON n.node_id = s.node_id
        GROUP BY n.node_id, n.node_type, n.title, n.category, LEFT(COALESCE(n.content, ''), 420)
        ORDER BY depth ASC, n.node_id ASC
        LIMIT %s
    """
    edges_sql = """
        SELECT e.relation_type, e.weight, COALESCE(e.description, ''),
               e.source_node_id, sn.title AS source_title,
               e.target_node_id, tn.title AS target_title
        FROM graph_edges e
        JOIN graph_nodes sn ON sn.node_id = e.source_node_id
        JOIN graph_nodes tn ON tn.node_id = e.target_node_id
        WHERE e.relation_type = ANY(%s)
          AND (e.source_node_id = ANY(%s) OR e.target_node_id = ANY(%s))
        ORDER BY e.weight DESC NULLS LAST, e.relation_type ASC
        LIMIT %s
    """
    with psycopg.connect(_probe_db_dsn(), connect_timeout=4, options="-c statement_timeout=8000") as conn:
        with conn.cursor() as cur:
            cur.execute(traversal_sql, (*params, max_hops, GRAPH_RELATIONS, max_nodes))
            nodes = [
                {"node_id": r[0], "node_type": r[1], "title": r[2], "category": r[3],
                 "content": r[4], "depth": r[5]}
                for r in cur.fetchall()
            ]
            if not nodes:
                return {"status": "NO_MATCH", "nodes": [], "relations": []}
            node_ids = [n["node_id"] for n in nodes]
            cur.execute(edges_sql, (GRAPH_RELATIONS, node_ids, node_ids, max_edges))
            relations = [
                {"relation": r[0], "weight": r[1], "description": r[2],
                 "source_id": r[3], "source_title": r[4], "target_id": r[5], "target_title": r[6]}
                for r in cur.fetchall()
            ]
    return {
        "status": "OK",
        "nodes": nodes,
        "relations": relations,
        "source": "postgres:graph_nodes+graph_edges",
    }


async def _graph_retrieve(query: str) -> Dict[str, Any]:
    """پیمایش گراف در ترد جدا — افت ایمن و صادقانه در نبود پایگاه داده.

    Task 3 — پرسش پیش از Seed با ترمیم آوایی + نرمال‌سازی نویسه‌های فارسی نرمال می‌شود تا
    جست‌وجوی گراف همیشه با اصطلاحات استاندارد («وحدت رویه»، «شورای حل اختلاف»، ...) تطبیق یابد.
    """
    normalized_query = _repair_legal_phonetics(query)
    try:
        return await asyncio.to_thread(_graph_context_sync, normalized_query)
    except ImportError:
        return {"status": "PSYCOPG_UNAVAILABLE", "nodes": [], "relations": []}
    except Exception as exc:
        logger.warning("[SMARTJUDGE] graph layer unavailable: %s", exc)
        return {"status": "UNAVAILABLE", "nodes": [], "relations": [], "error": str(exc)[:200]}


def _graph_stats_sync() -> Dict[str, Any]:
    import psycopg
    with psycopg.connect(_probe_db_dsn(), connect_timeout=3, options="-c statement_timeout=5000") as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM graph_nodes")
            nodes = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM graph_edges")
            edges = cur.fetchone()[0]
    return {"graph_nodes": nodes, "graph_edges": edges, "host": _db_dsn().split("@")[-1].split("/")[0]}


# پرامپت مرجع قضایی (Task 1.4) — تلفیق دو لایه بازیابی در پرامپت سیستم
_JUDICIAL_CORE_SYSTEM_PROMPT = (
    "شما دستیار حقوقی و دادرسی مجهز به تحلیل ادله، آرای وحدت رویه هیئت عمومی دیوان عالی کشور، "
    "نظریات مشورتی اداره کل حقوقی قوه قضاییه و قوانین جمهوری اسلامی ایران هستید.\n"
    "بر اساس مستندات استخراج‌شده از پایگاه قوانین و گراف قضایی زیر، تحلیلی مستدل و بدون ساختگی به همراه موارد زیر تولید کنید:\n"
    "۱. تحلیل ماهوی ادله و انطباق با قوانین حاکم.\n"
    "۲. شماره و چکیده دقیق آرای وحدت رویه مرتبط.\n"
    "۳. تعیین مرجع صالح (دادگاه صلح، عمومی یا دیوان عالی).\n"
    "۴. درصد برآورد شانس موفقیت و پیش‌نویس متن دفاعیه/شکواییه.\n"
)

_MANDATORY_RULES = (
    "\nقواعد الزامی:\n"
    "۱) «هرگز» شماره یا عنوان رای وحدت رویه، ماده قانونی یا پیش‌نویس ساختگی نساز؛ فقط به اسناد دو لایه زیر استناد کن.\n"
    "۲) اگر شماره رای یا ماده در زمینه آمده باشد دقیقاً همان را نقل کن؛ وگرنه بنویس «رای وحدت رویه مرتبطی در پایگاه داده ثبت نشده است».\n"
    "۳) اگر زمینه برای پاسخ کامل کافی نیست، صریح بگو چه اطلاعات تکمیلی لازم است.\n"
    "۴) خروجی را «فقط» در قالب JSON معتبر و تماماً فارسی روان و رسمی بده.\n"
)

_TIER_INSTRUCTIONS = {
    "tier1": "سطح ۱ (پایه/سریع): پاسخ مختصر — تحلیل ماهوی ادله، قوانین حاکم و یک جمع‌بندی کوتاه.",
    "tier2": "سطح ۲ (دقت بالا): تحلیل ماهوی + رویه قضایی + تعیین مرجع صالح (دادگاه صلح/عمومی/دیوان عالی) + درصد شانس موفقیت.",
    "tier3": "سطح ۳ (تحلیل عمیق): تحلیل چندوجهی + استناد دقیق به شماره آرای وحدت رویه موجود در زمینه + درصد شانس موفقیت + پیش‌نویس کامل دفاعیه/شکواییه ساختارمند.",
}

_JSON_KEYS_HINT = (
    'قالب دقیق JSON: {"legal_advisory": "تحلیل ماهوی کامل فارسی چندپاراگرافی (بند ۱)", '
    '"cited_precedents": ["شماره و چکیده دقیق آرای وحدت رویه فقط از زمینه (بند ۲)"], '
    '"jurisdiction": "مرجع صالح: دادگاه صلح / عمومی حقوقی / کیفری / دیوان عالی + دلیل (بند ۳)", '
    '"success_probability": "درصد برآورد شانس موفقیت + دلیل (بند ۴)", '
    '"draft_text": "پیش‌نویس متن دفاعیه/شکواییه (بند ۴)", '
    '"matched_laws": [{"title": "...", "category": "...", "text": "..."}]}'
)


# ─────────────────────────────────────────────────────────────────────────────
# Task 2 — معماری کَش پرامپت و مسیریابی نیت پویا
# تمام بلوک‌های ایستا (هسته + قواعد + اسکیمای خروجی RAG + دستور سطح) باید در
# «ابتدای» پرامپت سیستم بیایند تا پیشوند مشترک بین درخواست‌های هم‌سطح حداکثری شود
# (prefix caching در OpenRouter: ۷۵٪ تا ۹۰٪ کاهش هزینه توکن ورودی).
# زمینه پویای RAG و دستور حالت پاسخ صرفاً در «انتهای» پرامپت اضافه می‌شوند تا
# پیشوند کَش‌شدنی را نشکنند.
# ─────────────────────────────────────────────────────────────────────────────

# ── Task 1 — طبقه‌بندی پویای نیت پرسش: RESEARCH_QA در برابر FORMAL_DISPUTE ──
QUERY_RESEARCH = "RESEARCH_QA"      # استعلام اطلاعاتی / مقایسه قوانین / پرسش عمومی
QUERY_FORMAL = "FORMAL_DISPUTE"     # دعوای رسمی / دادخواست / لایحه دفاعیه

# نشانه‌های صریح پرسش پژوهشی — بر نشانه‌های دعوا اولویت دارند
_INFO_EXPLICIT_MARKERS = (
    "چه بود", "توضیح بده", "توضیح دهید", "ارتباط دارد", "استعلام", "ماده چیست",
    "خلاصه", "آخرین آرای", "آخرین آراء", "چیست", "چگونه", "چطور", "تفاوت", "نحوه",
    "چیه", "پیشنهاد",
)
# نشانه‌های موضوعی پژوهش (بخشنامه/رأی وحدت رویه) — پس از نشانه‌های دعوای رسمی بررسی می‌شوند
_INFO_TOPIC_MARKERS = ("بخشنامه", "رای وحدت رویه", "رأی وحدت رویه")
# نشانگر ضعیف («ماده») — تنها در نبود نشانه دعوای رسمی
_INFO_WEAK_MARKERS = ("ماده",)
# نشانه‌های صریح اختلاف/دعوای رسمی (موضوع دعوای مشخص و اقدام قضایی)
_FORMAL_DISPUTE_MARKERS = (
    "دادخواست", "شکواییه", "لایحه", "دفاعیه", "پیش‌نویس", "شاکی", "خواهان", "خوانده",
    "متهم", "مطالبه", "خسارت", "طلاق", "مهریه", "چک", "سفته", "قرارداد", "تخلیه",
    "افراز", "خلع ید", "دادنامه", "تجدیدنظر", "فرجام",
)

# Task 2 — الگوهای بوت‌پلیت: هر فیلد حاوی این عبارات جایگزین/غیرعملیاتی خالی می‌شود
BOILERPLATE_PATTERNS = ("نامشخص", "نیاز به", "ارائه نشده", "قابل ارائه نیست", "ارسال فرمایید", "مشخص نیست")


def _classify_query_intent(case_text: str) -> str:
    """طبقه‌بندی نیت پرسش (Task 1) — RESEARCH_QA یا FORMAL_DISPUTE.

    ترتیب اولویت (قطعی و بدون ابهام):
      ۱) نشانه صریح پرسش/استعلام («چیست»، «خلاصه»، «چه بود»، ...) → RESEARCH_QA
      ۲) نشانه دعوای رسمی («مطالبه»، «دادخواست»، ...) → FORMAL_DISPUTE
      ۳) نشانه موضوعی پژوهش («رای وحدت رویه»، «بخشنامه») → RESEARCH_QA
      ۴) نشانه ضعیف («ماده») → RESEARCH_QA
      ۵) پیش‌فرض محافظه‌کارانه → FORMAL_DISPUTE
    """
    text = (case_text or "").strip()
    if not text:
        return QUERY_FORMAL
    if any(m in text for m in _INFO_EXPLICIT_MARKERS):
        return QUERY_RESEARCH
    if any(m in text for m in _FORMAL_DISPUTE_MARKERS):
        return QUERY_FORMAL
    if any(m in text for m in _INFO_TOPIC_MARKERS):
        return QUERY_RESEARCH
    if any(m in text for m in _INFO_WEAK_MARKERS):
        return QUERY_RESEARCH
    return QUERY_FORMAL


def _is_informational_query(case_text: str) -> bool:
    """سازگاری نسخه پیشین — True یعنی نیت پرسش RESEARCH_QA است."""
    return _classify_query_intent(case_text) == QUERY_RESEARCH


_MODE_INFORMATIONAL_PROMPT = (
    "\n【حالت پاسخ — RESEARCH_QA (پرسش پژوهشی/اطلاعاتی)】\n"
    "- «legal_advisory» را به‌صورت ترکیب حقوقی مستقیم و گلوله‌بندی‌شده (bulleted) بنویس؛ "
    "حداکثر ۲ تا ۳ پاراگراف کوتاه.\n"
    "- «هیچ» پیش‌نویس دادخواست/شکواییه/لایحه تولید نکن و بابت نبود جزئیات پرونده عذرخواهی نکن.\n"
    "- مقدار کلیدهای «draft_text»، «jurisdiction» و «success_probability» دقیقاً رشته خالی (\"\") باشد.\n"
    "- در پایان، فهرست کوتاه منابع استنادی (شماره ماده/رأی فقط از زمینه) بیاور."
)

_MODE_FORMAL_PROMPT = (
    "\n【حالت پاسخ — FORMAL_DISPUTE (اختلاف/دعوای رسمی)】\n"
    "- پاسخ ساختاریافته کامل الزامی است: تحلیل ماهوی ادله، آرای وحدت رویه زمینه، تعیین مرجع صالح، "
    "درصد برآورد شانس موفقیت و پیش‌نویس دفاعیه/شکواییه ساختارمند.\n"
    "- «legal_advisory» را حداکثر ۳ پاراگراف فشرده نگه دار تا «draft_text» (پیش‌نویس کامل با ساختار "
    "مرجع/موضوع/خواسته/دلایل/امضا) حتماً در خروجی JSON حاضر باشد؛ تولید «تمام» کلیدهای JSON الزامی است."
)

# Task 6 — پرامپت نجات پیش‌نویس: اگر مدل در FORMAL_DISPUTE کلید draft_text را حذف کند،
# یک فراخوانی متمرکز فقط برای انشای پیش‌نویس (همان زمینه دو لایه) انجام می‌شود.
_DRAFT_ONLY_SYSTEM_PROMPT = (
    "شما کارشناس انشای لوایح قضایی هستید. «فقط» یک JSON با کلید «draft_text» برگردانید که پیش‌نویس "
    "رسمی و ساختارمند لایحه/دادخواست را شامل شود (مرجع، موضوع، خواسته، دلایل مستند به زمینه "
    "بازیابی‌شده، امضا)؛ بدون هیچ کلید اضافه و بدون استناد ساختگی خارج از زمینه."
)


def _vector_context_block(rag: Dict[str, Any]) -> List[str]:
    lines = ["【لایه ۱ — بازیابی برداری از Qdrant (داده واقعی سامانه)】"]
    spec = [
        ("laws", "■ قوانین و مواد بازیابی‌شده:", "قانون", 500),
        ("precedents", "■ آرای وحدت رویه و رویه قضایی بازیابی‌شده:", "رویه", 400),
        ("advisories", "■ نظریات مشورتی اداره کل حقوقی قوه قضاییه:", "نظریه", 350),
        ("circulars", "■ بخشنامه‌های قضایی:", "بخشنامه", 300),
    ]
    found = False
    for key, header, label, tlimit in spec:
        items = rag.get(key) or []
        if not items:
            continue
        found = True
        lines.append(header)
        for i, p in enumerate(items, 1):
            lines.append(f"[{label} {i}] {_payload_title(p)} | {_payload_meta(p)}")
            lines.append(f"متن: {_payload_text(p, tlimit)}")
    if not found:
        lines.append("هیچ سند تطبیقی از پایگاه برداری بازیابی نشد؛ عدم اطمینان را صریح اعلام کن.")
    return lines


def _graph_context_block(graph: Dict[str, Any]) -> List[str]:
    lines = ["【لایه ۲ — گراف دانش حقوقی (PostgreSQL: graph_nodes / graph_edges)】"]
    nodes = graph.get("nodes") or []
    rels = graph.get("relations") or []
    if graph.get("status") != "OK" or not nodes:
        lines.append("گره مرتبطی از گراف قضایی استخراج نشد؛ به لایه برداری تکیه کن.")
        return lines
    lines.append("■ گره‌های حقوقی مرتبط (با عمق پیمایش):")
    for i, n in enumerate(nodes, 1):
        lines.append(
            f"[گره {i}] {n.get('node_id')} | {n.get('title')} | نوع: {n.get('node_type')} | "
            f"دسته: {n.get('category')} | عمق: {n.get('depth')}"
        )
        if n.get("content"):
            lines.append(f"متن: {n['content']}")
    lines.append("■ روابط استخراج‌شده از گراف قضایی (استناد دقیق به این روابط الزامی است):")
    for r in rels:
        desc = f" | توضیح: {r['description']}" if r.get("description") else ""
        lines.append(f"{r.get('source_title')} —[{r.get('relation')}]→ {r.get('target_title')}{desc}")
    return lines


def _build_system_prompt(tier: str, rag: Dict[str, Any], graph: Dict[str, Any],
                         is_informational: bool = False) -> str:
    """پرامپت کَش‌محور (Task 2 — Prompt Caching):
    [۱] بلوک ایستای ثابت در «ابتدای» پرامپت (هسته + قواعد + اسکیمای خروجی RAG + دستور سطح) —
        یکسان در تمام درخواست‌های هم‌سطح ⇒ بیشینه‌سازی prefix caching در OpenRouter.
    [۲] زمینه پویای دو لایه (برداری + گراف) در ادامه.
    [۳] دستور حالت پاسخ (اطلاعاتی/رسمی) در انتهای پرامپت — خارج از پیشوند کَش‌شدنی.
    """
    static_prefix = (
        _JUDICIAL_CORE_SYSTEM_PROMPT
        + _MANDATORY_RULES
        + "\n" + _JSON_KEYS_HINT
        + "\n" + _TIER_INSTRUCTIONS.get(tier, _TIER_INSTRUCTIONS["tier2"])
    )
    dynamic_context = (
        "\n\n" + "\n".join(_vector_context_block(rag))
        + "\n\n" + "\n".join(_graph_context_block(graph))
    )
    mode_directive = _MODE_INFORMATIONAL_PROMPT if is_informational else _MODE_FORMAL_PROMPT
    return static_prefix + dynamic_context + mode_directive


def _user_prompt(case_text: str, attached_files: List[str]) -> str:
    """پرامپت کاربر — فقط محتوای پویا؛ قواعد و اسکیمای خروجی در بلوک ایستای سیستم کَش می‌شوند."""
    files_note = ""
    if attached_files:
        files_note = "\nفایل‌های پیوست پرونده: " + "، ".join(attached_files[:20])
    return (f"شرح پرونده کاربر:\n{case_text.strip()}{files_note}\n\n"
            f"لطفاً تحلیل قضایی را طبق قواعد و قالب JSON اعلام‌شده در دستورالعمل سیستم ارائه کن.")


async def _llm_analyze(case_text: str, engine_tier: str, attached_files: List[str]) -> Dict[str, Any]:
    """خط لوله کامل Dual-Level RAG + LLM — پاسخ فقط با استنتاج زنده تولید می‌شود."""
    tier = _tier_map(engine_tier)
    # Task 2 — مسیریابی نیت پویا: پرسش اطلاعاتی در برابر دعوای رسمی
    # Task 1 — طبقه‌بندی نیت پویا: RESEARCH_QA در برابر FORMAL_DISPUTE
    query_type = _classify_query_intent(case_text)
    is_informational = (query_type == QUERY_RESEARCH)
    rag, graph = await asyncio.gather(_rag_retrieve(case_text), _graph_retrieve(case_text))
    system_prompt = _build_system_prompt(tier, rag, graph, is_informational=is_informational)
    user_prompt = _user_prompt(case_text, attached_files)

    content, model_used = await _chat_completion(
        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
        models=_model_chain(tier),
        max_tokens=TIER_MAX_TOKENS.get(tier, 2200),
        temperature=0.2,
        # استدلال قضایی عمیق (tier3) با موتور سنگین Kira AI (glm-5.3-free) آغاز می‌شود
        prefer_kira=(tier == "tier3"),
    )

    # ── پارس امن خروجی LLM — حتی اگر JSON دوباره‌انکدشده (رشته داخل رشته) باشد ──
    parsed = _deep_json_parse(content) or {}

    # اگر «legal_advisory» خودش حاوی JSON باشد، فیلدهای درونی استخراج و ادغام می‌شود
    advisory_val = parsed.get("legal_advisory")
    if isinstance(advisory_val, str) and advisory_val.strip().startswith("{"):
        inner = _deep_json_parse(advisory_val)
        if inner:
            for key, val in inner.items():
                if key != "legal_advisory" and key not in parsed:
                    parsed[key] = val
            if isinstance(inner.get("legal_advisory"), str) and inner["legal_advisory"].strip():
                advisory_val = inner["legal_advisory"]

    # استخراج فیلدها — «legal_advisory» باید متن ساده فارسی باشد، نه JSON رشته‌ای
    legal_advisory = str(advisory_val or "").strip()
    if not legal_advisory and parsed:
        # مدل کلید legal_advisory را نیاورده — بلندترین فیلد متنی به‌عنوان تحلیل ماهوی
        text_vals = [str(v).strip() for v in parsed.values() if isinstance(v, str) and len(str(v).strip()) > 40]
        if text_vals:
            legal_advisory = max(text_vals, key=len)
    if not legal_advisory:
        legal_advisory = re.sub(r"```(?:json)?|```", "", content).strip()

    draft_text = str(parsed.get("draft_text") or "").strip()
    success_probability = str(parsed.get("success_probability") or "").strip()
    jurisdiction = str(parsed.get("jurisdiction") or "").strip()
    salvaged_precedents: List[str] = []

    # نجات تمیز فیلدها از خروجی بریده‌شده (سقف توکن) — بدون نشت متن خام JSON به رابط کاربری (Task 2.3)
    if (not parsed) or legal_advisory.lstrip().startswith("{") or not draft_text:
        s_adv = _salvage_string_field(content, "legal_advisory")
        if s_adv and (not legal_advisory or legal_advisory.lstrip().startswith("{")):
            legal_advisory = s_adv
        draft_text = draft_text or _salvage_string_field(content, "draft_text")
        success_probability = success_probability or _salvage_string_field(content, "success_probability")
        jurisdiction = jurisdiction or _salvage_string_field(content, "jurisdiction")
        salvaged_precedents = _salvage_string_list(content, "cited_precedents")

    # حفاظ نهایی: هرگز متن خام JSON (براکت/escape) به رابط کاربری نشت نکند
    if legal_advisory.lstrip().startswith("{"):
        legal_advisory = "تحلیل تولید شد، اما ساختار خروجی مدل ناقص بود؛ لطفاً پرسش را با جزئیات بیشتر تکرار کنید."

    # Task 1 — رندر مینیمال: در RESEARCH_QA هیچ فیلد دعوای رسمی (پیش‌نویس/مرجع صالح/
    # شانس موفقیت) صادر نمی‌شود تا نشان‌ها و فرم‌های خالی در رابط کاربری نمایش داده نشوند.
    # (این override پس از همه مسیرهای نجات اعمال می‌شود تا خروجی صادشده مدل نیز صفر شود)
    if is_informational:
        draft_text = ""
        jurisdiction = ""
        success_probability = ""
    else:
        success_probability = success_probability or "نامشخص — نیازمند جزئیات بیشتر"
        jurisdiction = jurisdiction or "دادگاه صلح / عمومی حسب صلاحیت"
        # Task 6 — تضمین دادخواست ساختارمند: اگر مدل کلید draft_text را حذف کرده باشد،
        # یک فراخوانی متمرکز فقط برای انشای پیش‌نویس با همان زمینه دو لایه انجام می‌شود.
        if not draft_text:
            try:
                draft_system = (
                    _DRAFT_ONLY_SYSTEM_PROMPT
                    + "\n\n" + "\n".join(_vector_context_block(rag))
                    + "\n\n" + "\n".join(_graph_context_block(graph))
                )
                draft_content, _ = await _chat_completion(
                    messages=[
                        {"role": "system", "content": draft_system},
                        {"role": "user", "content": _user_prompt(case_text, attached_files)},
                    ],
                    models=_model_chain(tier),
                    max_tokens=TIER_MAX_TOKENS.get(tier, 2200),
                    temperature=0.2,
                    prefer_kira=(tier == "tier3"),
                )
                draft_parsed = _deep_json_parse(draft_content) or {}
                draft_text = str(draft_parsed.get("draft_text") or "").strip() \
                    or _salvage_string_field(draft_content, "draft_text") or ""
            except Exception as exc:
                logger.warning("[SMARTJUDGE] draft-only fallback failed: %s", exc)

    # Task 2 — سانیتایزر سخت‌گیرانه بوت‌پلیت: در RESEARCH_QA هر سه فیلد خالی‌اند و در
    # FORMAL_DISPUTE مقادیر جایگزین («نامشخص»، «نیاز به»، ...) پیش از ارسال حذف می‌شوند
    # تا رابط کاربری هیچ جعبه جایگزین/خالی رندر نکند.
    if any(bp in jurisdiction for bp in BOILERPLATE_PATTERNS) or query_type == QUERY_RESEARCH:
        jurisdiction = ""
    if any(bp in success_probability for bp in BOILERPLATE_PATTERNS) or query_type == QUERY_RESEARCH:
        success_probability = ""
    if any(bp in draft_text for bp in BOILERPLATE_PATTERNS) or query_type == QUERY_RESEARCH \
            or len(draft_text.strip()) < 30:
        draft_text = ""

    matched_laws = parsed.get("matched_laws")
    if not isinstance(matched_laws, list) or not matched_laws:
        matched_laws = [
            {"title": _payload_title(p), "category": str(p.get("category") or "قانون"), "text": _payload_text(p, 300)}
            for p in rag.get("laws", [])[:6]
        ]

    # cited_precedents: اگر LLM فهرست معتبر داد همان ملاک است؛ وگرنه ادغام با رویه بازیابی‌شده
    cited_raw = parsed.get("cited_precedents")
    cited_llm = [str(c).strip() for c in cited_raw if str(c).strip()] if isinstance(cited_raw, list) else []
    cited_precedents = cited_llm or salvaged_precedents or [_payload_title(p) for p in rag.get("precedents", [])[:4]]

    return {
        "status": "SUCCESS",
        "tier": tier,
        "tier_label": TIER_LABELS.get(tier, tier),
        "query_type": query_type,
        "response_mode": query_type,
        "model_used": model_used,
        "legal_advisory": legal_advisory,
        "matched_laws": matched_laws,
        "cited_precedents": cited_precedents,
        "draft_text": draft_text,
        "success_probability": success_probability,
        "jurisdiction": jurisdiction,
        "free_access": True,
        "retrieval": {
            "mode": "dual-level-lightrag",
            "vector": rag.get("retrieval"),
            "graph": {
                "status": graph.get("status"),
                "nodes_matched": len(graph.get("nodes") or []),
                "relations_matched": len(graph.get("relations") or []),
            },
        },
        "graph_relations": [
            {"source": r.get("source_title"), "relation": r.get("relation"),
             "target": r.get("target_title"), "description": r.get("description")}
            for r in (graph.get("relations") or [])[:12]
        ],
    }


@router.post("/analyze-case")
async def analyze_case(req: AnalyzeCaseRequest):
    if not (req.case_text or "").strip():
        raise HTTPException(status_code=400, detail="متن پرونده الزامی است.")
    try:
        return await _llm_analyze(req.case_text, req.engine_tier, req.attached_files)
    except RuntimeError as exc:
        # پاسخ صادقانه — بدون ساختگی‌سازی؛ فقط اسناد واقعی بازیابی‌شده ضمیمه می‌شود
        rag, graph = await asyncio.gather(_rag_retrieve(req.case_text), _graph_retrieve(req.case_text))
        raise HTTPException(
            status_code=502,
            detail={
                "status": "LLM_UNAVAILABLE",
                "message": "موتور هوش مصنوعی در دسترس نیست؛ لطفاً بعداً تلاش کنید.",
                "error": str(exc)[:400],
                "real_context": {
                    "laws": [{"title": _payload_title(p), "text": _payload_text(p, 240)} for p in rag.get("laws", [])[:5]],
                    "precedents": [_payload_title(p) for p in rag.get("precedents", [])[:5]],
                    "graph_relations": [
                        f"{r.get('source_title')} —[{r.get('relation')}]→ {r.get('target_title')}"
                        for r in (graph.get("relations") or [])[:6]
                    ],
                },
            },
        )


@router.post("/infer-advisory")
async def infer_advisory(req: InferAdvisoryRequest):
    """Alias تحلیل یکپارچه — برای سازگاری با فراخوانی‌های قدیمی."""
    return await analyze_case(AnalyzeCaseRequest(case_text=req.query, engine_tier="tier2"))
# ─────────────────────────────────────────────────────────────────────────────
# Task 4 — ماژول اعاده دادرسی (ماده ۴۷۴/۴۲۶/۴۷۷) و دادگاه‌های انتظامی/نظامی
# ─────────────────────────────────────────────────────────────────────────────
RETRIAL_FREE_QUOTA = 1  # یک تحلیل رایگان به ازای هر کاربر

RETRIAL_CASE_TYPES = {
    "CRIMINAL_474": "اعاده دادرسی کیفری — جهات هفت‌گانه ماده ۴۷۴ قانون آیین دادرسی کیفری",
    "CIVIL_426": "اعاده دادرسی حقوقی — جهات ماده ۴۲۶ قانون آیین دادرسی مدنی",
    "SPECIAL_477": "اعاده دادرسی خاص — ماده ۴۷۷ (خلاف بیّن شرع، حسب دستور رئیس قوه قضائیه)",
}

# جهات قانونی احصا‌شده — ارزیابی اکید فقط بر این جهات انجام می‌شود (بدون جهت‌سازی)
_RETRIAL_STATUTORY_GROUNDS: Dict[str, List[str]] = {
    "CRIMINAL_474": [
        "بند ۱: حکم به مجازات موضوع داشته و موضوع حکم مردود بوده است.",
        "بند ۲: حکم خلاف بیّن شرع صادر شده است.",
        "بند ۳: رسیدگی به جرمی که مطابق قانون در صلاحیت دادگاه خاص بوده، در دادگاه دیگری صورت گرفته است.",
        "بند ۴: رأی قطعی به استناد اسناد جعلی یا شهادت یا اقرار خلاف واقع صادر شده که متعاقباً به موجب حکم قطعی مرجع صالح ثابت شده است.",
        "بند ۵: پس از صدور حکم قطعی، اسناد و اماراتی بر برائت یا کاهش مجازات به دست آید که به دلایل خارج از اراده متهم در جریان رسیدگی در دسترس نبوده است.",
        "بند ۶: نسبت به امور موضوع جرم، حکمی صادر شده که با رأی قطعی قبلی (به علت تجمع جرایم) در تعارض باشد.",
        "بند ۷: متهم پس از محکومیت در دادگاه صالح به روشنی ثابت کند که شخص دیگری مرتکب جرم شده است.",
    ],
    "CIVIL_426": [
        "بند الف: حکم صادره خلاف بیّن شرع باشد.",
        "بند ب: وکیل طرف مقابل حق وکالت نداشته یا محجور و فاقد اهلیت بوده و رأی به واسطه اظهارات یا اسناد او صادر شده باشد.",
        "بند ج: اسنادی که ملاک رأی بوده، جعلی بودن آن‌ها به موجب حکم قطعی ثابت شود.",
        "بند د: شهادت شهودی که ملاک رأی بوده، خلاف حقیقت تشخیص داده شود و مرتکب شهادت کذب شناخته شود.",
        "بند هـ: پس از صدور رأی، اسنادی به دست آید که ملاک حق بوده و ارائه آن به دلیل ممانعت طرف مقابل یا حوادث قهری ممکن نبوده است.",
        "بند و: دادگاه حقی را که طرف طبق قوانین برای او اثبات کرده دریغ کرده و رأی کمتر از میزان محقق صادر کرده باشد.",
    ],
    "SPECIAL_477": [
        "ماده ۴۷۷: رأی قطعی «خلاف بیّن شرع» تشخیص داده شود و حسب تشخیص رئیس قوه قضائیه دستور اعاده دادرسی صادر گردد.",
        "ماده ۴۷۷: نقض صریح قانون یا مغایرت آشکار رأی قطعی با موازین شرع، در معرض بررسی قرار گیرد.",
    ],
}

# گره‌های مرجع نظامی/انتظامی گراف قضایی (راه‌اندازی idempotent)
_RETRIAL_DISCIPLINARY_NODES = [
    ("ART-MILITARY-41", "ARTICLE", "ماده ۴۱ قانون مجازات جرایم نیروهای مسلح", "MILITARY",
     "تیراندازی عمدی برخلاف ضوابط مستوجب مجازات است و شلیک سهوی صرفاً دارای مسئولیت مدنی است."),
    ("RULING-867", "PRECEDENT", "رأی وحدت رویه ۸۶۷ دیوان عالی", "PRECEDENT",
     "شلیک سهوی فرد نظامی وصف مجرمانه نداشته و صرفاً مسئولیت مدنی دارد."),
    ("ART-JUDGES-DISCIPLINARY", "ARTICLE", "قانون نظارت بر رفتار قضات", "DISCIPLINARY",
     "تخلفات انتظامی قضات و مراجع رسیدگی در دادگاه عالی انتظامی قضات."),
    ("ART-LAWYERS-DISCIPLINARY", "ARTICLE", "آیین‌نامه انتظامی کانون وکلا و مرکز وکلا", "DISCIPLINARY",
     "مقررات حاکم بر تخلفات حرفه‌ای و دادگاه‌های انتظامی وکلا و کارشناسان."),
]

_RETRIAL_SCHEMA_SQL = (
    "CREATE TABLE IF NOT EXISTS user_retrial_requests ("
    " id SERIAL PRIMARY KEY,"
    " user_id VARCHAR(100) NOT NULL,"
    " phone_number VARCHAR(20), email VARCHAR(150),"
    " is_verified BOOLEAN DEFAULT FALSE, verification_type VARCHAR(20),"
    " case_type VARCHAR(30) NOT NULL, case_description TEXT NOT NULL,"
    " verdict_summary TEXT, eligibility_score INT DEFAULT 0,"
    " matched_clause VARCHAR(100), draft_petition TEXT,"
    " created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
)

_retrial_schema_ready = False

# [Task 4 — بخش ۱ پایان: لایه داده و سهمیه]


def _retrial_db_sync() -> None:
    """راه‌اندازی idempotent اسکیمای اعاده دادرسی و گره‌های انتظامی/نظامی گراف."""
    import psycopg
    with psycopg.connect(_probe_db_dsn(), connect_timeout=5, options="-c statement_timeout=15000") as conn:
        with conn.cursor() as cur:
            cur.execute(_RETRIAL_SCHEMA_SQL)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_user_retrial_requests_user_id ON user_retrial_requests (user_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_user_retrial_requests_created_at ON user_retrial_requests (created_at)")
            for node_id, node_type, title, category, content in _RETRIAL_DISCIPLINARY_NODES:
                cur.execute(
                    """INSERT INTO graph_nodes (node_id, node_type, title, category, content, metadata)
                       VALUES (%s, %s, %s, %s, %s, %s)
                       ON CONFLICT (node_id) DO UPDATE
                       SET node_type = EXCLUDED.node_type, title = EXCLUDED.title,
                           category = EXCLUDED.category, content = EXCLUDED.content""",
                    (node_id, node_type, title, category, content,
                     json.dumps({"active": True, "source": "smartjudge_retrial_module"}, ensure_ascii=False)),
                )
            cur.execute(
                """INSERT INTO graph_edges (source_node_id, target_node_id, relation_type, weight, description)
                   VALUES ('RULING-867', 'ART-MILITARY-41', 'INTERPRETS', 1.0,
                           'تفسیر مضیق شلیک سهوی نظامیان به نفع متهم')
                   ON CONFLICT (source_node_id, target_node_id, relation_type) DO UPDATE
                   SET description = EXCLUDED.description""")
        conn.commit()


async def _ensure_retrial_schema() -> None:
    """تضمین idempotent اسکیما — فقط یک بار در طول عمر فرایند اجرا می‌شود."""
    global _retrial_schema_ready
    if _retrial_schema_ready:
        return
    await asyncio.to_thread(_retrial_db_sync)
    _retrial_schema_ready = True


def _retrial_quota_count_sync(user_id: str) -> int:
    import psycopg
    with psycopg.connect(_probe_db_dsn(), connect_timeout=5) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM user_retrial_requests WHERE user_id = %s", (user_id,))
            return int(cur.fetchone()[0])


def _retrial_claim_sync(user_id: str, phone: Optional[str], email: Optional[str],
                        case_type: str, case_description: str, verdict_summary: Optional[str]) -> int:
    """ثبت ردیف درخواست (قفل سهمیه پیش از فراخوانی LLM) و بازگرداندن شناسه ردیف."""
    import psycopg
    v_type = "SMS" if phone else ("EMAIL" if email else None)
    with psycopg.connect(_probe_db_dsn(), connect_timeout=5) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO user_retrial_requests
                       (user_id, phone_number, email, is_verified, verification_type,
                        case_type, case_description, verdict_summary)
                   VALUES (%s, %s, %s, TRUE, %s, %s, %s, %s) RETURNING id""",
                (user_id, phone, email, v_type, case_type, case_description, verdict_summary),
            )
            row_id = int(cur.fetchone()[0])
        conn.commit()
    return row_id


def _retrial_finalize_sync(row_id: int, score: int, clause: str, petition: str) -> None:
    import psycopg
    with psycopg.connect(_probe_db_dsn(), connect_timeout=5) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE user_retrial_requests SET eligibility_score = %s, matched_clause = %s, draft_petition = %s WHERE id = %s",
                (score, (clause or "")[:100] or None, petition, row_id),
            )
        conn.commit()


def _retrial_release_sync(row_id: int) -> None:
    """بازگرداندن سهمیه در صورت شکست تحلیل (حذف ردیف claim)."""
    import psycopg
    with psycopg.connect(_probe_db_dsn(), connect_timeout=5) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM user_retrial_requests WHERE id = %s", (row_id,))
        conn.commit()

# [Task 4 — بخش ۲ پایان: لایه داده و سهمیه]

# پرامپت ایستای کَش‌محور — بلوک ثابت در ابتدا (سازگار با معماری Task 2)
_RETRIAL_CORE_PROMPT = (
    "شما قاضی ارشد دیوان عالی کشور و متخصص جهات اعاده دادرسی هستید. "
    "ارزیابی را «فقط» بر اساس جهات قانونی احصا‌شده در همین دستورالعمل و اسناد واقعی بازیابی‌شده انجام دهید؛ "
    "هیچ جهت قانونی جدیدی نسازید و در نبود انطباق کافی، صادقانه اعلام کنید."
)

_RETRIAL_SCHEMA_PROMPT = (
    'قالب دقیق JSON: {"eligibility_score": "عدد صحیح ۰ تا ۱۰۰ (میزان انطباق ادله با جهت منتخب)", '
    '"matched_clause": "شناسه دقیق جهت منطبق؛ مثل: بند ۵ ماده ۴۷۴ | بند الف ماده ۴۲۶ | ماده ۴۷۷ — در نبود انطباق رشته خالی", '
    '"eligibility_analysis": "تحلیل مستدل فارسی انطباق ادله با جهت منتخب", '
    '"legal_evaluation": "ارزیابی حقوقی کامل شامل نقاط ضعف پرونده و الزامات تکمیلی", '
    '"petition_text": "دادخواست رسمی اعاده دادرسی خطاب به دیوان عالی کشور با ساختار: مرجع، موضوع، خواسته، دلایل جهات قانونی، امضا — در نبود انطباق رشته خالی", '
    '"missing_requirements": ["مدارک یا شرایط ناقص که باید تکمیل شود"], '
    '"cited_precedents": ["شماره و چکیده دقیق آرای وحدت رویه فقط از زمینه"]}'
)


def _retrial_build_system_prompt(retrial_type: str) -> str:
    """پرامپت سیستم — هسته + جهات قانونی همان نوع + اسکیمای خروجی (بخش ایستای کَش‌شدنی)."""
    grounds = _RETRIAL_STATUTORY_GROUNDS.get(retrial_type, [])
    grounds_text = "\n".join(f"- {g}" for g in grounds) or "- (نامشخص)"
    return (
        _RETRIAL_CORE_PROMPT
        + f"\nنوع پرونده: {RETRIAL_CASE_TYPES.get(retrial_type, retrial_type)}\n"
        + "جهات قانونی احصا‌شده (ارزیابی اکید فقط با این جهات):\n" + grounds_text + "\n"
        + _RETRIAL_SCHEMA_PROMPT
    )


def _retrial_build_user_prompt(case_description: str, verdict_details: str) -> str:
    verdict = (verdict_details or "").strip()
    verdict_part = f"\nمتن/خلاصه دادنامه واخواهی:\n{verdict}" if verdict else ""
    return (f"شرح ادله جدید و ابطال‌خواهی متقاضی:\n{case_description.strip()}{verdict_part}\n\n"
            f"لطفاً سنجش اکید جهات قانونی و انشای دادخواست را طبق قالب ارائه کن.")


_FA_DIGIT_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")


def _retrial_parse_score(raw: Any) -> int:
    """تبدیل امتیاز خروجی مدل (رقم فارسی/درصد/اعشاری) به عدد صحیح ۰ تا ۱۰۰."""
    try:
        digits = str(raw).translate(_FA_DIGIT_MAP).replace("%", "").replace("٪", "").strip()
        num = float("".join(ch for ch in digits if ch.isdigit() or ch == ".") or 0)
        return max(0, min(100, int(round(num))))
    except Exception:
        return 0


async def _retrial_evaluate_engine(retrial_type: str, case_description: str,
                                   verdict_details: str) -> Dict[str, Any]:
    """موتور حقوقی اعاده دادرسی — بازیابی دو لایه + ارزیابی اکید جهات + انشای دادخواست."""
    query_text = (case_description + "\n" + (verdict_details or "")).strip()
    rag, graph = await asyncio.gather(_rag_retrieve(query_text), _graph_retrieve(query_text))
    content, model_used = await _chat_completion(
        messages=[
            {"role": "system", "content": _retrial_build_system_prompt(retrial_type)},
            {"role": "user", "content": _retrial_build_user_prompt(case_description, verdict_details)},
        ],
        models=_model_chain("tier3"),
        max_tokens=TIER_MAX_TOKENS["tier3"],
        temperature=0.2,
        # انشای دادخواست اعاده دادرسی = استدلال سنگین؛ موتور Kira AI مقدم است
        prefer_kira=True,
    )

    parsed = _deep_json_parse(content) or {}
    matched_clause = str(parsed.get("matched_clause") or "").strip() or (_salvage_string_field(content, "matched_clause") or "")
    eligibility_analysis = str(parsed.get("eligibility_analysis") or "").strip() or (_salvage_string_field(content, "eligibility_analysis") or "")
    petition_text = str(parsed.get("petition_text") or "").strip() or (_salvage_string_field(content, "petition_text") or "")
    legal_evaluation = str(parsed.get("legal_evaluation") or "").strip()
    cited_raw = parsed.get("cited_precedents")
    cited = [str(c).strip() for c in cited_raw if str(c).strip()] if isinstance(cited_raw, list) \
        else _salvage_string_list(content, "cited_precedents")
    missing_raw = parsed.get("missing_requirements")
    missing = [str(m).strip() for m in missing_raw if str(m).strip()] if isinstance(missing_raw, list) else []
    if not legal_evaluation:
        legal_evaluation = re.sub(r"```(?:json)?|```", "", content).strip()[:2000]
    if legal_evaluation.lstrip().startswith("{"):
        legal_evaluation = "ارزیابی تولید شد اما ساختار خروجی مدل ناقص بود؛ لطفاً دوباره تلاش کنید."

    return {
        "status": "SUCCESS",
        "retrial_type": retrial_type,
        "retrial_label": RETRIAL_CASE_TYPES.get(retrial_type, retrial_type),
        "matched_clause": matched_clause,
        "eligibility_score": _retrial_parse_score(parsed.get("eligibility_score")),
        "eligibility_analysis": eligibility_analysis,
        "legal_evaluation": legal_evaluation,
        "petition_text": petition_text,
        "missing_requirements": missing,
        "cited_precedents": cited,
        "statutory_grounds": _RETRIAL_STATUTORY_GROUNDS.get(retrial_type, []),
        "model_used": model_used,
        "retrieval": {"vector": rag.get("retrieval"), "graph_nodes": len(graph.get("nodes") or [])},
    }

# [Task 4 — بخش ۳ پایان: موتور حقوقی]


@router.post("/retrial-evaluate")
async def retrial_evaluate(req: RetrialEvalRequest):
    """سنجش اکید جهات اعاده دادرسی و انشای دادخواست دیوان عالی کشور — Task 4.

    گیت‌ها:
      • ۴۰۳ — نبود احراز هویت (is_verified=False؛ خروجی OTP پیامک/ایمیل)
      • ۴۰۳ — اتمام سهمیه رایگان (یک تحلیل برای هر کاربر؛ ارتقای اشتراک لازم است)
    سهمیه پیش از فراخوانی LLM قفل (claim) و در شکست تحلیل بازگردانده (release) می‌شود.
    """
    retrial_type = (req.retrial_type or "").strip().upper()
    if retrial_type not in RETRIAL_CASE_TYPES:
        raise HTTPException(status_code=422, detail="نوع اعاده دادرسی نامعتبر است؛ مقادیر مجاز: CRIMINAL_474 | CIVIL_426 | SPECIAL_477")
    case_description = (req.case_description or "").strip()
    if not case_description:
        raise HTTPException(status_code=422, detail="شرح ادله جدید و ابطال‌خواهی (case_description) الزامی است.")
    user_id = (req.user_identifier or "").strip()[:100]
    if not user_id:
        raise HTTPException(status_code=422, detail="شناسه کاربر (user_identifier) الزامی است.")
    # گیت ۱ — احراز هویت OTP (پیامک/ایمیل)
    if not req.is_verified:
        raise HTTPException(status_code=403, detail="برای سنجش اعاده دادرسی، احراز هویت با کد یک‌بارمصرف (پیامک/ایمیل) الزامی است.")
    if not (OPENROUTER_KEY or _kira_configured()):
        raise HTTPException(status_code=503, detail="موتور تحلیل قضایی (OpenRouter/Kira AI) تنظیم نشده است.")
    try:
        await _ensure_retrial_schema()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"زیرساخت اعاده دادرسی در دسترس نیست: {str(exc)[:160]}")
    # گیت ۲ — سهمیه رایگان
    used = await asyncio.to_thread(_retrial_quota_count_sync, user_id)
    if used >= RETRIAL_FREE_QUOTA:
        raise HTTPException(status_code=403, detail="سهمیه رایگان تحلیل اعاده دادرسی شما استفاده شده است؛ برای ادامه اشتراک خود را ارتقا دهید.")

    verdict_details = (req.verdict_details or "").strip()
    phone = user_id if (user_id.startswith("09") and len(user_id) == 11 and user_id[2:].isdigit()) else None
    email = user_id if (not phone and "@" in user_id and "." in user_id.split("@")[-1]) else None
    row_id = await asyncio.to_thread(
        _retrial_claim_sync, user_id, phone, email, retrial_type, case_description, verdict_details[:4000] or None)
    try:
        result = await _retrial_evaluate_engine(retrial_type, case_description, verdict_details)
    except HTTPException:
        await asyncio.to_thread(_retrial_release_sync, row_id)
        raise
    except Exception as exc:
        await asyncio.to_thread(_retrial_release_sync, row_id)  # سهمیه برگشت داده می‌شود
        raise HTTPException(status_code=502, detail=f"تحلیل اعاده دادرسی ناموفق بود: {str(exc)[:160]}")
    await asyncio.to_thread(
        _retrial_finalize_sync, row_id, int(result["eligibility_score"]),
        str(result["matched_clause"]), str(result["petition_text"]))
    result["response_id"] = row_id
    result["quota"] = {"used": used + 1, "free_quota": RETRIAL_FREE_QUOTA,
                       "remaining": max(0, RETRIAL_FREE_QUOTA - (used + 1))}
    return result

# ─────────────────────────────────────────────────────────────────────────────
# Endpoints پایه سامانه
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/health")
async def health():
    try:
        stats: Any = await asyncio.to_thread(_graph_stats_sync)
    except Exception as exc:
        stats = {"status": "UNAVAILABLE", "error": str(exc)[:160]}
    return {
        "status": "ONLINE",
        "engine": "Roxira SmartJudge Dual-Level GraphRAG (Qdrant Vector + PostgreSQL Graph + OpenRouter/Kira AI LLM)",
        "llm_configured": bool(OPENROUTER_KEY or _kira_configured()),
        "providers": {
            "openrouter": bool(OPENROUTER_KEY),
            "kira_ai": _kira_configured(),
            "kira_reasoning_model": KIRA_REASONING_MODEL,
            "kira_fallback_model": KIRA_FALLBACK_MODEL,
            "kira_fallback_context_tokens": KIRA_FALLBACK_CONTEXT_TOKENS,
        },
        "groq_stt_configured": bool(GROQ_API_KEY),
        "assemblyai_stt_configured": _assemblyai_configured(),
        "assemblyai_stt_keys": len(ASSEMBLYAI_API_KEYS),
        "assemblyai_stt_active_keys": len(_assemblyai_active_keys()),
        "assemblyai_stt_speech_model": ASSEMBLYAI_STT_MODEL,
        "stt": (
            "assemblyai-pool-" + ASSEMBLYAI_STT_MODEL
            if _assemblyai_configured()
            else ("groq-whisper-large-v3-turbo" if GROQ_API_KEY else "local-faster-whisper")
        ),
        "prompt_caching": "static-prefix-first (OpenRouter prefix cache)",
        "collections": list(VECTOR_COLLECTIONS.values()),
        "graph_relations": GRAPH_RELATIONS,
        "tier_models": TIER_MODELS,
        "retrial_module": {"free_quota": RETRIAL_FREE_QUOTA, "case_types": list(RETRIAL_CASE_TYPES)},
        "graph_db": stats,
    }


# شاخص‌های رسمی منتشرشده بانک مرکزی — پایه محاسبه ماده ۵۲۲ و رای وحدت رویه ۸۴۰؛
# از طریق متغیر محیطی CBI_INFLATION_INDICES_JSON قابل به‌روزرسانی است.
_DEFAULT_CBI_INDICES: Dict[int, float] = {
    1398: 180.5, 1399: 247.3, 1400: 367.4, 1401: 520.1, 1402: 760.3, 1403: 1050.2, 1404: 1420.0,
}


def _cbi_indices() -> Dict[int, float]:
    raw = _read_env_key("CBI_INFLATION_INDICES_JSON")
    if raw:
        try:
            return {int(k): float(v) for k, v in json.loads(raw).items()}
        except Exception as exc:
            logger.warning("[SMARTJUDGE] CBI_INFLATION_INDICES_JSON invalid: %s", exc)
    return dict(_DEFAULT_CBI_INDICES)


@router.post("/calculate-delay-damages")
async def calculate_inflation(req: InflationCalcRequest):
    """محاسبه واقعی خسارت تاخیر تادیه بر اساس شاخص بانک مرکزی (ماده ۵۲۲ ق.آ.د.م و رای وحدت رویه ۸۴۰)."""
    indices = _cbi_indices()
    if req.end_year < req.start_year:
        raise HTTPException(status_code=400, detail="سال پایان باید بزرگ‌تر یا مساوی سال شروع باشد.")
    if req.start_year not in indices or req.end_year not in indices:
        missing = [y for y in (req.start_year, req.end_year) if y not in indices]
        raise HTTPException(
            status_code=422,
            detail=f"شاخص تورم سال(های) {missing} در پایگاه داده ثبت نشده است؛ مقدار ساختگی برنمی‌گردانیم.",
        )
    start_idx = indices[req.start_year]
    end_idx = indices[req.end_year]
    updated_value = req.principal_amount_irr * (end_idx / start_idx)
    return {
        "principal_amount": req.principal_amount_irr,
        "start_year": req.start_year,
        "end_year": req.end_year,
        "start_index": start_idx,
        "end_index": end_idx,
        "updated_value_to_date": round(updated_value, 2),
        "total_delay_damages": round(updated_value - req.principal_amount_irr, 2),
        "legal_basis": "ماده ۵۲۲ قانون آیین دادرسی مدنی و رای وحدت رویه ۸۴۰ دیوان عالی کشور",
        "index_source": "بانک مرکزی جمهوری اسلامی ایران (قابل به‌روزرسانی با CBI_INFLATION_INDICES_JSON)",
    }


@router.post("/classify-court")
async def classify_court_jurisdiction(req: JurisdictionRequest):
    """تعیین مرجع صالح بر اساس نصاب قانونی دادگاه‌های صلح و عمومی."""
    peace_court_threshold = 1000000000.0  # ۱ میلیارد ریال (۱۰۰ میلیون تومان)
    if req.dispute_type == "FINANCIAL":
        if req.claim_amount_irr <= peace_court_threshold:
            competent_court = "دادگاه صلح"
            appeal_status = "قطعی در صورت خواسته زیر ۵۰۰ میلیون ریال، قابل تجدیدنظر در دادگاه تجدیدنظر استان"
        else:
            competent_court = "دادگاه عمومی حقوقی"
            appeal_status = "قابل تجدیدنظرخواهی در دادگاه تجدیدنظر استان ظرف ۲۰ روز"
    elif req.dispute_type == "COMMERCIAL":
        competent_court = "دادگاه عمومی حقوقی (شعبه تخصصی تجاری)"
        appeal_status = "قابل تجدیدنظرخواهی"
    else:
        competent_court = "دادگاه عمومی حقوقی / دادسرا بر حسب نوع دعوا"
        appeal_status = "تابع مقررات عمومی آیین دادرسی"
    return {
        "dispute_type": req.dispute_type,
        "claim_amount": req.claim_amount_irr,
        "competent_authority": competent_court,
        "jurisdiction_notes": appeal_status,
        "city": req.city,
        "governing_law": "قانون شوراهای حل اختلاف مصوب ۱۴۰۲ و قانون آیین دادرسی مدنی",
    }


@router.post("/unified-search")
async def unified_search(req: MasterLegalSearchRequest):
    """جست‌وجوی یکپارچه دو لایه — بدون آرایه‌های ساختگی خالی."""
    rag, graph = await asyncio.gather(
        _rag_retrieve(req.query, per_collection=req.limit, pool=60),
        _graph_retrieve(req.query),
    )
    graph_nodes = [
        {"node_id": n.get("node_id"), "title": n.get("title"), "type": n.get("node_type"), "depth": n.get("depth")}
        for n in (graph.get("nodes") or [])
    ]
    graph_relations = [
        {"source": r.get("source_title"), "relation": r.get("relation"),
         "target": r.get("target_title"), "description": r.get("description")}
        for r in (graph.get("relations") or [])
    ]
    counts = [len(rag.get(k) or []) for k in ("laws", "precedents", "advisories", "circulars")]
    return {
        "query": req.query,
        "laws_matches": rag.get("laws", []),
        "precedents_matches": rag.get("precedents", []),
        "advisory_matches": rag.get("advisories", []),
        "circulars_matches": rag.get("circulars", []),
        "graph_matches": {"status": graph.get("status"), "nodes": graph_nodes, "relations": graph_relations},
        "total_found": sum(counts) + len(graph_nodes),
        "status": "SUCCESS",
        "retrieval": {"mode": "dual-level-lightrag", "vector": rag.get("retrieval"), "graph": graph.get("status")},
    }


@router.post("/synthesize-case")
async def synthesize_case(req: LegalJudicialRequest):
    """انشای دادنامه با LLM واقعی روی هر دو لایه بازیابی — بدون متن ساختگی."""
    rag, graph = await asyncio.gather(
        _rag_retrieve(req.case_description, per_collection=req.limit),
        _graph_retrieve(req.case_description),
    )
    system_prompt = (
        "شما قاضی ارشد دیوان عالی کشور در سامانه رکسایرا هستید. بر اساس قوانین، روابط گراف مواد قانونی و "
        "آرای وحدت رویه پیوست، دادنامه‌ای مستدل، ساختارمند و به زبان فارسی بنویس. هیچ شماره رای یا ماده‌ای از خودت نساز؛ "
        "فقط به اسناد پیوست استناد کن."
    )
    ctx = json.dumps({
        "قوانین": [{"title": _payload_title(p), "meta": _payload_meta(p), "text": _payload_text(p, 400)} for p in rag.get("laws", [])],
        "رویه": [{"title": _payload_title(p), "meta": _payload_meta(p), "text": _payload_text(p, 300)} for p in rag.get("precedents", [])],
        "نظریات_مشورتی": [{"title": _payload_title(p), "text": _payload_text(p, 250)} for p in rag.get("advisories", [])],
        "بخشنامه‌ها": [{"title": _payload_title(p), "text": _payload_text(p, 250)} for p in rag.get("circulars", [])],
        "گراف_قضایی": {
            "گره‌ها": [{"id": n.get("node_id"), "title": n.get("title")} for n in (graph.get("nodes") or [])],
            "روابط": [{"منبع": r.get("source_title"), "رابطه": r.get("relation"), "مقصد": r.get("target_title")} for r in (graph.get("relations") or [])],
        },
    }, ensure_ascii=False)
    content, model_used = await _chat_completion(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"پرونده: {req.case_description}\n\nمستندات بازیابی‌شده:\n{ctx}"},
        ],
        models=_model_chain("tier2"),
        max_tokens=TIER_MAX_TOKENS["tier2"],
    )
    return {
        "case_title": req.case_description[:80],
        "action_type": req.action_type,
        "legal_sources": rag,
        "graph_context": {
            "status": graph.get("status"),
            "nodes": len(graph.get("nodes") or []),
            "relations": len(graph.get("relations") or []),
        },
        "judicial_synthesis": content,
        "model_used": model_used,
        "retrieval": "dual-level-lightrag",
    }
# ─────────────────────────────────────────────────────────────────────────────
# STT واقعی — Whisper (OpenAI/Groq API یا faster-whisper محلی) (Task 2)
# ─────────────────────────────────────────────────────────────────────────────
_whisper_model = None
_whisper_lock = threading.Lock()
_WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "large-v3-turbo")
_AUDIO_TMP_DIR = "/tmp"
_ALLOWED_AUDIO_EXT = {".webm", ".wav", ".mp3", ".m4a", ".ogg", ".oga", ".mpeg", ".mpga"}
_AUDIO_MIME = {
    ".webm": "audio/webm", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
    ".ogg": "audio/ogg", ".oga": "audio/ogg", ".mpeg": "audio/mpeg", ".mpga": "audio/mpeg",
}


def _get_whisper():
    """بارگذاری تنبل faster-whisper («base» روی CPU با compute_type=int8)."""
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    with _whisper_lock:
        if _whisper_model is None:
            from faster_whisper import WhisperModel  # import سنگین — فقط در صورت نیاز
            _whisper_model = WhisperModel(_WHISPER_MODEL_NAME, device="cpu", compute_type="int8")
            logger.info("[SMARTJUDGE] faster-whisper model '%s' loaded", _WHISPER_MODEL_NAME)
    return _whisper_model


def _save_temp_audio(raw: bytes, filename: str) -> str:
    """ذخیره فایل صوتی ورودی در /tmp/input_audio_<timestamp><پسوند> — پسوند واقعی حفظ می‌شود."""
    suffix = pathlib.Path(filename or "").suffix.lower()
    if suffix not in _ALLOWED_AUDIO_EXT:
        suffix = ".webm"
    tmp_path = os.path.join(_AUDIO_TMP_DIR, f"audio_in_{time.time_ns()}{suffix}")
    with open(tmp_path, "wb") as fh:
        fh.write(raw)
    return tmp_path


def _transcribe_local(tmp_path: str) -> str:
    """تبدیل واقعی گفتار با faster-whisper روی CPU — فقط کلمات دقیق گفته‌شده کاربر.

    Task 3 — رفع برش دنباله (Tail Truncation):
      condition_on_previous_text=False ⇒ هر پنجره صوتی مستقل رمزگشایی می‌شود و
      متن پنجره‌های قبلی دیگر عامل توهم/تکرار یا برش انتهای گفتار نیست.
    """
    model = _get_whisper()
    segments, _ = model.transcribe(
        tmp_path,
        language="fa",
        initial_prompt=LEGAL_STT_PROMPT,  # سوگیری واژگان تخصصی + پایان گفتاری (Task 3)
        condition_on_previous_text=False,  # رفع برش دنباله — رمزگشایی مستقل هر پنجره
        beam_size=5,
        temperature=0.0,
        vad_filter=True,
        repetition_penalty=1.15,       # جلوگیری از حلقه تکرار روی صداهای دگرگونه
        no_repeat_ngram_size=15,       # شکستن لوپ‌های وارونه بدون آسیب به تکرارهای طبیعی
    )
    transcript = " ".join([seg.text for seg in segments]).strip()
    # پاکسازی کامل (حذف پیش‌گفتار + ترمیم آوایی) پیش از بازگشت متن (مسیر local whisper)
    return _clean_stt_output(transcript)


async def _transcribe_groq(tmp_path: str) -> str:
    """ارسال مستقیم فایل صوتی به Groq — whisper-large-v3-turbo با زبان فارسی.

    Task 3 — پارامترهای رفع برش دنباله (condition_on_previous_text / beam_size)
    جزو اسکیمای رسمی Groq نیستند؛ best-effort ارسال می‌شوند و اگر ارائه‌دهنده
    آن‌ها را رد کند (HTTP 400/422)، یک بار بدون آن‌ها تکرار می‌شود تا مسیر زنده
    STT هرگز نشکند. temperature=0.0 (خروجی قطعی) در هر دو حالت رعایت می‌شود.
    """
    mime = _AUDIO_MIME.get(pathlib.Path(tmp_path).suffix.lower(), "audio/webm")
    base_data = {
        "model": GROQ_STT_MODEL,
        "language": "fa",
        "prompt": LEGAL_STT_PROMPT,  # سوگیری واژگان تخصصی + پایان گفتاری (Task 3)
        "temperature": 0.0,
        "response_format": "json",
    }
    tail_fix_data = dict(base_data, condition_on_previous_text="false", beam_size="5")

    async def _post_groq(data: dict) -> "httpx.Response":
        with open(tmp_path, "rb") as fh:
            files = {"file": (os.path.basename(tmp_path), fh, mime)}
            async with httpx.AsyncClient(timeout=180.0) as client:
                return await client.post(
                    "https://api.groq.com/openai/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                    files=files,
                    data=data,
                )

    r = await _post_groq(tail_fix_data)
    if r.status_code in (400, 422):  # ارائه‌دهنده پارامترهای خارج از اسکیما را رد کرد
        r = await _post_groq(base_data)
    if r.status_code != 200:
        raise RuntimeError(f"Groq STT HTTP {r.status_code}: {r.text[:200]}")
    # پاکسازی کامل (حذف پیش‌گفتار + ترمیم آوایی) پیش از بازگشت متن (مسیر Groq)
    return _clean_stt_output(str(r.json().get("text") or ""))


# ─────────────────────────────────────────────────────────────────────────────
# AssemblyAI — استخر کلیدی STT با چرخش و غیرفعال‌سازی پایدار کلید روی 401/402/429
#   مسیر: upload → ایجاد transcript → انتظار (poll) تا completed
#   هر کلیدی که 401 (نامعتبر) / 402 (اتمام سهمیه) / 429 (ریت‌لیمیت) بدهد از
#   استخر غیرفعال شده و همان لحظه درخواست با کلید بعدی ارسال می‌شود.
# ─────────────────────────────────────────────────────────────────────────────
_assemblyai_key_lock = threading.Lock()
_assemblyai_key_cursor = 0
_assemblyai_disabled_keys: set = set()


def _assemblyai_configured() -> bool:
    """آیا کلید فعالی در استخر AssemblyAI باقی مانده است."""
    return bool(_assemblyai_active_keys())


def _assemblyai_disable_key(key: str, reason: str = "") -> None:
    """غیرفعال‌سازی پایدار کلید مردود/مصرف‌شده تا هرگز دوباره تلاش نشود."""
    with _assemblyai_key_lock:
        _assemblyai_disabled_keys.add(key)
    logger.warning(
        "[SMARTJUDGE] AssemblyAI key …%s disabled%s",
        key[-4:] if key else "????",
        f" ({reason})" if reason else "",
    )


def _assemblyai_active_keys() -> List[str]:
    """کلیدهای سالم استخر (بدون موارد غیرفعال‌شده)."""
    with _assemblyai_key_lock:
        return [k for k in ASSEMBLYAI_API_KEYS if k not in _assemblyai_disabled_keys]


def _assemblyai_key_order() -> List[str]:
    """ترتیب چرخشی کلیدهای فعال از اندیس جاری — round-robin ایمن در چندریسمان.

    هر فراخوانی اندیس جاری را یک گام جلو می‌برد تا بار درخواست‌ها به‌صورت
    طبیعی بین کلیدهای استخر پخش شود. کلیدهای غیرفعال‌شده حذف می‌شوند.
    """
    global _assemblyai_key_cursor
    with _assemblyai_key_lock:
        keys = [k for k in ASSEMBLYAI_API_KEYS if k not in _assemblyai_disabled_keys]
        if not keys:
            return []
        start = _assemblyai_key_cursor % len(keys)
        _assemblyai_key_cursor = (start + 1) % len(keys)
    return keys[start:] + keys[:start]


class _AssemblyAIRotateError(Exception):
    """خطای مرتبط با کلید (401/402/429) — موجب غیرفعال‌سازی کلید و چرخش فوری."""

    def __init__(self, status: int, detail: str = ""):
        super().__init__(f"HTTP {status} {detail}".strip())
        self.status = status


async def _assemblyai_upload(tmp_path: str, key: str) -> str:
    """بارگذاری فایل با کلید مشخص — یک تلاش؛ خطای چرخشی به‌صورت استثنا بالا می‌رود."""
    mime = _AUDIO_MIME.get(pathlib.Path(tmp_path).suffix.lower(), "audio/webm")
    with open(tmp_path, "rb") as fh:
        payload = fh.read()
    async with httpx.AsyncClient(timeout=180.0) as client:
        r = await client.post(
            f"{ASSEMBLYAI_BASE}/upload",
            headers={"authorization": key, "content-type": mime},
            content=payload,
        )
    if r.status_code == 200:
        return str(r.json().get("upload_url") or "")
    if r.status_code in ASSEMBLYAI_ROTATE_STATUS:
        raise _AssemblyAIRotateError(r.status_code, r.text[:120])
    raise RuntimeError(f"AssemblyAI upload failed: HTTP {r.status_code} {r.text[:160]}")


async def _assemblyai_create_transcript(audio_url: str, key: str) -> str:
    """ایجاد رونویس با همان کلید بارگذاری — language_code=fa و speech_model=best.

    کلید باید دقیقاً همان کلید upload باشد؛ فایل بارگذاری‌شده به حساب همان کلید
    تعلق دارد و استفاده از کلید دیگر خطای «Cannot access uploaded file» می‌دهد.
    ترتیب تلاش: speech_model=best (بالاترین دقت فارسی) و در صورت رد شدن توسط API
    (deprecation/400) → speech_models=[universal-3-5-pro, universal-2] به‌عنوان
    معادل رسمی «best»؛ در هر دو حالت پارامتر prompt در صورت عدم پشتیبانی حذف می‌شود.
    """
    base = {"audio_url": audio_url, "language_code": "fa"}
    variants: List[Dict[str, Any]] = [
        {**base, "speech_model": ASSEMBLYAI_STT_MODEL, "prompt": LEGAL_STT_PROMPT},
        {**base, "speech_model": ASSEMBLYAI_STT_MODEL},
        {**base, "speech_models": ASSEMBLYAI_BEST_MODELS, "prompt": LEGAL_STT_PROMPT},
        {**base, "speech_models": ASSEMBLYAI_BEST_MODELS},
    ]
    headers = {"authorization": key, "content-type": "application/json"}
    last_body = ""
    async with httpx.AsyncClient(timeout=60.0) as client:
        for payload in variants:
            r = await client.post(f"{ASSEMBLYAI_BASE}/transcript", headers=headers, json=payload)
            if r.status_code == 200:
                return str(r.json().get("id") or "")
            if r.status_code in ASSEMBLYAI_ROTATE_STATUS:
                raise _AssemblyAIRotateError(r.status_code, r.text[:120])
            if r.status_code not in (400, 422):
                raise RuntimeError(f"AssemblyAI transcript create failed: HTTP {r.status_code} {r.text[:160]}")
            last_body = r.text[:160]  # اسکیمای نامعتبر → نسخه بعدی
    raise RuntimeError(f"AssemblyAI transcript create failed (all schemas): {last_body}")


async def _assemblyai_poll(transcript_id: str, key: str) -> str:
    """انتظار برای تکمیل رونویس با همان کلید؛ خطای چرخشی استثنا می‌شود."""
    deadline = time.monotonic() + 170.0
    last_err = ""
    async with httpx.AsyncClient(timeout=30.0) as client:
        while time.monotonic() < deadline:
            r = await client.get(
                f"{ASSEMBLYAI_BASE}/transcript/{transcript_id}",
                headers={"authorization": key},
            )
            if r.status_code == 200:
                body = r.json()
                status = str(body.get("status") or "")
                if status == "completed":
                    return _clean_stt_output(str(body.get("text") or ""))
                if status == "error":
                    raise RuntimeError(f"AssemblyAI transcription error: {body.get('error')}")
                # queued/processing → ادامه انتظار
            elif r.status_code in ASSEMBLYAI_ROTATE_STATUS:
                raise _AssemblyAIRotateError(r.status_code, r.text[:120])
            else:
                last_err = f"HTTP {r.status_code} {r.text[:160]}"
            await asyncio.sleep(2.0)
    raise RuntimeError(f"AssemblyAI transcription timed out: {last_err}")


async def _transcribe_assemblyai_pool(tmp_path: str) -> str:
    """تبدیل گفتار فارسی با استخر کلیدهای AssemblyAI — failover مقاوم.

    روی هر کلید، کل جریان (upload → create → poll) به‌صورت ترتیبی و با همان
    کلید اجرا می‌شود (فایل بارگذاری‌شده به حساب همان کلید تعلق دارد). با دریافت
    401 (کلید نامعتبر) / 402 (اتمام سهمیه) / 429 (ریت‌لیمیت)، همان کلید فوراً
    غیرفعال و درخواست بلافاصله با کلید بعدی استخر ارسال می‌شود.
    اولویت STT: استخر AssemblyAI → پشتیبان سریع faster-whisper.
    """
    if not ASSEMBLYAI_API_KEYS:
        raise RuntimeError("ASSEMBLYAI_API_KEYS تنظیم نشده است.")
    keys = _assemblyai_active_keys()
    if not keys:
        raise RuntimeError("تمام کلیدهای AssemblyAI غیرفعال شده‌اند.")
    last_err = ""
    for key in keys:
        try:
            upload_url = await _assemblyai_upload(tmp_path, key)
            if not upload_url:
                raise RuntimeError("AssemblyAI upload URL خالی است.")
            transcript_id = await _assemblyai_create_transcript(upload_url, key)
            if not transcript_id:
                raise RuntimeError("AssemblyAI transcript id خالی است.")
            return await _assemblyai_poll(transcript_id, key)
        except _AssemblyAIRotateError as exc:
            last_err = str(exc)
            _assemblyai_disable_key(key, f"pool {exc}")
            continue
    raise RuntimeError(f"تمام کلیدهای AssemblyAI ناموفق بودند: {last_err}")


# نام سازگاری گذشته — همان استخر مقاوم ۵ کلیدی.
_transcribe_assemblyai = _transcribe_assemblyai_pool


# ── Task 1 — ترمیم آوایی واژگان حقوقی (Persian Whisper misrecognition repair) ──
# خطاهای آوایی رایج Whisper در متون حقوقی فارسی پیش از بازگشت متن اصلاح می‌شوند.
_LEGAL_PHONETIC_REPLACEMENTS = {
    # رأی وحدت رویه — تحریف‌های آوایی رایج («وقت رویه»، «وقتترابی»، «رئیم باحتت»)
    r"رئیم\s*باحتت": "رأی وحدت رویه",
    r"(?:رای|رأی)\s*و?حدت\s*(?:رویه|ر[وآا]?اب[یي])": "رأی وحدت رویه",
    r"(?:وقتت|وقت|واحدت|وحدت|وجدت)\s*(?:ر[وآا]?اب[یي]|روی?ه)": "وحدت رویه",
    # قوه قضاییه — «قوبه قضایی» / «قوه قضائیه»
    r"قوبه\s*قضاییه?": "قوه قضاییه",
    r"قوه\s*قضائیه": "قوه قضاییه",
    r"قوه\s*قضایی(?!ه)": "قوه قضاییه",
    # دادگاه صلح
    r"دادگاه\s*صلحا": "دادگاه صلح",
    # تأخیر تأدیه و خسارت
    r"تاخیر\s*تادیه": "تأخیر تأدیه",
    r"تأخیر\s*تادیه": "تأخیر تأدیه",
    r"خسارت\s*تاخیر": "خسارت تأخیر",
    # پرونده و پیشنهاد
    r"پشناده\s*تو": "پیشنهاد شما",
    r"پیشناد\s*شما": "پیشنهاد شما",
    r"پرانده[‌\s]*های\s*پیشنفت": "پرونده‌های پیش‌رو",
    r"پرونده[‌\s]*های\s*پیشنفت": "پرونده‌های پیش‌رو",
    # واژگان مواد قانونی و اصطلاحات دادرسی
    r"مادده|مادّه": "ماده",
    r"ماده\s*۵۲۲": "ماده ۵۲۲",
    r"ماده\s*۴۷۴": "ماده ۴۷۴",
    r"ماده\s*۴۲۶": "ماده ۴۲۶",
    r"ماده\s*۴۷۷": "ماده ۴۷۷",
    r"آئین\s*دادرسی": "آیین دادرسی",
    r"اعاده\s*دادرسیه": "اعاده دادرسی",
    r"تجدید\s*نظر": "تجدیدنظر",
    r"فرجام\s*خواهی": "فرجام‌خواهی",
    r"محکوم\s*علیه": "محکوم‌علیه",
    r"مسئولیت\s*تضامنی": "مسئولیت تضامنی",
    r"وجه\s*التزام": "وجه‌التزام",
}


def _repair_legal_phonetics(text: str) -> str:
    """ترمیم قانون‌مند تحریف‌های آوایی Whisper در اصطلاحات تخصصی حقوقی."""
    text = text or ""
    for pattern, target in _LEGAL_PHONETIC_REPLACEMENTS.items():
        text = re.sub(pattern, target, text)
    return text.strip()


# ── Task 3 — نرمال‌سازی متن پیاده‌سازی‌شده گفتار (حذف نویز پیش‌گفتار/پرکننده) ──
# پیش‌گفتارهای رایج گفتار فارسی + دنباله گفتاری خودِ پرامپت STT («لطفاً به صورت
# خیلی خلاصه توضیح دهید») نباید به تحلیلگر قضایی برسند.
_TRANSCRIPT_PREAMBLE_PATTERNS = (
    # پیش‌گفتارهای مذهبی/تشریفاتی («به نام خداوند بخشنده و مهربان»، «بسم الله الرحمن الرحیم»)
    r"^\s*(?:به|بنام)\s*نام\s*(?:خداوند|خدا|پروردگار)\s*(?:بخشنده\s*(?:و\s*)?)?(?:مهربان|رحمان|رحیم)?[\s،,:؛\-]*",
    r"^\s*بسم\s*الله\s*(?:الرحمن\s*)?الرحیم[\s،,:؛\-]*",
    # سلام و علیک و احوال‌پرسی
    r"^\s*(?:ال)?سلام\s*علیکم(?:\s*و\s*(?:رحمت\s*الله|برکاته?))?(?:\s*و\s*برکاته?)?[\s،,:؛\-]*",
    r"^\s*(?:با\s*)?(?:عرض\s*)?(?:سلام|درود|ادب|ارادت)(?:\s*و\s*(?:درود|ادب|ارادت|احترام))?(?:\s*(?:دارم|داریم|عرض\s*می‌کنم))?[\s،,:؛\-]*",
    r"^\s*عرض\s*(?:ادب|ارادت|سلام)[\s،,:؛\-]*",
    r"^\s*احتراماً?[\s،,:؛\-]*",
    r"^\s*خدمت\s*(?:حضرات|شما|دوستان|آقایان|سروران|استاد)?[\s،,:؛\-]*(?:عرض\s*(?:کنم|می‌کنم))?[\s،,:؛\-]*",
    r"^\s*خسته\s*نباشید[\s،,:؛\-]*",
    r"^\s*(?:وقت|روز|صبح|عصر|شب)\s*(?:شما\s*)?بخیر[\s،,:؛\-]*",
    # دنباله گفتاری خودِ پرامپت STT
    r"^\s*لطفا\S*\s*به\s*صورت\s*خیلی\s*خلاصه\s*توضیح\s*دهید[\s،,:؛\-]*",
    r"^\s*لطفا\S*\s*(?:توضیح\s*دهید|بررسی\s*کنید)[\s،,:؛\-]*",
    r"^\s*وای[\s،,:؛\-]*",
)
_TRANSCRIPT_FILLER_TOKENS = frozenset({"خب", "اوه", "اِ", "اِم", "امم", "هوم", "مم", "ببین"})
_TRANSCRIPT_TAIL_TOKENS = frozenset({"ممنون", "مرسی", "سپاس", "تشکر", "خب", "باشه", "خواهش"})


def _normalize_transcript(text: str) -> str:
    """Task 3 — حذف پیش‌گفتارهای محاوره‌ای («سلام علیکم»، «بسم الله»، دنباله پرامپت STT)
    و واژه‌های پرکننده («خب»، «اوه»، ...) از خروجی گفتاربه‌متن پیش از ارسال به تحلیلگر."""
    t = (text or "").strip()
    if not t:
        return ""
    changed = True
    while changed:
        changed = False
        for pattern in _TRANSCRIPT_PREAMBLE_PATTERNS:
            stripped = re.sub(pattern, "", t, count=1).strip()
            if stripped != t:
                t, changed = stripped, True
        tokens = t.split()
        while tokens and tokens[0].strip("،,.!؟:؛") in _TRANSCRIPT_FILLER_TOKENS:
            tokens = tokens[1:]
            changed = True
        while tokens and tokens[-1].strip("،,.!؟:؛") in _TRANSCRIPT_TAIL_TOKENS:
            tokens = tokens[:-1]
            changed = True
        t = " ".join(tokens).strip()
    return re.sub(r"\s{2,}", " ", t).strip()


def _clean_stt_output(text: str) -> str:
    """خط لوله کامل پاکسازی خروجی گفتاربه‌متن پیش از ارسال به تحلیلگر قضایی.

    ۱) حذف خودکار پیش‌گفتارهای تشریفاتی/مذهبی («به نام خداوند بخشنده و مهربان»،
       «سلام علیکم»، «بسم الله الرحمن الرحیم»، «با عرض ادب»، ...).
    ۲) حذف پرکننده‌های محاوره‌ای و دنباله گفتاری پرامپت STT.
    ۳) ترمیم تحریف‌های آوایی واژگان حقوقی («وقتترابی» → «وحدت رویه»).

    خروجی: مستقیماً پرسش کاربر یا شرح پرونده، بدون هیچ پیش‌گفتار.
    """
    return _repair_legal_phonetics(_normalize_transcript(text))


@router.post("/transcribe-audio")
async def transcribe_audio(file: UploadFile = File(...)):
    """تبدیل گفتار به متن — فقط کلمات دقیق گفته‌شده کاربر؛ بدون هیچ متن قالبی ساختگی."""
    try:
        raw = await file.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"خواندن فایل صوتی ناموفق بود: {exc}")
    if not raw:
        raise HTTPException(status_code=400, detail="فایل صوتی خالی است.")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="حجم فایل صوتی بیش از ۲۵ مگابایت است.")

    tmp_path = _save_temp_audio(raw, file.filename or "input_audio.webm")
    transcript = ""
    try:
        # ۱) استخر ۵ کلیدی AssemblyAI — بالاترین اولویت (failover مقاوم روی 401/402/429)
        if _assemblyai_configured():
            try:
                transcript = await _transcribe_assemblyai_pool(tmp_path)
            except Exception as exc:
                logger.warning("[SMARTJUDGE] AssemblyAI STT pool failed: %s", exc)

        # ۲) Groq Whisper-large-v3-turbo — پردازش سریع فارسی سمت سرور (در صورت وجود کلید)
        if not transcript and GROQ_API_KEY:
            try:
                transcript = await _transcribe_groq(tmp_path)
            except Exception as exc:
                logger.warning("[SMARTJUDGE] Groq STT failed: %s", exc)

        # ۳) پشتیبان سریع محلی — faster-whisper («base», CPU, int8)
        if not transcript:
            try:
                transcript = await asyncio.to_thread(_transcribe_local, tmp_path)
            except Exception as exc:
                logger.error("[SMARTJUDGE] local whisper failed: %s", exc)
                raise HTTPException(
                    status_code=503,
                    detail=f"خط لوله تبدیل گفتار در دسترس نیست: {str(exc)[:300]}",
                )
    finally:
        # پاکسازی فایل صوتی موقت پس از پردازش
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except Exception:
            pass

    # پاکسازی نهایی خروجی (حذف پیش‌گفتار تشریفاتی/مذهبی + ترمیم آوایی حقوقی)
    return {"status": "OK", "transcript": _clean_stt_output(transcript)}