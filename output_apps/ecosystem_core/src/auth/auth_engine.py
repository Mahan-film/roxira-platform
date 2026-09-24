from __future__ import annotations

import hmac
import hashlib
import base64
import json
import os
import time
import pathlib
import sys
import psycopg
from typing import Dict, Any, Optional
from src.roxira_config import postgres_dsn

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)
JWT_SECRET = os.environ.get("JWT_SECRET", "")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET environment variable is not set; refusing to sign tokens with a default secret")

def init_auth_schema():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS system_users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(64) UNIQUE NOT NULL,
                    password_hash VARCHAR(128) NOT NULL,
                    full_name VARCHAR(128) NOT NULL,
                    role VARCHAR(32) NOT NULL, -- ADMIN, CHIEF_ACCOUNTANT, LEGAL_COUNSEL, AUDITOR
                    tenant_id VARCHAR(64) NOT NULL,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            """)
            conn.commit()
    print("✅ AUTH_SCHEMA_INITIALIZED=PASS")

class SecurityAuthEngine:
    @staticmethod
    def _hash_password(password: str) -> str:
        return hashlib.sha256(password.encode("utf-8")).hexdigest()

    @classmethod
    def register_user(cls, username: str, password: str, full_name: str, role: str, tenant_id: str) -> Dict[str, Any]:
        pwd_hash = cls._hash_password(password)
        with psycopg.connect(DB_URL) as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO system_users (username, password_hash, full_name, role, tenant_id)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (username) DO UPDATE
                    SET password_hash = EXCLUDED.password_hash,
                        role = EXCLUDED.role;
                """, (username, pwd_hash, full_name, role, tenant_id))
                conn.commit()
        return {"status": "USER_REGISTERED", "username": username, "role": role, "tenant_id": tenant_id}

    @classmethod
    def authenticate_and_generate_token(cls, username: str, password: str) -> Dict[str, Any]:
        pwd_hash = cls._hash_password(password)
        with psycopg.connect(DB_URL) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id, full_name, role, tenant_id, is_active FROM system_users WHERE username = %s AND password_hash = %s;", (username, pwd_hash))
                row = cur.fetchone()
                if not row:
                    raise ValueError("نام کاربری یا رمز عبور نامعتبر است.")
                if not row[4]:
                    raise PermissionError("حساب کاربری غیرفعال است.")

        payload = {
            "sub": str(row[0]),
            "username": username,
            "name": row[1],
            "role": row[2],
            "tenant_id": row[3],
            "exp": int(time.time()) + 86400 # اعتبار ۲۴ ساعته
        }

        # ساخت توکن JWT استاندارد (Header.Payload.Signature)
        header_b64 = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).decode().rstrip("=")
        payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
        sig_raw = hmac.new(JWT_SECRET.encode(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256).digest()
        sig_b64 = base64.urlsafe_b64encode(sig_raw).decode().rstrip("=")

        token = f"{header_b64}.{payload_b64}.{sig_b64}"
        return {
            "access_token": token,
            "token_type": "bearer",
            "user_info": payload
        }

    @staticmethod
    def verify_token(token: str) -> Dict[str, Any]:
        try:
            parts = token.strip().split(".")
            if len(parts) != 3:
                raise ValueError("فرمت توکن نامعتبر است.")
            h_b64, p_b64, sig_b64 = parts
            
            # بازسازی امضا و اعتبارسنجی
            expected_sig = hmac.new(JWT_SECRET.encode(), f"{h_b64}.{p_b64}".encode(), hashlib.sha256).digest()
            calc_sig_b64 = base64.urlsafe_b64encode(expected_sig).decode().rstrip("=")
            if not hmac.compare_digest(sig_b64, calc_sig_b64):
                raise PermissionError("امضای دیجیتال توکن نامعتبر است.")
            
            # افزودن پدینگ برای بازگشایی بیس۶۴
            rem = len(p_b64) % 4
            if rem > 0:
                p_b64 += "=" * (4 - rem)
            payload = json.loads(base64.urlsafe_b64decode(p_b64).decode())
            if payload.get("exp", 0) < time.time():
                raise TimeoutError("توکن منقضی شده است.")
            return payload
        except Exception as e:
            raise PermissionError(f"اعتبارسنجی توکن با شکست مواجه شد: {str(e)}")

if __name__ == "__main__":
    init_auth_schema()
    auth = SecurityAuthEngine()
    auth.register_user("admin_mobin", "SecurePass2026!", "مبین خرمی", "ADMIN", "store_auto_parts")
    login_res = auth.authenticate_and_generate_token("admin_mobin", "SecurePass2026!")
    verified = auth.verify_token(login_res["access_token"])
    print("✅ AUTH_ENGINE_VERIFIED=PASS")
    print(f"Token Issued for: {verified['name']} (Role: {verified['role']})")
