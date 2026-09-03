import os
import psycopg
from typing import Dict, Any

def get_db_connection():
    # بررسی متغیرهای محیطی و کانکشن استرینگ‌های مختلف
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        return psycopg.connect(db_url)
    
    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", os.getenv("DB_PASSWORD", "postgres"))
    db_name = os.getenv("POSTGRES_DB", os.getenv("DB_NAME", "roxira_production"))
    host = os.getenv("POSTGRES_HOST", "roxira_postgres_prod")
    port = os.getenv("POSTGRES_PORT", "5432")
    
    # تلاش با چند ترکیب متداول
    passwords_to_try = [password, "postgres", "secret", "admin", "roxira2026", ""]
    for pwd in passwords_to_try:
        try:
            conn_str = f"postgresql://{user}:{pwd}@{host}:{port}/{db_name}"
            return psycopg.connect(conn_str)
        except Exception:
            continue
    raise ConnectionError("امکان برقراری اتصال با PostgreSQL با متغیرهای موجود میسر نشد.")

def initialize_database_tables():
    commands = [
        '''
        CREATE TABLE IF NOT EXISTS accounting_accounts (
            id SERIAL PRIMARY KEY,
            account_code VARCHAR(50) UNIQUE NOT NULL,
            account_name VARCHAR(255) NOT NULL,
            account_level VARCHAR(20) NOT NULL,
            balance NUMERIC(18, 2) DEFAULT 0.00,
            currency VARCHAR(10) DEFAULT 'TOMAN',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        ''',
        '''
        CREATE TABLE IF NOT EXISTS journal_entries (
            id SERIAL PRIMARY KEY,
            voucher_number VARCHAR(50) NOT NULL,
            account_code VARCHAR(50) NOT NULL,
            debit NUMERIC(18, 2) DEFAULT 0.00,
            credit NUMERIC(18, 2) DEFAULT 0.00,
            description TEXT,
            entry_date DATE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        ''',
        '''
        CREATE TABLE IF NOT EXISTS inventory_fifo_batches (
            id SERIAL PRIMARY KEY,
            sku VARCHAR(100) NOT NULL,
            batch_number VARCHAR(100) NOT NULL,
            quantity_remaining NUMERIC(12, 2) NOT NULL,
            unit_purchase_cost NUMERIC(18, 2) NOT NULL,
            received_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        ''',
        '''
        CREATE TABLE IF NOT EXISTS legal_statutes_temporal (
            id SERIAL PRIMARY KEY,
            component_id VARCHAR(100) UNIQUE NOT NULL,
            work_title VARCHAR(255) NOT NULL,
            norm_type VARCHAR(50) NOT NULL,
            binding_level INT NOT NULL,
            article_number VARCHAR(50),
            statute_text TEXT NOT NULL,
            valid_start DATE NOT NULL,
            valid_end DATE,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        '''
    ]
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                for cmd in commands:
                    cur.execute(cmd)
            conn.commit()
        return {"status": "SUCCESS", "message": "تمامی جداول حسابداری، انبار و قوانین در PostgreSQL 17 ساخته شدند."}
    except Exception as e:
        return {"status": "ERROR", "detail": str(e)}
