from __future__ import annotations
import os, psycopg
from typing import Dict, Any
from src.roxira_config import postgres_dsn

DB_URL = os.environ.get("DATABASE_URL") or postgres_dsn(host="127.0.0.1", port=5434)

class EnterpriseTaxComplianceEngine:
    def __init__(self, tenant_id: str):
        self.tenant_id = tenant_id

    def generate_balance_sheet(self) -> Dict[str, Any]:
        with psycopg.connect(DB_URL) as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT 
                        COALESCE(SUM(amount_base) FILTER (WHERE debit_account LIKE '1%' OR debit_account LIKE '5%'), 0) as total_debit,
                        COALESCE(SUM(amount_base) FILTER (WHERE credit_account LIKE '4%' OR credit_account LIKE '2%'), 0) as total_credit
                    FROM tenant_ledger_entries
                    WHERE tenant_id = %s;
                """, (self.tenant_id,))
                row = cur.fetchone()
                debit = float(row[0]) if row else 0.0
                credit = float(row[1]) if row else 0.0

        is_balanced = round(debit, 2) == round(credit, 2)
        return {
            "tenant_id": self.tenant_id,
            "trial_balance": {
                "total_debit_toman": debit,
                "total_credit_toman": credit,
                "is_balanced": is_balanced
            }
        }
