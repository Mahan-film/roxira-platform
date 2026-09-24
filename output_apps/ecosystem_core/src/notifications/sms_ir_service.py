"""
ROXIRA SMS OTP ENGINE — sms.ir Fast (Verify) Web Service
سرویس اختصاصی ارسال کد تأیید یک‌بارمصرف (OTP) از طریق وب‌سرویس sms.ir

Endpoint:
    POST https://api.sms.ir/v1/send/verify

Headers:
    Content-Type: application/json
    x-api-key:   مقدار از متغیر محیطی SMS_IR_API_KEY (پیش‌فرض: کلید پنل روکسیرا)

Payload:
    {
      "mobile":      "<RECIPIENT_MOBILE>",
      "templateId":  <TEMPLATE_ID_INT>,
      "parameters":  [ {"name": "CODE", "value": "<OTP_CODE_STRING>"} ]
    }

تنظیمات محیطی:
    SMS_IR_API_KEY        (اختیاری — پیش‌فرض داخلی دارد)
    SMS_IR_TEMPLATE_ID    (الزامی برای ارسال واقعی — شماره قالب تأیید)

این ماژول جایگزین رسمی سرویس‌های قدیمی پیامک (KavehNegar/FarazSMS/Pattern API)
است و خطاهای HTTP/API را به‌صورت ساختارمند لاگ و طبقه‌بندی می‌کند.
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
SMS_IR_API_URL = os.getenv("SMS_IR_API_URL", "https://api.sms.ir/v1/send/verify")
SMS_IR_API_KEY_ENV = "SMS_IR_API_KEY"
SMS_IR_TEMPLATE_ID_ENV = "SMS_IR_TEMPLATE_ID"

DEFAULT_TIMEOUT_SECONDS = 10.0

logger = logging.getLogger("roxira.sms_ir")


# --------------------------------------------------------------------------- #
# خطاهای ساختارمند
# --------------------------------------------------------------------------- #
class SmsIrError(Exception):
    """خطای پایه یکپارچه سرویس sms.ir."""


class SmsIrConfigurationError(SmsIrError):
    """تنظیمات ناقص (مثلاً نبودن templateId)."""


class SmsIrRequestError(SmsIrError):
    """خطای سمت کلاینت (شماره نامعتبر، ۴xx و ...)."""


class SmsIrAuthenticationError(SmsIrRequestError):
    """کلید API ردشده (۴۰۱/۴۰۳)."""


class SmsIrProviderError(SmsIrError):
    """خطای سمت سروی‌س‌فراهم (۵xx)."""


# --------------------------------------------------------------------------- #
# سرویس ارسال کد تأیید
# --------------------------------------------------------------------------- #
class SmsIrService:
    """کلاینت رسمی وب‌سرویس Fast/Verify سرویس sms.ir."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        template_id: Optional[int] = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        base_url: str = SMS_IR_API_URL,
    ) -> None:
        # مقداردهی کلید: پارامتر > متغیر محیطی (بدون مقدار پیش‌فرض)
        self.api_key = api_key or os.getenv(SMS_IR_API_KEY_ENV)
        if not self.api_key:
            raise RuntimeError(f"{SMS_IR_API_KEY_ENV} environment variable is not set")
        self.base_url = base_url
        self.timeout = timeout

        # مقداردهی templateId: پارامتر > متغیر محیطی
        self._template_id: Optional[int] = template_id
        if self._template_id is None:
            raw = os.getenv(SMS_IR_TEMPLATE_ID_ENV)
            if raw:
                self._template_id = int(str(raw).strip())

    # ── ابزار کمکی ─────────────────────────────────────────────────────────
    @staticmethod
    def _normalize_mobile(mobile: str) -> str:
        """عادی‌سازی شماره موبایل ایران به فرمت 09xxxxxxxxx (الزامی برای sms.ir)."""
        clean = re.sub(r"[^\d]", "", mobile or "")
        if clean.startswith("0098") and len(clean) == 14:
            clean = "0" + clean[4:]
        elif clean.startswith("98") and len(clean) == 12:   # 98912xxxxxxx
            clean = "0" + clean[2:]
        return clean

    def _validate_iran_mobile(self, mobile: str) -> str:
        cleaned = self._normalize_mobile(mobile)
        if not (len(cleaned) == 11 and cleaned.startswith("09")):
            raise SmsIrRequestError(f"شماره همراه نامعتبر است: {mobile!r}")
        return cleaned

    @staticmethod
    def _classify_status(resp: httpx.Response) -> str:
        """نقشه‌بندی کدهای وضعیت HTTP به برچسب خوانا برای لاگ."""

        if resp.status_code in (200, 201, 202):
            return "SUCCESS"
        if resp.status_code in (400, 404, 422):
            return "INVALID_REQUEST"
        if resp.status_code in (401, 403):
            return "AUTH_FAILED"
        if resp.status_code in (429,):
            return "RATE_LIMITED"
        if resp.status_code >= 500:
            return "PROVIDER_ERROR"
        return f"UNEXPECTED_{resp.status_code}"
