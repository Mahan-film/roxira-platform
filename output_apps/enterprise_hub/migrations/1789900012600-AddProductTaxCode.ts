import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 1789900012600: Add tax_code (13-digit SSTID) to erp_stock_items (#728 / T71).
 */
export class AddProductTaxCode1789900012600 implements MigrationInterface {
  name = 'AddProductTaxCode1789900012600';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "erp_stock_items" ADD COLUMN IF NOT EXISTS "tax_code" varchar(13) NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    // Back up any non-null SSTID values before dropping the column so rollback does not silently lose data.
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'erp_stock_items' AND column_name = 'tax_code'
        ) THEN
          IF EXISTS (SELECT 1 FROM "erp_stock_items" WHERE "tax_code" IS NOT NULL LIMIT 1) THEN
            CREATE TABLE IF NOT EXISTS "_rollback_backup_erp_stock_items_tax_code" AS
            SELECT "id", "tenant_id", "tax_code", now() AS "backed_up_at"
            FROM "erp_stock_items"
            WHERE false;
            INSERT INTO "_rollback_backup_erp_stock_items_tax_code" ("id", "tenant_id", "tax_code", "backed_up_at")
            SELECT "id", "tenant_id", "tax_code", now()
            FROM "erp_stock_items"
            WHERE "tax_code" IS NOT NULL;
          END IF;
        END IF;
      END $$;
    `);
    await q.query(
      `ALTER TABLE "erp_stock_items" DROP COLUMN IF EXISTS "tax_code"`,
    );
  }
}
