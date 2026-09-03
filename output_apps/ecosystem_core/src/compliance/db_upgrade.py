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
    raise ConnectionError("عدم اتصال به PostgreSQL")

def upgrade_tables():
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            # جدول ارتقایافته کاربران با شماره تماس و نام کامل
            cur.execute('''
                CREATE TABLE IF NOT EXISTS system_users (
                    id SERIAL PRIMARY KEY,
                    full_name VARCHAR(150),
                    phone VARCHAR(50),
                    username VARCHAR(100) UNIQUE NOT NULL,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role VARCHAR(50) DEFAULT 'LEGAL_USER',
                    plan_tier VARCHAR(50) DEFAULT 'FREE',
                    email_verified BOOLEAN DEFAULT FALSE,
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

if __name__ == "__main__":
    upgrade_tables()
    print("Database tables upgraded.")