# ── ارسال کد تأیید ─────────────────────────────────────────────────────
    def send_verify_code(
        self,
        mobile: str,
        code: str,
        template_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        ارسال کد تأیید (OTP) از طریق قالب Fast سرویس sms.ir.

        - mobile:      شماره موبایل گیرنده (فرمت‌های 09... / +989... / 989... پذیرفته)
        - code:        کد تأیید رقمی به‌صورت رشته
        - template_id: (اختیاری) شناسه قالب تأیید؛ در نبودن آن از SMS_IR_TEMPLATE_ID خوانده می‌شود

        بازگشت: dict شامل وضعیت، شناسه پیامک و پاسخ سروی‌س‌فراهم.
        خطا: SmsIrConfigurationError / SmsIrRequestError / SmsIrProviderError
        """
        tpl = template_id if template_id is not None else self._template_id
        if tpl is None:
            raise SmsIrConfigurationError(
                "شماره قالب تأیید (SMS_IR_TEMPLATE_ID) تنظیم نشده است؛ "
                "برای ارسال واقعی پیامک آن را در متغیر محیطی‌ها قرار دهید."
            )

        cleaned_mobile = self._validate_iran_mobile(mobile)

        payload: Dict[str, Any] = {
            "mobile": cleaned_mobile,
            "templateId": int(tpl),
            "parameters": [{"name": "CODE", "value": str(code)}],
        }
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
        }

        logger.info(
            "[SMS-IR] Sending verify OTP | mobile=%s templateId=%s",
            cleaned_mobile,
            tpl,
        )

        try:
            resp = httpx.post(
                self.base_url,
                json=payload,
                headers=headers,
                timeout=self.timeout,
            )
        except httpx.HTTPError as exc:   # قطع ارتباط، timeout و ...
            logger.error(
                "[SMS-IR] Network error sending OTP to %s: %s", cleaned_mobile, exc
            )
            raise SmsIrProviderError(f"قطع ارتباط با وب‌سرویس sms.ir: {exc}") from exc

        status_label = self._classify_status(resp)

        # پارسه امن بدنه پاسخ (ممکن است JSON نباشد)
        try:
            body: Any = resp.json()
        except Exception:
            body = resp.text[:500]

        if resp.status_code in (200, 201, 202):
            logger.info(
                "[SMS-IR] Verify OTP dispatched | mobile=%s http=%s body=%s",
                cleaned_mobile,
                resp.status_code,
                self._truncate(str(body)),
            )
            return {
                "delivered": True,
                "mobile": cleaned_mobile,
                "http_status": resp.status_code,
                "status_label": status_label,
                "provider_response": body,
            }

        # ── مدیریت ساختارمند خطاها ────────────────────────────────────────
        if status_label == "AUTH_FAILED":
            logger.warning(
                "[SMS-IR] API key rejected | http=%s body=%s",
                resp.status_code,
                self._truncate(str(body)),
            )
            raise SmsIrAuthenticationError(
                f"کلید sms.ir رد شد (HTTP {resp.status_code}): {self._truncate(str(body))}"
            )
        if status_label in ("INVALID_REQUEST", "RATE_LIMITED", "UNEXPECTED"):
            logger.warning(
                "[SMS-IR] Request rejected | http=%s label=%s body=%s",
                resp.status_code,
                status_label,
                self._truncate(str(body)),
            )
            raise SmsIrRequestError(
                f"درخواست sms.ir رد شد (HTTP {resp.status_code} - {status_label}): "
                f"{self._truncate(str(body))}"
            )
        # 5xx و بقیه — خطای سمت سروی‌س‌فراهم
        logger.error(
            "[SMS-IR] Provider-side error | http=%s body=%s",
            resp.status_code,
            self._truncate(str(body)),
        )
        raise SmsIrProviderError(
            f"خطای سروی‌س‌فراهم sms.ir (HTTP {resp.status_code}): {self._truncate(str(body))}"
        )

    @staticmethod
    def _truncate(text: str, limit: int = 500) -> str:
        text = text or ""
        return text if len(text) <= limit else text[:limit] + "...[truncated]"


# --------------------------------------------------------------------------- #
# سازگاری با مسیر قدیمی جهت انتقال تدریجی مصرف‌کنندگان فعلی
# --------------------------------------------------------------------------- #
def build_sms_ir_dispatcher() -> SmsIrService:
    """تابع ساخت سریع نمونه سرویس sms.ir برای مصرف‌کنندگان فعلی."""
    return SmsIrService()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    svc = SmsIrService()
    print("SmsIrService ready | api_key=%s | template_id=%s" % (
        "set",
        svc._template_id or "NOT_SET",
    ))