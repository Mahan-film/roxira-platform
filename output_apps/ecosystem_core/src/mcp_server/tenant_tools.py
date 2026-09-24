from __future__ import annotations
import os
import psycopg
from typing import Dict, Any
from src.roxira_config import postgres_dsn

DB_URL = os.environ.get("DATABASE_URL") or postgres_dsn(host="127.0.0.1", port=5434)

def init_ledger_schema():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS tenant_ledger_entries (
                    id SERIAL PRIMARY KEY,
                    tenant_id VARCHAR(64) NOT NULL,
                    sku VARCHAR(64) NOT NULL,
                    item_name VARCHAR(256) NOT NULL,
                    quantity NUMERIC(18, 4) NOT NULL,
                    unit_price NUMERIC(18, 4) NOT NULL,
                    currency VARCHAR(16) NOT NULL,
                    amount_base NUMERIC(18, 4) NOT NULL,
                    exchange_rate NUMERIC(12, 6) DEFAULT 1.0,
                    debit_account VARCHAR(32) NOT NULL,
                    credit_account VARCHAR(32) NOT NULL,
                    description TEXT NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_tenant_id ON tenant_ledger_entries(tenant_id);
            """)
            conn.commit()

def mcp_record_isolated_sale(
    tenant_id: str,
    sku: str,
    item_name: str,
    qty: float,
    unit_price: float,
    currency: str,
    debit_acc: str,
    credit_acc: str,
    desc: str
) -> Dict[str, Any]:
    init_ledger_schema()
    amount_base = qty * unit_price
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO tenant_ledger_entries 
                (tenant_id, sku, item_name, quantity, unit_price, currency, amount_base, debit_account, credit_account, description)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id;
            """, (tenant_id, sku, item_name, qty, unit_price, currency, amount_base, debit_acc, credit_acc, desc))
            entry_id = cur.fetchone()[0]
            conn.commit()
    return {"status": "RECORDED", "entry_id": entry_id, "amount_base": amount_base, "currency": currency}
