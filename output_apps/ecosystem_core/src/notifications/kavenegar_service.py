"""
ROXIRA SMS OTP ENGINE — Kavenegar Verify/Lookup Web Service
سرویس اختصاصی ارسال کد تأیید یک‌بارمصرف (OTP) از طریق وب‌سرویس کاوه‌نگار

Endpoint (Verify Lookup):
    GET/POST https://api.kavenegar.com/v1/{API_KEY}/verify/lookup.json
             ?receptor=<MOBILE_NUMBER>&token=<6_DIGIT_OTP>&template=<TEMPLATE_NAME>

قالب‌های تأیید (Verify Templates) — مسیریابی بر اساس سرویس/دامنه:
    service == "ghazi"  یا host شامل ghazihoushmand.ir    ->  template="ghazi-verify"
    service == "roxira" یا host شامل roxira.ir | roxira.net -> template="roxira-verify"

پاسخ موفق نمونه:
    {"return": {"status": 200, "message": "تایید شد"}, "entries": [{"messageid": ...}]}
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, Optional

import httpx

# --------------------------------------------------------------------------- #
# پیکربندی
# --------------------------------------------------------------------------- #
KAVENEGAR_API_URL_BASE = os.getenv(
    "KAVENEGAR_API_URL_BASE", "https://api.kavenegar.com/v1"
)

# کلید پیش‌فرض مستندشده پنل کاوه‌نگار سامانه — در پروداکشن از متغیر محیطی
# KAVENEGAR_API_KEY برای چرخش کلید استفاده کنید.
KAVENEGAR_DEFAULT_API_KEY = (
    "REDACTED_SECRET_01"
)
KAVENEGAR_API_KEY_ENV = "KAVENEGAR_API_KEY"

# قالب‌های تأیید اختصاصی هر سرویس
GHAZI_VERIFY_TEMPLATE = os.getenv("KAVENEGAR_TEMPLATE_GHAZI", "ghazi-verify")
ROXIRA_VERIFY_TEMPLATE = os.getenv("KAVENEGAR_TEMPLATE_ROXIRA", "roxira-verify")

DEFAULT_TIMEOUT_SECONDS = 10.0

logger = logging.getLogger("roxira.kavenegar")


# --------------------------------------------------------------------------- #
# خطاهای ساختارمند
# --------------------------------------------------------------------------- #
class KavenegarError(Exception):
    """خطای پایه یکپارچه سرویس کاوه‌نگار."""


class KavenegarConfigurationError(KavenegarError):
    """تنظیمات ناقص (مثلاً نبودن API Key)."""


class KavenegarRequestError(KavenegarError):
    """خطای سمت کلاینت (شماره نامعتبر، قالب ناموجود، ۴xx و ...)."""


class KavenegarAuthenticationError(KavenegarRequestError):
    """کلید API ردشده (۴۰۱/۴۰۳ یا کد ۴۰۱/۴۱۰ کاوه‌نگار)."""


class KavenegarProviderError(KavenegarError):
    """خطای سمت سروی‌س‌فراهم (۵xx / قطع ارتباط)."""


# --------------------------------------------------------------------------- #
# مسیریابی قالب بر اساس سرویس / دامنه
# --------------------------------------------------------------------------- #
def resolve_template(service: Optional[str] = None, host: Optional[str] = None) -> str:
    """
    انتخاب قالب کاوه‌نگار بر اساس نام سرویس یا دامنه میزبان:
      - ghazi  / ghazihoushmand.ir          -> ghazi-verify
      - roxira / roxira.ir | roxira.net     -> roxira-verify
    حالت پیش‌فرض (نامشخص): roxira-verify
    """
    svc = (service or "").strip().lower()
    if svc in ("ghazi", "ghazihoushmand", "smartjudge"):
        return GHAZI_VERIFY_TEMPLATE
    if svc in ("roxira", "roxira-net", "enterprise"):
        return ROXIRA_VERIFY_TEMPLATE


# --------------------------------------------------------------------------- #
# سرویس ارسال کد تأیید (Verify Lookup)
# --------------------------------------------------------------------------- #
class KavenegarService:
    """کلاینت رسمی وب‌سرویس Verify/Lookup کاوه‌نگار."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        base_url: str = KAVENEGAR_API_URL_BASE,
    ) -> None:
        # مقداردهی کلید: پارامتر > متغیر محیطی > پیش‌فرض مستندشده
        self.api_key = (
            api_key or os.getenv(KAVENEGAR_API_KEY_ENV) or KAVENEGAR_DEFAULT_API_KEY
        ).strip()
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    # ── ابزار کمکی ─────────────────────────────────────────────────────────
    @staticmethod
    def _normalize_receptor(receptor: str) -> str:
        """عادی‌سازی شماره موبایل ایران به فرمت 09xxxxxxxxx (قابل قبول کاوه‌نگار)."""
        clean = re.sub(r"[^\d+]", "", receptor or "")
        if clean.startswith("+98"):
            clean = "0" + clean[3:]
        elif clean.startswith("0098"):
            clean = "0" + clean[4:]
        elif clean.startswith("98") and len(clean) >= 11:
            clean = "0" + clean[2:]
        return clean

    @property
    def lookup_url(self) -> str:
        return f"{self.base_url}/{self.api_key}/verify/lookup.json"

    @staticmethod
    def _truncate(text: str, limit: int = 500) -> str:
        text = text or ""
        return text if len(text) <= limit else text[:limit] + "...[truncated]"

    # ── ارسال OTP با قالب Lookup ──────────────────────────────────────────
    def send_verify_lookup(
        self,
        receptor: str,
        token: str,
        template: str,
        token2: Optional[str] = None,
        token3: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        ارسال کد تأیید از طریق Verify Lookup کاوه‌نگار.

        خروجی موفق:
            {"delivered": True, "receptor": ..., "template": ..., "http_status": ...}
        خروجی ناموفق: raise KavenegarError (زیرکلاس متناسب)
        """
        cleaned_receptor = self._normalize_receptor(receptor)
        if not (len(cleaned_receptor) == 11 and cleaned_receptor.startswith("09")):
            raise KavenegarRequestError(f"شماره همراه نامعتبر است: {receptor!r}")
        if not template:
            raise KavenegarConfigurationError("نام قالب (template) تعیین نشده است.")
        if not self.api_key:
            raise KavenegarConfigurationError(
                "کلید API کاوه‌نگار تنظیم نشده است (KAVENEGAR_API_KEY)."
            )

        params: Dict[str, str] = {
            "receptor": cleaned_receptor,
            "token": str(token),
            "template": template,
        }
        if token2:
            params["token2"] = str(token2)
        if token3:
            params["token3"] = str(token3)

        logger.info(
            "[KAVENEGAR] Dispatching Verify Lookup | receptor=%s template=%s",
            cleaned_receptor,
            template,
        )

        try:
            resp = httpx.post(
                self.lookup_url,
                params=params,
                headers={"Accept": "application/json"},
                timeout=self.timeout,
            )
        except httpx.HTTPError as exc:  # قطع ارتباط، timeout و ...
            logger.error(
                "[KAVENEGAR] Network error sending OTP to %s: %s", cleaned_receptor, exc
            )
            raise KavenegarProviderError(
                f"قطع ارتباط با وب‌سرویس کاوه‌نگار: {exc}"
            ) from exc

        # پارسه امن بدنه پاسخ (ممکن است JSON نباشد)
        try:
            body: Any = resp.json()
        except Exception:
            body = resp.text[:500]

        return_status: Optional[int] = None
        return_message = ""
        if isinstance(body, dict):
            ret = body.get("return") or {}
            if isinstance(ret, dict):
                return_status = ret.get("status")
                return_message = str(ret.get("message", ""))

        if resp.status_code == 200 and return_status == 200:
            logger.info(
                "[KAVENEGAR] Verify Lookup dispatched | receptor=%s template=%s body=%s",
                cleaned_receptor,
                template,
                self._truncate(str(body)),
            )
            return {
                "delivered": True,
                "receptor": cleaned_receptor,
                "template": template,
                "http_status": resp.status_code,
                "return_status": return_status,
                "provider_response": body,
            }

        # ── مدیریت ساختارمند خطاها ────────────────────────────────────────
        if resp.status_code in (401, 403) or return_status in (401, 410, 411):
            logger.warning(
                "[KAVENEGAR] API key rejected | http=%s return=%s body=%s",
                resp.status_code,
                return_status,
                self._truncate(str(body)),
            )
            raise KavenegarAuthenticationError(
                f"کلید کاوه‌نگار رد شد (HTTP {resp.status_code} / return {return_status}): "
                f"{return_message or self._truncate(str(body))}"
            )
        if resp.status_code < 500:
            logger.warning(
                "[KAVENEGAR] Request rejected | http=%s return=%s body=%s",
                resp.status_code,
                return_status,
                self._truncate(str(body)),
            )
            raise KavenegarRequestError(
                f"درخواست کاوه‌نگار رد شد (HTTP {resp.status_code} / return {return_status}): "
                f"{return_message or self._truncate(str(body))}"
            )

        logger.error(
            "[KAVENEGAR] Provider-side error | http=%s body=%s",
            resp.status_code,
            self._truncate(str(body)),
        )
        raise KavenegarProviderError(
            f"خطای سروی‌س‌فراهم کاوه‌نگار (HTTP {resp.status_code}): {self._truncate(str(body))}"
        )


# --------------------------------------------------------------------------- #
# سازگاری با مصرف‌کنندگان فعلی
# --------------------------------------------------------------------------- #
def build_kavenegar_dispatcher() -> KavenegarService:
    """تابع ساخت سریع نمونه سرویس کاوه‌نگار برای مصرف‌کنندگان فعلی."""
    return KavenegarService()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    svc = KavenegarService()
    print("KavenegarService ready | lookup_url=%s" % svc.lookup_url)
    print("template(ghazi)  ->", resolve_template("ghazi"))
    print("template(roxira) ->", resolve_template("roxira"))
    print("template(host=www.ghazihoushmand.ir) ->", resolve_template(host="www.ghazihoushmand.ir"))
    print("template(host=roxira.ir)             ->", resolve_template(host="roxira.ir"))
