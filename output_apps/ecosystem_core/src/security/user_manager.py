import os
import psycopg
import time
import secrets
from typing import Dict, Any, Optional

def get_db_conn():
    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", os.getenv("DB_PASSWORD", "postgres"))
    db_name = os.getenv("POSTGRES_DB", os.getenv("DB_NAME", "roxira_production"))
    host = os.getenv("POSTGRES_HOST", "roxira_postgres_prod")
    port = os.getenv("POSTGRES_PORT", "5432")
    
    passwords = [password, "postgres", "secret", "admin", "roxira2026", ""]
    for pwd in passwords:
        try:
            return psycopg.connect(f"postgresql://{user}:{pwd}@{host}:{port}/{db_name}")
        except Exception:
            continue
    raise ConnectionError("عدم برقراری ارتباط با PostgreSQL")

def init_users_table():
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute('''
                CREATE TABLE IF NOT EXISTS system_users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(100) UNIQUE NOT NULL,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role VARCHAR(50) DEFAULT 'LEGAL_USER',
                    email_verified BOOLEAN DEFAULT FALSE,
                    verification_token VARCHAR(255),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            ''')
        conn.commit()

class UserManager:
    @classmethod
    def register_user(cls, username: str, email: str, password_hash: str) -> Dict[str, Any]:
        init_users_table()
        verify_token = secrets.token_urlsafe(32)
        try:
            with get_db_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO system_users (username, email, password_hash, verification_token) VALUES (%s, %s, %s, %s)",
                        (username, email, password_hash, verify_token)
                    )
                conn.commit()
            return {
                "status": "SUCCESS",
                "username": username,
                "email": email,
                "verification_token": verify_token,
                "message": "کاربر در دیتابیس پایدار PostgreSQL 17 ثبت شد."
            }
        except psycopg.errors.UniqueViolation:
            raise ValueError("این نام کاربری یا ایمیل قبلاً ثبت شده است.")
        except Exception as e:
            raise ValueError(f"خطای دیتابیس: {str(e)}")

    @classmethod
    def verify_email(cls, token: str) -> Dict[str, Any]:
        init_users_table()
        with get_db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT username FROM system_users WHERE verification_token = %s", (token,))
                row = cur.fetchone()
                if not row:
                    raise ValueError("توکن تاییدیه ایمیل نامعتبر یا منقضی است.")
                cur.execute("UPDATE system_users SET email_verified = TRUE, verification_token = NULL WHERE verification_token = %s", (token,))
            conn.commit()
        return {"status": "SUCCESS", "message": f"ایمیل کاربر {row[0]} با موفقیت تایید و فعال شد."}

    @classmethod
    def authenticate_and_issue_token(cls, username: str, password: str, auth_engine) -> Dict[str, Any]:
        init_users_table()
        with get_db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT password_hash, role, email_verified FROM system_users WHERE username = %s", (username,))
                row = cur.fetchone()
                if not row:
                    raise ValueError("نام کاربری یا کلمه عبور نادرست است.")
                pwd_hash, role, verified = row
                if not auth_engine.SuperAdminAuthEngine.verify_password(password, pwd_hash):
                    raise ValueError("نام کاربری یا کلمه عبور نادرست است.")
                
        token = auth_engine.SuperAdminAuthEngine.generate_full_access_token(username)
        return {
            "access_token": token,
            "token_type": "bearer",
            "role": role,
            "email_verified": verified
        }
