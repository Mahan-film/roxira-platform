import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * افزودن روش ارزش‌گذاری (`costing_method`) و بهای تمام‌شده استاندارد (`standard_cost`)
 * به جدول کالاهای انبار (`erp_stock_items`).
 */
export class AddCostingMethodToStockItems1789900051000 implements MigrationInterface {
  name = 'AddCostingMethodToStockItems1789900051000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "erp_stock_items"
      ADD COLUMN IF NOT EXISTS "costing_method" character varying(16) NOT NULL DEFAULT 'FIFO',
      ADD COLUMN IF NOT EXISTS "standard_cost" numeric(18,2) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "erp_stock_items"
      DROP COLUMN IF EXISTS "standard_cost",
      DROP COLUMN IF EXISTS "costing_method"
    `);
  }
}
