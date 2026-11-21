"""LLM router hygiene for Smart Judge (T236): effort pins, static prefix, per-user caps.

No model IDs are hardcoded here; model selection stays in ``config/models.yaml``.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Optional, Sequence

# ---------------------------------------------------------------------------
# 1. Reasoning / thinking effort pins (avoid 18-22 s thinking TTFT)
# ---------------------------------------------------------------------------
_ALLOWED_EFFORTS = frozenset({"none", "minimal", "low", "medium", "high"})


def build_reasoning_params(
    model_id: str,
    *,
    default_effort: Optional[str] = None,
) -> dict[str, Any]:
    """Return provider-compatible reasoning effort payload to prevent long thinking TTFT.

    Uses model family prefixes (never hardcoded model IDs).
    """
    effort = (default_effort or os.environ.get("SMARTJUDGE_REASONING_EFFORT") or "low").strip().lower()
    if effort not in _ALLOWED_EFFORTS:
        effort = "low"
    family = (model_id or "").strip().lower()
    if "gemini" in family:
        return {"reasoning": {"effort": "none" if effort in ("none", "minimal") else effort}}
    if "deepseek" in family or "qwen" in family or "openai" in family or "anthropic" in family:
        return {"reasoning": {"effort": effort}}
    return {"reasoning": {"effort": effort}}


# ---------------------------------------------------------------------------
# 2. Static ~1,200-token Persian legal system prefix for provider prefix caching
# ---------------------------------------------------------------------------
STATIC_LEGAL_SYSTEM_PREFIX = (
    "شما «قاضی هوشمند روکسیرا»، دستیار تخصصی حقوقی ایران هستید. "
    "تمامی پاسخ‌های شما باید دقیق، مستند به قوانین موضوعه جمهوری اسلامی ایران، "
    "آرای وحدت رویه دیوان عالی کشور، آرای هیئت عمومی دیوان عدالت اداری و مقررات معتبر باشد.\n\n"
    "اصول قطعی پاسخ‌گویی حقوقی:\n"
    "۱. استناد دقیق و بدون جعل: تنها به مواد قانونی، تبصره‌ها، بندها و آرایی استناد کنید که در متن بازیابی‌شده "
    "در انتهای همین پیام وجود دارند یا قطعیت قانونی آن‌ها محرز است. هرگز شماره ماده، تاریخ تصویب یا رأی وحدت رویه "
    "جعل نکنید. اگر منبع معتبر و رسمی در اختیار نیست، صراحتاً اعلام کنید.\n"
    "۲. تفکیک سلسله‌مراتب اعتبار منابع: میان قانون اساسی، قوانین عادی مصوب مجلس و آرای وحدت رویه (لازم‌الاتباع) "
    "با آیین‌نامه‌ها، بخشنامه‌ها و نظریات مشورتی (غیرلازم‌الاتباع) و رویه شعب یا دیدگاه‌های دکترین تفاوت قائل شوید. "
    "نظریه مشورتی یا نظر دکترین به‌تنهایی جایگزین نص صریح قانون نیست.\n"
    "۳. دقت زمانی و نسخ: همواره به آخرین اصلاحات قانونی، تاریخ لازم‌الاجرا شدن، و وضعیت اعتبار (معتبر، اصلاح‌شده، "
    "منسوخ یا لایحه تصویب‌نشده) توجه کنید. در مورد لوایح تصویب‌نشده صراحتاً قید کنید که هنوز به قانون تبدیل نشده‌اند.\n"
    "۴. محاسبات و مهلت‌های قانونی: در بیان مهلت‌های دادرسی (واخواهی، تجدیدنظر، فرجام، اعاده دادرسی، اعتراض ثالث)، "
    "مرور زمان، دیه، خسارت تأخیر تأدیه و نصاب‌های مالی، تاریخ مبدا محاسبه و استثناهای مقیم خارج از کشور یا عذر موجه "
    "را دقیق بیان کنید.\n"
    "۵. ساختار پاسخ: پاسخ را به فارسی روان، رسمی و حقوقی بنویسید: ابتدا نتیجه‌گیری کوتاه و کاربردی، سپس مبنای قانونی "
    "با ذکر دقیق نام قانون و شماره ماده/تبصره، سپس نکات عملی و مدارک لازم، و در پایان هشدار درباره ضرورت مشورت با "
    "وکیل دادگستری در پرونده‌های پیچیده.\n"
    "۶. حریم خصوصی و ایمنی: از درخواست اطلاعات حساس غیرضروری (رمز عبور، شماره کارت، کد ملی) خودداری کنید و "
    "هرگز راهنمایی برای دور زدن قانون یا اقدامات غیرقانونی ارائه ندهید.\n"
    "۷. شفافیت در ابهام: اگر پرسش کاربر فاقد جزئیات کلیدی (مانند نوع عقد، تاریخ وقوع، مرجع رسیدگی یا وجود قرارداد "
    "کتبی) است، ابتدا پاسخ را بر اساس فرض‌های رایج تفکیک کنید و سپس دقیقاً بپرسید کدام فرض منطبق بر پرونده است.\n"
    "۸. نقل‌قول وفادارانه: هنگام نقل متن ماده قانونی، عین متن نمایشی (verbatim) را حفظ کنید و از تغییر واژگان "
    "قانونی خودداری نمایید."
)


def build_cacheable_messages(
    retrieved_context: str,
    question: str,
    *,
    history: Optional[Sequence[Mapping[str, str]]] = None,
    system_prefix: str = STATIC_LEGAL_SYSTEM_PREFIX,
    enable_cache_control: bool = False,
) -> list[dict[str, Any]]:
    """Build chat messages with the static Persian prefix FIRST and retrieved context + question LAST.

    Keeping the system prefix byte-identical across requests maximizes provider prompt-prefix caching.
    """
    if enable_cache_control:
        sys_msg: dict[str, Any] = {
            "role": "system",
            "content": [
                {
                    "type": "text",
                    "text": system_prefix,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
        }
    else:
        sys_msg = {"role": "system", "content": system_prefix}

    messages: list[dict[str, Any]] = [sys_msg]
    if history:
        for turn in history:
            role = str(turn.get("role") or "").strip()
            content = str(turn.get("content") or "")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})

    ctx = (retrieved_context or "").strip()
    q = (question or "").strip()
    if ctx:
        user_body = f"منابع قانونی بازیابی‌شده:\n{ctx}\n\nپرسش کاربر:\n{q}"
    else:
        user_body = q
    messages.append({"role": "user", "content": user_body})
    return messages


def extract_cached_tokens(usage: Optional[Mapping[str, Any]]) -> int:
    """Extract cached input token count from OpenRouter/OpenAI or Anthropic usage dicts."""
    if not usage:
        return 0
    details = usage.get("prompt_tokens_details")
    if isinstance(details, Mapping) and isinstance(details.get("cached_tokens"), int):
        return int(details["cached_tokens"])
    if isinstance(usage.get("cache_read_input_tokens"), int):
        return int(usage["cache_read_input_tokens"])
    return 0


# ---------------------------------------------------------------------------
# 3. Per-user caps in Redis (default: 6 / 5 min, 30 / day) with Persian 429
# ---------------------------------------------------------------------------
DEFAULT_CAP_5M = 6
DEFAULT_CAP_DAILY = 30
WINDOW_5M_SECONDS = 300
WINDOW_DAILY_SECONDS = 86_400

RATE_LIMIT_MESSAGE_5M_FA = (
    "تعداد پرسش‌های شما در ۵ دقیقه گذشته به سقف مجاز رسیده است. "
    "لطفاً چند دقیقه دیگر دوباره تلاش کنید."
)
RATE_LIMIT_MESSAGE_DAILY_FA = (
    "سقف مجاز پرسش‌های روزانه شما تکمیل شده است. "
    "لطفاً فردا دوباره تلاش کنید یا اشتراک خود را ارتقا دهید."
)


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    status_code: int
    retry_after_s: int = 0
    message_fa: str = ""
    scope: str = ""


class PerUserRateLimiter:
    """Per-user sliding/fixed-window rate limiter backed by Redis (or in-memory fallback)."""

    def __init__(
        self,
        redis_client: Any = None,
        *,
        limit_5m: Optional[int] = None,
        limit_daily: Optional[int] = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._redis = redis_client
        self.limit_5m = int(limit_5m if limit_5m is not None else os.environ.get("SMARTJUDGE_CAP_5M", DEFAULT_CAP_5M))
        self.limit_daily = int(
            limit_daily if limit_daily is not None else os.environ.get("SMARTJUDGE_CAP_DAILY", DEFAULT_CAP_DAILY)
        )
        self._clock = clock
        self._mem: dict[str, tuple[int, float]] = {}

    def _incr_with_ttl(self, key: str, ttl_s: int) -> tuple[int, int]:
        if self._redis is not None:
            count = int(self._redis.incr(key))
            if count == 1:
                self._redis.expire(key, ttl_s)
            rem = self._redis.ttl(key)
            retry = int(rem) if isinstance(rem, int) and rem > 0 else ttl_s
            return count, retry
        now = self._clock()
        cur_count, expires_at = self._mem.get(key, (0, 0.0))
        if now >= expires_at:
            cur_count = 0
            expires_at = now + ttl_s
        cur_count += 1
        self._mem[key] = (cur_count, expires_at)
        return cur_count, max(1, int(expires_at - now))

    def check_and_increment(self, user_key: str) -> RateLimitResult:
        """Check and increment both 5-minute and daily caps for ``user_key``."""
        uid = (user_key or "anonymous").strip()
        k5 = f"smartjudge:cap:5m:{uid}"
        kd = f"smartjudge:cap:day:{uid}"

        c5, ttl5 = self._incr_with_ttl(k5, WINDOW_5M_SECONDS)
        if c5 > self.limit_5m:
            return RateLimitResult(
                allowed=False,
                status_code=429,
                retry_after_s=ttl5,
                message_fa=RATE_LIMIT_MESSAGE_5M_FA,
                scope="5m",
            )

        cd, ttld = self._incr_with_ttl(kd, WINDOW_DAILY_SECONDS)
        if cd > self.limit_daily:
            return RateLimitResult(
                allowed=False,
                status_code=429,
                retry_after_s=ttld,
                message_fa=RATE_LIMIT_MESSAGE_DAILY_FA,
                scope="daily",
            )

        return RateLimitResult(allowed=True, status_code=200)
