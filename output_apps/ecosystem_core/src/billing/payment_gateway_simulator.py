from __future__ import annotations

import uuid
import json
import psycopg
from datetime import datetime, timezone
from src.roxira_config import postgres_dsn

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

def init_billing_schema():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_subscriptions (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(64) UNIQUE NOT NULL,
                    plan_tier VARCHAR(32) NOT NULL, -- FREE, PRO_LEGAL, ENTERPRISE
                    token_quota INT NOT NULL DEFAULT 50000,
                    tokens_used INT NOT NULL DEFAULT 0,
                    active_until TIMESTAMP WITH TIME ZONE,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS payment_transactions (
                    id SERIAL PRIMARY KEY,
                    tracking_code VARCHAR(64) UNIQUE NOT NULL,
                    user_id VARCHAR(64) NOT NULL,
                    amount_toman NUMERIC(18, 2) NOT NULL,
                    gateway VARCHAR(32) DEFAULT 'ZARINPAL',
                    status VARCHAR(16) NOT NULL, -- PENDING, SUCCESS, FAILED
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            """)
            conn.commit()
    print("BILLING_SCHEMA_INITIALIZED=PASS")

class PaymentService:
    @staticmethod
    def process_successful_payment(user_id: str, amount_toman: float, plan_tier: str, quota_tokens: int) -> dict:
        tracking_code = f"SHAPARAK-{uuid.uuid4().hex[:10].upper()}"
        
        with psycopg.connect(DB_URL) as conn:
            with conn.cursor() as cur:
                # ۱. ثبت تراکنش درگاه
                cur.execute("""
                    INSERT INTO payment_transactions (tracking_code, user_id, amount_toman, status)
                    VALUES (%s, %s, %s, %s);
                """, (tracking_code, user_id, amount_toman, "SUCCESS"))

                # ۲. شارژ سهمیه و ارتقای پلن کاربر
                cur.execute("""
                    INSERT INTO user_subscriptions (user_id, plan_tier, token_quota, tokens_used)
                    VALUES (%s, %s, %s, 0)
                    ON CONFLICT (user_id) DO UPDATE
                    SET plan_tier = EXCLUDED.plan_tier,
                        token_quota = user_subscriptions.token_quota + EXCLUDED.token_quota,
                        updated_at = CURRENT_TIMESTAMP;
                """, (user_id, plan_tier, quota_tokens))
                
                conn.commit()

        return {
            "status": "PAYMENT_SETTLED",
            "tracking_code": tracking_code,
            "user_id": user_id,
            "plan_tier": plan_tier,
            "added_tokens": quota_tokens
        }

if __name__ == "__main__":
    init_billing_schema()
    res = PaymentService.process_successful_payment(
        user_id="user_mobin_01",
        amount_toman=490000.0,
        plan_tier="PRO_LEGAL",
        quota_tokens=500000
    )
    print("\n--- SHAPARAK INSTANT SETTLEMENT REPORT ---")
    print(json.dumps(res, indent=2, ensure_ascii=False))
