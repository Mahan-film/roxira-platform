"""
ROXIRA UNIFIED MULTI-CHANNEL AUTHENTICATION SERVICE
احراز هویت جامع: نام کاربری/رمز عبور، ایمیل و شماره همراه (OTP)

OTP rules (issue #366): 6-digit codes from ``secrets``, stored only as an HMAC digest,
compared in constant time, single use, at most 5 wrong guesses per code, and send limits
per phone and per source IP. Every failure returns the same generic error.
"""
import hashlib
import hmac
import secrets
import threading
import time
from typing import Any, Callable, Dict, Optional, Tuple

OTP_DIGITS = 6
OTP_TTL_SECONDS = 120
OTP_MAX_FAILED_ATTEMPTS = 5
OTP_SENDS_PER_PHONE = 3
OTP_PHONE_WINDOW_SECONDS = 600
OTP_SENDS_PER_IP = 10
OTP_IP_WINDOW_SECONDS = 3600

OTP_GENERIC_ERROR = "کد تأیید نامعتبر است یا امکان انجام درخواست وجود ندارد؛ بعداً دوباره تلاش کنید."


class InMemoryOtpStore:
    """TTL key/value store with atomic counters. Injectable; tests pass a fake clock."""

    def __init__(self, clock: Callable[[], float] = time.time):
        self._clock = clock
        self._lock = threading.Lock()
        self._data: Dict[str, Tuple[Any, float]] = {}

    def _live(self, key: str) -> Optional[Tuple[Any, float]]:
        item = self._data.get(key)
        if item is not None and self._clock() >= item[1]:
            del self._data[key]
            return None
        return item

    def get(self, key: str) -> Any:
        with self._lock:
            item = self._live(key)
            return item[0] if item else None

    def set(self, key: str, value: Any, ttl_s: float) -> None:
        with self._lock:
            self._data[key] = (value, self._clock() + ttl_s)

    def delete(self, *keys: str) -> None:
        with self._lock:
            for key in keys:
                self._data.pop(key, None)

    def incr(self, key: str, window_s: float) -> int:
        """Count one event in a fixed window that starts at the first event."""
        with self._lock:
            item = self._live(key)
            if item is None:
                self._data[key] = (1, self._clock() + window_s)
                return 1
            count = int(item[0]) + 1
            self._data[key] = (count, item[1])
            return count


class UnifiedAuthService:
    def __init__(self, store: Optional[InMemoryOtpStore] = None,
                 digest_key: Optional[bytes] = None):
        # کدهای OTP فقط به‌صورت HMAC و با انقضا نگهداری می‌شوند
        self.otp_store = store if store is not None else InMemoryOtpStore()
        self._digest_key = digest_key if digest_key is not None else secrets.token_bytes(32)

    @staticmethod
    def _clean_phone(phone_number: str) -> str:
        return phone_number.strip().replace("+98", "0")

    def _digest(self, phone: str, code: str) -> str:
        return hmac.new(self._digest_key, f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()

    @staticmethod
    def _new_code() -> str:
        return f"{secrets.randbelow(10 ** OTP_DIGITS):0{OTP_DIGITS}d}"

    def _deliver(self, phone: str, code: str) -> None:
        """SMS delivery hook. This service has no SMS gateway; callers override it."""

    def generate_sms_otp(self, phone_number: str, source_ip: Optional[str] = None) -> Dict[str, Any]:
        """تولید کد ۶ رقمی پیامکی با انقضای ۲ دقیقه‌ای (کد هرگز در پاسخ یا لاگ نمی‌آید)."""
        cleaned_phone = self._clean_phone(phone_number)
        store = self.otp_store
        phone_sends = store.incr(f"otp:send:phone:{cleaned_phone}", OTP_PHONE_WINDOW_SECONDS)
        ip_sends = store.incr(f"otp:send:ip:{source_ip}", OTP_IP_WINDOW_SECONDS) if source_ip else 0
        if phone_sends > OTP_SENDS_PER_PHONE or ip_sends > OTP_SENDS_PER_IP:
            return {"status": "OTP_REJECTED", "error": OTP_GENERIC_ERROR}

        code = self._new_code()
        store.delete(f"otp:att:{cleaned_phone}")
        store.set(f"otp:code:{cleaned_phone}", self._digest(cleaned_phone, code), OTP_TTL_SECONDS)
        self._deliver(cleaned_phone, code)
        return {
            "status": "OTP_DISPATCHED",
            "recipient": cleaned_phone,
            "expires_in_seconds": OTP_TTL_SECONDS,
        }

    def verify_sms_otp(self, phone_number: str, code: str) -> Dict[str, Any]:
        cleaned_phone = self._clean_phone(phone_number)
        code_key = f"otp:code:{cleaned_phone}"
        attempts_key = f"otp:att:{cleaned_phone}"
        expected = self.otp_store.get(code_key)
        if not expected:
            return {"authenticated": False, "error": OTP_GENERIC_ERROR}

        supplied = self._digest(cleaned_phone, str(code or "").strip())
        if not hmac.compare_digest(expected, supplied):
            if self.otp_store.incr(attempts_key, OTP_TTL_SECONDS) >= OTP_MAX_FAILED_ATTEMPTS:
                self.otp_store.delete(code_key, attempts_key)
            return {"authenticated": False, "error": OTP_GENERIC_ERROR}

        # single use: the code is burnt on success
        self.otp_store.delete(code_key, attempts_key)
        token = secrets.token_hex(16)
        return {
            "authenticated": True,
            "user_identifier": cleaned_phone,
            "auth_channel": "SMS_OTP",
            "session_token": f"ROX-SESS-{token}"
        }

if __name__ == "__main__":
    auth = UnifiedAuthService()
    otp_res = auth.generate_sms_otp("09129367796")
    print("=== تست احراز هویت چندگانه ===")
    print("ارسال OTP:", otp_res["status"])
