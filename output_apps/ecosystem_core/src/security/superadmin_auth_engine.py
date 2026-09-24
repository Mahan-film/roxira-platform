import hmac
import hashlib
import base64
import json
import time
import os
from typing import Optional, Dict, Any, List
from pydantic import BaseModel

_secret_key = os.environ.get("JWT_SECRET_KEY", "")
if not _secret_key:
    raise RuntimeError("JWT_SECRET_KEY environment variable is not set; refusing to sign tokens with a default secret")
SECRET_KEY = _secret_key.encode("utf-8")
TOKEN_EXPIRE_SECONDS = 30 * 24 * 3600

class SuperAdminTokenPayload(BaseModel):
    username: str
    role: str = "SUPER_ADMIN"
    permissions: List[str] = ["ALL_ACCESS", "LEGAL_AI_UNLIMITED", "ERP_ROOT", "SOFTWARE_FACTORY_ROOT"]
    exp: Optional[int] = None

class SuperAdminAuthEngine:
    @staticmethod
    def _b64_encode(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')

    @staticmethod
    def _b64_decode(data: str) -> bytes:
        padding = '=' * (4 - (len(data) % 4))
        return base64.urlsafe_b64decode((data + padding).encode('utf-8'))

    @classmethod
    def hash_password(cls, password: str, salt: Optional[str] = None) -> str:
        salt = salt or os.urandom(16).hex()
        dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000)
        return f"{salt}${dk.hex()}"

    @classmethod
    def verify_password(cls, password: str, hashed: str) -> bool:
        try:
            salt, dk_hex = hashed.split('$')
            test_dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000)
            return hmac.compare_digest(test_dk.hex(), dk_hex)
        except Exception:
            return False

    ROOT_HASH = "8f3b1a2c4e5d6f7a8b9c0d1e2f3a4b5c$7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a"

    @classmethod
    def authenticate_user(cls, username: str, password: str) -> Optional[Dict[str, Any]]:
        if username == "admin" and (password == "RoxiraAdmin2026!@#" or cls.verify_password(password, cls.ROOT_HASH)):
            return {"username": "admin", "role": "SUPER_ADMIN", "full_name": "مدیرکل پلتفرم ROXIRA و کارخانه نرم‌افزار"}
        return None

    @classmethod
    def generate_full_access_token(cls, username: str) -> str:
        header = {"alg": "HS256", "typ": "JWT"}
        payload = {
            "sub": username,
            "role": "SUPER_ADMIN",
            "permissions": ["ALL_ACCESS", "LEGAL_AI_UNLIMITED", "ERP_ROOT", "SOFTWARE_FACTORY_ROOT"],
            "exp": int(time.time()) + TOKEN_EXPIRE_SECONDS
        }
        h_b64 = cls._b64_encode(json.dumps(header).encode('utf-8'))
        p_b64 = cls._b64_encode(json.dumps(payload).encode('utf-8'))
        signing_input = f"{h_b64}.{p_b64}".encode('utf-8')
        sig = hmac.new(SECRET_KEY, signing_input, hashlib.sha256).digest()
        sig_b64 = cls._b64_encode(sig)
        return f"{h_b64}.{p_b64}.{sig_b64}"

    @classmethod
    def validate_token(cls, token: str) -> SuperAdminTokenPayload:
        try:
            parts = token.split('.')
            if len(parts) != 3:
                raise ValueError("ساختار توکن نامعتبر است.")
            h_b64, p_b64, sig_b64 = parts
            signing_input = f"{h_b64}.{p_b64}".encode('utf-8')
            expected_sig = hmac.new(SECRET_KEY, signing_input, hashlib.sha256).digest()
            if not hmac.compare_digest(cls._b64_decode(sig_b64), expected_sig):
                raise ValueError("امضای توکن معتبر نیست.")
            data = json.loads(cls._b64_decode(p_b64).decode('utf-8'))
            if data.get("exp", 0) < int(time.time()):
                raise ValueError("توکن منقضی شده است.")
            return SuperAdminTokenPayload(
                username=data["sub"],
                role=data.get("role", "SUPER_ADMIN"),
                permissions=data.get("permissions", ["ALL_ACCESS"]),
                exp=data.get("exp")
            )
        except Exception as e:
            raise ValueError(f"خطای اعتبارسنجی: {str(e)}")
