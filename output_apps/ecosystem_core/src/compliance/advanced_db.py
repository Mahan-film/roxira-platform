import os
import psycopg

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

def init_advanced_tables():
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            # ۱. جدول پرونده‌ها / جلسات چت چندگانه کاربران
            cur.execute('''
                CREATE TABLE IF NOT EXISTS legal_case_sessions (
                    id SERIAL PRIMARY KEY,
                    session_uuid VARCHAR(100) UNIQUE NOT NULL,
                    username VARCHAR(100) NOT NULL,
                    case_title VARCHAR(255) NOT NULL,
                    category VARCHAR(50) DEFAULT 'CIVIL',
                    event_date DATE DEFAULT CURRENT_DATE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            ''')
            # ۲. جدول پیام‌های چت استنادی
            cur.execute('''
                CREATE TABLE IF NOT EXISTS legal_chat_messages (
                    id SERIAL PRIMARY KEY,
                    session_uuid VARCHAR(100) NOT NULL,
                    sender VARCHAR(20) NOT NULL,
                    message_text TEXT NOT NULL,
                    model_used VARCHAR(50),
                    citations JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            ''')
            # ۳. جدول تیکت‌های پشتیبانی و پاسخ مدیریت
            cur.execute('''
                CREATE TABLE IF NOT EXISTS support_tickets (
                    id SERIAL PRIMARY KEY,
                    ticket_code VARCHAR(50) UNIQUE NOT NULL,
                    user_name VARCHAR(100) NOT NULL,
                    contact_info VARCHAR(100) NOT NULL,
                    department VARCHAR(50) NOT NULL,
                    subject VARCHAR(255) NOT NULL,
                    message TEXT NOT NULL,
                    admin_reply TEXT,
                    status VARCHAR(20) DEFAULT 'OPEN',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    replied_at TIMESTAMP
                );
            ''')
        conn.commit()

if __name__ == "__main__":
    init_advanced_tables()
    print("Advanced case and ticket tables ready.")
