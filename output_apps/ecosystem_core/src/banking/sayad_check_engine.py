from __future__ import annotations

import re
import json
import pathlib
import sys
import importlib.util
import psycopg
from typing import Dict, Any

CURRENT_DIR = pathlib.Path.cwd()
ROOT_DIRS = [CURRENT_DIR, pathlib.Path("/Users/mac/Developer/project-foundry-worktrees/fnd-ops-00"), pathlib.Path("/Users/mac/Developer/project-foundry")]
for r in ROOT_DIRS:
    if str(r) not in sys.path:
        sys.path.insert(0, str(r))
from src.roxira_config import postgres_dsn

def resolve_file(rel: str) -> pathlib.Path:
    for base in ROOT_DIRS:
        cand = base / rel
        if cand.is_file():
            return cand
    return pathlib.Path.cwd() / rel

def dynamic_import(name: str, rel_path: str):
    fpath = resolve_file(rel_path)
    spec = importlib.util.spec_from_file_location(name, fpath)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

tenant_mod = dynamic_import("tenant_tools", "output_apps/ecosystem_core/src/mcp_server/tenant_tools.py")
judge_mod = dynamic_import("legal_drafter", "output_apps/smart_judge/src/engines/legal_drafter.py")

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

def init_banking_schema():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS banking_sayad_checks (
                    id SERIAL PRIMARY KEY,
                    sayad_id VARCHAR(16) UNIQUE NOT NULL,
                    tenant_id VARCHAR(64) NOT NULL,
                    check_type VARCHAR(16) NOT NULL, -- RECEIVABLE (دریافتنی), PAYABLE (پرداختنی)
                    drawer_name VARCHAR(128) NOT NULL,
                    drawer_national_id VARCHAR(16),
                    payee_name VARCHAR(128) NOT NULL,
                    amount_toman NUMERIC(18, 2) NOT NULL,
                    due_date VARCHAR(16) NOT NULL,
                    bank_name VARCHAR(64) NOT NULL,
                    status VARCHAR(32) NOT NULL, -- REGISTERED, CLEARED, BOUNCED
                    ledger_tx_id VARCHAR(64),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            """)
            conn.commit()
    print("✅ BANKING_SAYAD_SCHEMA_INITIALIZED=PASS")

class SayadCheckEngine:
    """Intelligent Central Bank Sayad Check Parser, Ledger Router & Article 23 Enforcement Engine."""

    @staticmethod
    def validate_sayad_id(sayad_id: str) -> bool:
        clean_id = re.sub(r"\D", "", sayad_id)
        return len(clean_id) == 16

    @classmethod
    def register_check(
        cls,
        tenant_id: str,
        sayad_id: str,
        check_type: str,
        drawer_name: str,
        payee_name: str,
        amount_toman: float,
        due_date: str,
        bank_name: str,
        drawer_national_id: str = ""
    ) -> Dict[str, Any]:
        if not cls.validate_sayad_id(sayad_id):
            raise ValueError(f"شناسه صیاد نامعتبر است: {sayad_id} (باید دقیقاً ۱۶ رقم عددی باشد)")

        # ثبت حسابداری دوبل: اسناد دریافتنی (۱۱۰۳) یا اسناد پرداختنی (۲۱۰۲)
        if check_type == "RECEIVABLE":
            debit_acc = "1103"  # اسناد دریافتنی تجاری
            credit_acc = "4101" # درآمد فروش / تسویه حساب مشتری
            desc = f"دریافت چک صیادی {sayad_id} عهده بانک {bank_name} سررسید {due_date}"
        else:
            debit_acc = "5101"  # خرید کالا یا هزینه
            credit_acc = "2102" # اسناد پرداختنی تجاری
            desc = f"صدور چک صیادی {sayad_id} در وجه {payee_name} سررسید {due_date}"

        ledger_log = tenant_mod.mcp_record_isolated_sale(
            tenant_id=tenant_id,
            sku=f"SAYAD-{sayad_id[:6]}",
            item_name=f"چک صیاد {bank_name}",
            qty=1.0,
            unit_price=amount_toman,
            currency="TOMAN",
            debit_acc=debit_acc,
            credit_acc=credit_acc,
            desc=desc
        )

        with psycopg.connect(DB_URL) as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO banking_sayad_checks 
                    (sayad_id, tenant_id, check_type, drawer_name, drawer_national_id, payee_name, amount_toman, due_date, bank_name, status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (sayad_id) DO UPDATE
                    SET status = EXCLUDED.status,
                        amount_toman = EXCLUDED.amount_toman;
                """, (sayad_id, tenant_id, check_type, drawer_name, drawer_national_id, payee_name, amount_toman, due_date, bank_name, "REGISTERED"))
                conn.commit()

        return {
            "status": "CHECK_REGISTERED_IN_LEDGER",
            "sayad_id": sayad_id,
            "amount_toman": amount_toman,
            "accounting_entry": f"Debit: {debit_acc} | Credit: {credit_acc}",
            "ledger_result": ledger_log
        }

    @classmethod
    def handle_bounced_check_and_trigger_lawsuit(cls, sayad_id: str, rejection_cert_number: str) -> Dict[str, Any]:
        """Triggers direct executive petition draft under Article 23 of Check Law."""
        with psycopg.connect(DB_URL) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT tenant_id, drawer_name, payee_name, amount_toman, bank_name, due_date FROM banking_sayad_checks WHERE sayad_id = %s;", (sayad_id,))
                row = cur.fetchone()
                if not row:
                    raise ValueError("چک صیادی با این شناسه در سامانه یافت نشد.")
                
                cur.execute("UPDATE banking_sayad_checks SET status = 'BOUNCED' WHERE sayad_id = %s;", (sayad_id,))
                conn.commit()

        facts = f"""درخواست صدور اجرائیه مستقیم چک صیادی وفق ماده ۲۳ اصلاحی قانون صدور چک.
شناسه ۱۶ رقمی صیاد: {sayad_id}
بانک محال‌علیه: {row[4]}
شماره گواهینامه عدم پرداخت: {rejection_cert_number}
مبلغ چک: {row[3]:,.0f} تومان
صادرکننده متعهد: {row[1]}
دارنده چک: {row[2]}
سررسید: {row[5]}
به استناد ماده ۲۳ قانون صدور چک و ماده ۵۱۵ قانون آیین دادرسی مدنی، تقاضای صدور فوری اجرائیه نسبت به اصل وجه و حق‌الوکاله و خسارت تاخیر تادیه مورد استدعاست."""

        drafter = judge_mod.SmartJudgeEngine()
        lawsuit = drafter.generate_legal_document(
            doc_type="EXECUTIVE_PETITION_ARTICLE_23",
            case_facts=facts,
            client_info={"claimant_name": row[2], "respondent_name": row[1]}
        )

        return {
            "status": "BOUNCED_AND_PETITION_GENERATED",
            "sayad_id": sayad_id,
            "court_petition": lawsuit
        }

if __name__ == "__main__":
    init_banking_schema()
    engine = SayadCheckEngine()
    
    # تست ثبت چک دریافتنی صیادی
    reg_out = engine.register_check(
        tenant_id="store_auto_parts",
        sayad_id="1102987654321098",
        check_type="RECEIVABLE",
        drawer_name="شرکت تجارت قطعه برتر",
        payee_name="فروشگاه قطعات البرز",
        amount_toman=15000000.0,
        due_date="1405/04/15",
        bank_name="بانک ملی ایران",
        drawer_national_id="10108877665"
    )
    print("✅ REGISTER_SAYAD_CHECK=PASS")
    print(json.dumps(reg_out, indent=2, ensure_ascii=False))
