from __future__ import annotations

import json
import os
import sys
import pathlib
import psycopg
from datetime import datetime, timezone

CURRENT_FILE = pathlib.Path(__file__).resolve()
for parent in CURRENT_FILE.parents:
    if (parent / "output_apps").is_dir():
        if str(parent) not in sys.path:
            sys.path.insert(0, str(parent))
        break

from output_apps.ecosystem_core.src.ingestion.universal_parser import parse_unstructured_document
from src.roxira_config import postgres_dsn

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

def init_case_storage():
    """Initializes tables for client legal cases, contracts, and evidence files."""
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS legal_cases (
                    id SERIAL PRIMARY KEY,
                    case_number VARCHAR(64) UNIQUE NOT NULL,
                    title VARCHAR(256) NOT NULL,
                    case_type VARCHAR(64) NOT NULL, -- CIVIL, CRIMINAL, DISCIPLINARY, COMMERCIAL
                    parties JSONB NOT NULL,
                    facts_summary TEXT NOT NULL,
                    financial_value NUMERIC(18, 2) DEFAULT 0.00,
                    currency VARCHAR(8) DEFAULT 'IRR',
                    extracted_entities JSONB NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            """)
            conn.commit()
    print("LEGAL_CASE_STORAGE_INITIALIZED=PASS")

def ingest_raw_legal_document(raw_doc_text: str, case_number: str, doc_category: str = "CONTRACT") -> dict:
    """Parses raw text/OCR via AI and records it into the PostgreSQL legal cases database."""
    parsed_data = parse_unstructured_document(raw_doc_text, doc_category=doc_category)
    
    contract_data = parsed_data.get("contract", parsed_data)
    title = contract_data.get("title", f"پرونده {case_number}")
    parties = contract_data.get("parties", [])
    val_info = contract_data.get("total_project_value", {})
    amount = float(val_info.get("amount", 0.0)) if isinstance(val_info, dict) else 0.0
    currency = val_info.get("currency", "IRR") if isinstance(val_info, dict) else "IRR"

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO legal_cases 
                (case_number, title, case_type, parties, facts_summary, financial_value, currency, extracted_entities)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (case_number) DO UPDATE
                SET facts_summary = EXCLUDED.facts_summary,
                    extracted_entities = EXCLUDED.extracted_entities;
            """, (
                case_number,
                title,
                doc_category,
                json.dumps(parties, ensure_ascii=False),
                json.dumps(contract_data.get("payment_terms", {}), ensure_ascii=False),
                amount,
                currency,
                json.dumps(parsed_data, ensure_ascii=False)
            ))
            conn.commit()

    return {
        "status": "RECORDED",
        "case_number": case_number,
        "title": title,
        "amount": amount,
        "currency": currency
    }

if __name__ == "__main__":
    init_case_storage()
    sample_text = """
    قرارداد فروش نرم‌افزار سازمانی
    تاریخ عقد: ۱۲ آبان ۱۴۰۲
    طرف اول: شرکت فناوری روکسیرا با شناسه ملی ۱۰۱۰۲۳۴۵۶
    طرف دوم: شرکت مهندسی سپهر رایانه
    مبلغ کل پروژه: ۱۲۰,۰۰۰,۰۰۰ ریال معادل ۱۲,۰۰۰,۰۰۰ تومان
    مقرر شد ۵۰ درصد ثمن حین عقد قرارداد و مابقی پس از تحویل نهایی داکرها پرداخت گردد.
    خسارت روزانه تاخیر: ۵,۰۰۰,۰۰۰ ریال.
    """
    res = ingest_raw_legal_document(sample_text, case_number="CASE-2026-001", doc_category="CONTRACT")
    print("\n--- INGESTED CASE RECORD ---")
    print(json.dumps(res, indent=2, ensure_ascii=False))
