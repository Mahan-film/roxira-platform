import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 1789900010800: Add tax_code (13-digit SSTID) to erp_stock_items (#728 / T71).
 */
export class AddProductTaxCode1789900010800 implements MigrationInterface {
  name = 'AddProductTaxCode1789900010800';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "erp_stock_items" ADD COLUMN IF NOT EXISTS "tax_code" varchar(13) NULL`,
    );
  }

  public async down(_q: QueryRunner): Promise<void> {
    // Deliberate no-op: dropping erp_stock_items.tax_code would silently delete
    // stored 13-digit SSTID values. Rollback requires manual data backup/restore.
  }
}
