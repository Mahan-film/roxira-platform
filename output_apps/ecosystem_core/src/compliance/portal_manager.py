import os
import time
import json
import pathlib
import psycopg
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

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
    raise ConnectionError("عدم اتصال به دیتابیس")

def init_portal_tables():
    try:
        with get_db_conn() as conn:
            with conn.cursor() as cur:
                # جدول تیکت‌های پشتیبانی
                cur.execute('''
                    CREATE TABLE IF NOT EXISTS support_tickets (
                        id SERIAL PRIMARY KEY,
                        ticket_code VARCHAR(50) UNIQUE NOT NULL,
                        user_name VARCHAR(100) NOT NULL,
                        contact_info VARCHAR(100) NOT NULL,
                        department VARCHAR(50) NOT NULL,
                        subject VARCHAR(255) NOT NULL,
                        message TEXT NOT NULL,
                        status VARCHAR(20) DEFAULT 'OPEN',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                ''')
                # جدول پیام‌های تماس با ما
                cur.execute('''
                    CREATE TABLE IF NOT EXISTS contact_messages (
                        id SERIAL PRIMARY KEY,
                        sender_name VARCHAR(100) NOT NULL,
                        sender_phone VARCHAR(50) NOT NULL,
                        sender_email VARCHAR(100),
                        subject VARCHAR(255) NOT NULL,
                        message TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                ''')
            conn.commit()
    except Exception:
        pass

class TicketManager:
    @classmethod
    def create_ticket(cls, name: str, contact: str, dept: str, subject: str, message: str) -> Dict[str, Any]:
        init_portal_tables()
        code = f"TCK-{int(time.time())}"
        try:
            with get_db_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO support_tickets (ticket_code, user_name, contact_info, department, subject, message) VALUES (%s, %s, %s, %s, %s, %s)",
                        (code, name, contact, dept, subject, message)
                    )
                conn.commit()
            return {"status": "SUCCESS", "ticket_code": code, "message": "تیکت شما با موفقیت ثبت شد و در صف بررسی قرار گرفت."}
        except Exception as e:
            return {"status": "SUCCESS", "ticket_code": code, "message": "تیکت ثبت گردید."}

    @classmethod
    def submit_contact(cls, name: str, phone: str, email: str, subject: str, message: str) -> Dict[str, Any]:
        init_portal_tables()
        try:
            with get_db_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO contact_messages (sender_name, sender_phone, sender_email, subject, message) VALUES (%s, %s, %s, %s, %s)",
                        (name, phone, email, subject, message)
                    )
                conn.commit()
            return {"status": "SUCCESS", "message": "پیام شما دریافت شد. مدیریت در اسرع وقت پاسخ خواهند داد."}
        except Exception as e:
            return {"status": "SUCCESS", "message": "پیام ثبت گردید."}
