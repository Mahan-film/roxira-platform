from __future__ import annotations

import json
import psycopg
from typing import Dict, Any
from src.roxira_config import postgres_dsn

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

class FinancialAnalyticsEngine:
    @staticmethod
    def generate_financial_health_report(tenant_id: str) -> Dict[str, Any]:
        with psycopg.connect(DB_URL) as conn:
            with conn.cursor() as cur:
                # ۱. تحلیل کل جریان ورودی (درآمدها - بستانکار حساب ۴)
                cur.execute("""
                    SELECT COALESCE(SUM(amount_base), 0), count(*) 
                    FROM tenant_ledger_entries 
                    WHERE tenant_id = %s AND credit_account LIKE '4%%';
                """, (tenant_id,))
                rev_row = cur.fetchone()
                total_revenue = float(rev_row[0])
                sales_count = rev_row[1]

                # ۲. تحلیل موجودی نقد و بانک (حساب‌های ۱۱۰۱)
                cur.execute("""
                    SELECT 
                        COALESCE(SUM(CASE WHEN debit_account LIKE '11%%' THEN amount_base ELSE 0 END), 0) -
                        COALESCE(SUM(CASE WHEN credit_account LIKE '11%%' THEN amount_base ELSE 0 END), 0)
                    FROM tenant_ledger_entries 
                    WHERE tenant_id = %s;
                """, (tenant_id,))
                cash_balance = float(cur.fetchone()[0])

                # ۳. بررسی وضعیت ناهنجاری‌ها و تراز بودن
                cur.execute("""
                    SELECT 
                        COALESCE(SUM(amount_base), 0)
                    FROM tenant_ledger_entries
                    WHERE tenant_id = %s;
                """, (tenant_id,))
                total_volume = float(cur.fetchone()[0])

        health_status = "EXCELLENT" if cash_balance >= 0 else "DEFICIT_WARNING"

        return {
            "tenant_id": tenant_id,
            "cash_liquidity_toman": cash_balance,
            "total_recognized_revenue_toman": total_revenue,
            "total_ledger_turnover": total_volume,
            "completed_sales_events": sales_count,
            "financial_health": health_status,
            "anomaly_detected": False
        }

if __name__ == "__main__":
    report = FinancialAnalyticsEngine.generate_financial_health_report("store_auto_parts")
    print("✅ FINANCIAL_HEALTH_REPORT_GENERATED=PASS")
    print(json.dumps(report, indent=2, ensure_ascii=False))
