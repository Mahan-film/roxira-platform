import psycopg

DB_URL = "postgresql://enterprise_admin:REDACTED_SECRET_19@127.0.0.1:5434/enterprise_db"

def sync_ledger_schema():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                ALTER TABLE tenant_ledger_entries 
                ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(12, 6) DEFAULT 1.0,
                ADD COLUMN IF NOT EXISTS debit_account VARCHAR(32) DEFAULT '1101',
                ADD COLUMN IF NOT EXISTS credit_account VARCHAR(32) DEFAULT '4101',
                ADD COLUMN IF NOT EXISTS sku VARCHAR(64) DEFAULT 'GENERAL-SKU',
                ADD COLUMN IF NOT EXISTS item_name VARCHAR(256) DEFAULT 'کالای عمومی',
                ADD COLUMN IF NOT EXISTS quantity NUMERIC(18, 4) DEFAULT 1.0,
                ADD COLUMN IF NOT EXISTS unit_price NUMERIC(18, 4) DEFAULT 0.0;
            """)
            conn.commit()
    print("DATABASE_LEDGER_SCHEMA_SYNCED=PASS")

if __name__ == "__main__":
    sync_ledger_schema()
