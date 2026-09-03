"""
ROXIRA UNIFIED MULTI-CHANNEL AUTHENTICATION SERVICE
احراز هویت جامع: نام کاربری/رمز عبور، ایمیل و شماره همراه (OTP)
"""
import time
import random
import hashlib
from typing import Dict, Any, Optional

class UnifiedAuthService:
    def __init__(self):
        # نگهداری نشست‌ها و کدهای OTP فعال در حافظه (در پروداکشن در Redis نگهداری می‌شود)
        self.otp_store: Dict[str, Dict[str, Any]] = {}
        self.users_db: Dict[str, Dict[str, Any]] = {
            "admin": {"password_hash": hashlib.sha256("admin123".encode()).hexdigest(), "email": "admin@roxira.net", "phone": "09129367796"}
        }

    def generate_sms_otp(self, phone_number: str) -> Dict[str, Any]:
        """تولید کد ۵ رقمی پیامکی با انقضای ۲ دقیقه‌ای"""
        cleaned_phone = phone_number.strip().replace("+98", "0")
        code = f"{random.randint(10000, 99999)}"
        self.otp_store[cleaned_phone] = {
            "code": code,
            "expires_at": time.time() + 120
        }
        return {
            "status": "OTP_DISPATCHED",
            "recipient": cleaned_phone,
            "expires_in_seconds": 120,
            "mock_code": code  # در حالت پروداکشن کد به کاربر برگردانده نمی‌شود و پیامک می‌گردد
        }

    def verify_sms_otp(self, phone_number: str, code: str) -> Dict[str, Any]:
        cleaned_phone = phone_number.strip().replace("+98", "0")
        entry = self.otp_store.get(cleaned_phone)
        if not entry:
            return {"authenticated": False, "error": "کد تاییدی برای این شماره ثبت نشده است."}
        
        if time.time() > entry["expires_at"]:
            return {"authenticated": False, "error": "کد تایید منقضی شده است."}
            
        if entry["code"] != code.strip():
            return {"authenticated": False, "error": "کد تایید واردشده صحیح نمی‌باشد."}

        token = hashlib.sha256(f"{cleaned_phone}-{time.time()}".encode()).hexdigest()[:32]
        return {
            "authenticated": True,
            "user_identifier": cleaned_phone,
            "auth_channel": "SMS_OTP",
            "session_token": f"ROX-SESS-{token}"
        }

    def login_with_password(self, username: str, password_raw: str) -> Dict[str, Any]:
        user = self.users_db.get(username)
        if not user:
            return {"authenticated": False, "error": "کاربر یافت نشد."}
            
        hashed_input = hashlib.sha256(password_raw.encode()).hexdigest()
        if user["password_hash"] != hashed_input:
            return {"authenticated": False, "error": "رمز عبور نادرست است."}

        token = hashlib.sha256(f"{username}-{time.time()}".encode()).hexdigest()[:32]
        return {
            "authenticated": True,
            "user_identifier": username,
            "auth_channel": "PASSWORD",
            "session_token": f"ROX-SESS-{token}"
        }

if __name__ == "__main__":
    auth = UnifiedAuthService()
    otp_res = auth.generate_sms_otp("09129367796")
    verify_res = auth.verify_sms_otp("09129367796", otp_res["mock_code"])
    pwd_res = auth.login_with_password("admin", "admin123")
    print("=== تست احراز هویت چندگانه ===")
    print("تایید لاگین با پیامک OTP:", verify_res["authenticated"])
    print("تایید لاگین با نام کاربری/رمز:", pwd_res["authenticated"])
