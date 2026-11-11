import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 1789900002900: Add tax_code (13-digit SSTID) to erp_stock_items (#728 / T71).
 */
export class AddProductTaxCode1789900002900 implements MigrationInterface {
  name = 'AddProductTaxCode1789900002900';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "erp_stock_items" ADD COLUMN IF NOT EXISTS "tax_code" varchar(13) NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "erp_stock_items" DROP COLUMN IF EXISTS "tax_code"`,
    );
  }
}
