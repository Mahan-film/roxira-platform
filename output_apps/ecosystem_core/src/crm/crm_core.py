from __future__ import annotations

import json
import uuid
import pathlib
import sys
import importlib.util
import psycopg
from typing import Dict, Any, List

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

tenant_file = resolve_file("output_apps/ecosystem_core/src/mcp_server/tenant_tools.py")
spec = importlib.util.spec_from_file_location("tenant_tools", tenant_file)
tenant_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tenant_mod)

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

def init_crm_schema():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crm_deals (
                    id SERIAL PRIMARY KEY,
                    deal_id VARCHAR(64) UNIQUE NOT NULL,
                    tenant_id VARCHAR(64) NOT NULL,
                    contact_name VARCHAR(128) NOT NULL,
                    contact_phone VARCHAR(32),
                    deal_title VARCHAR(255) NOT NULL,
                    deal_value NUMERIC(18, 2) NOT NULL,
                    currency VARCHAR(16) DEFAULT 'TOMAN',
                    stage VARCHAR(32) NOT NULL, -- LEAD, NEGOTIATION, PROPOSAL, CLOSED_WON, CLOSED_LOST
                    sku_target VARCHAR(64),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS crm_interactions (
                    id SERIAL PRIMARY KEY,
                    deal_id VARCHAR(64) REFERENCES crm_deals(deal_id) ON DELETE CASCADE,
                    interaction_type VARCHAR(32) NOT NULL, -- CALL, MEETING, EMAIL, SANA_FOLLOWUP
                    summary TEXT NOT NULL,
                    sentiment VARCHAR(16) DEFAULT 'NEUTRAL',
                    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            """)
            conn.commit()
    print("✅ CRM_SCHEMA_INITIALIZED=PASS")

class IntelligentCRMEngine:
    """Enterprise CRM Engine with autonomous stage-to-ledger automation."""

    @staticmethod
    def create_or_update_deal(
        tenant_id: str,
        contact_name: str,
        deal_title: str,
        deal_value: float,
        stage: str,
        contact_phone: str = "",
        sku_target: str = "GEN-SVC-01",
        deal_id: str | None = None
    ) -> Dict[str, Any]:
        d_id = deal_id or f"DEAL-{uuid.uuid4().hex[:8].upper()}"
        
        with psycopg.connect(DB_URL) as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO crm_deals (deal_id, tenant_id, contact_name, contact_phone, deal_title, deal_value, stage, sku_target)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (deal_id) DO UPDATE
                    SET stage = EXCLUDED.stage,
                        deal_value = EXCLUDED.deal_value,
                        updated_at = CURRENT_TIMESTAMP;
                """, (d_id, tenant_id, contact_name, contact_phone, deal_title, deal_value, stage, sku_target))
                conn.commit()

        # اتوماسیون قطعی: اگر معامله نهایی شد، تراکنش دفترکل و فاکتور خودکار صادر می‌شود
        ledger_tx = None
        if stage == "CLOSED_WON":
            ledger_tx = tenant_mod.mcp_record_isolated_sale(
                tenant_id=tenant_id,
                sku=sku_target,
                item_name=deal_title,
                qty=1.0,
                unit_price=deal_value,
                currency="TOMAN",
                debit_acc="1101",
                credit_acc="4101",
                desc=f"تسویه خودکار قرارداد CRM: {contact_name}"
            )

        return {
            "status": "RECORDED",
            "deal_id": d_id,
            "stage": stage,
            "deal_value": deal_value,
            "auto_ledger_triggered": stage == "CLOSED_WON",
            "ledger_result": ledger_tx
        }

if __name__ == "__main__":
    init_crm_schema()
    crm = IntelligentCRMEngine()
    
    # تست ثبت و پیشبرد معامله به مرحله بسته‌شدن
    res = crm.create_or_update_deal(
        tenant_id="store_software_co",
        contact_name="شرکت هلدینگ پارس",
        deal_title="قرارداد استقرار پلتفرم سازمانی",
        deal_value=85000000.0,
        stage="CLOSED_WON",
        contact_phone="09120000000",
        sku_target="ENTERPRISE-PLATFORM-V3"
    )
    print("\n--- CRM AUTOMATION RESULT ---")
    print(json.dumps(res, indent=2, ensure_ascii=False))
