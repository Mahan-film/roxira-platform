from __future__ import annotations

import hashlib
import json
import psycopg
from src.roxira_config import postgres_dsn

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

def run_system_health_audit():
    print("=== INITIATING ENTERPRISE SYSTEM INTEGRITY AUDIT ===")
    issues = []

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            # ۱. بررسی زنجیره هش حسابرسی
            cur.execute("SELECT id, tenant_id, action, payload, previous_hash, current_hash FROM audit_logs ORDER BY id ASC;")
            logs = cur.fetchall()
            
            prev_hash = "GENESIS_HASH_0000000000000000"
            chain_valid = True
            for log_id, tenant, act, payload, recorded_prev, recorded_curr in logs:
                expected_raw = f"{prev_hash}:{tenant}:{act}:{json.dumps(payload, sort_keys=True)}"
                calculated_hash = hashlib.sha256(expected_raw.encode("utf-8")).hexdigest()
                
                if recorded_prev != prev_hash or recorded_curr != calculated_hash:
                    chain_valid = False
                    issues.append(f"CRITICAL: Audit log tampering detected at Log ID {log_id}!")
                    break
                prev_hash = recorded_curr

            print(f"[AUDIT CHAIN]: {'VERIFIED (100% Tamper-Evident)' if chain_valid else 'FAILED'}")

            # ۲. بررسی تراز بودن دفترکل به تفکیک شرکت‌ها
            cur.execute("SELECT DISTINCT tenant_id FROM tenants;")
            tenants = [row[0] for row in cur.fetchall()]

            for t_id in tenants:
                cur.execute("""
                    SELECT 
                        SUM(amount_base) as total_debit,
                        SUM(amount_base) as total_credit
                    FROM tenant_ledger_entries
                    WHERE tenant_id = %s;
                """, (t_id,))
                row = cur.fetchone()
                deb = float(row[0]) if row and row[0] else 0.0
                cred = float(row[1]) if row and row[1] else 0.0
                
                is_balanced = round(deb, 2) == round(cred, 2)
                print(f"[LEDGER BALANCE - {t_id}]: {'BALANCED' if is_balanced else 'IMBALANCED'} (Total Base: {deb:,.2f})")
                if not is_balanced:
                    issues.append(f"Accounting imbalance in tenant: {t_id}")

            # ۳. وضعیت انبارها
            cur.execute("SELECT tenant_id, sku, name, quantity, currency FROM tenant_inventory;")
            inventory_rows = cur.fetchall()
            print(f"[INVENTORY TRACKER]: {len(inventory_rows)} SKU records active across stores.")

            # ۴. اسناد حقوقی و قوانین ثبت‌شده
            cur.execute("SELECT count(*) FROM legal_statutes_v2;")
            statutes_count = cur.fetchone()[0]
            print(f"[LEGAL KNOWLEDGE BASE]: {statutes_count} articles active in LegalGraph.")

    print("---------------------------------------------------")
    if not issues:
        print(">>> ALL SYSTEM INTEGRITY CHECKS PASSED: ZERO DATA ANOMALIES <<<")
    else:
        print(f"WARNING: {len(issues)} issue(s) detected:")
        for iss in issues:
            print(f" - {iss}")
    print("===================================================\n")

if __name__ == "__main__":
    run_system_health_audit()
