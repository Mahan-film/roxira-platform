import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * جداسازی مستأجر (Multi-Tenant) برای ماژول Inventory — Wave 3.
 *
 * جداول `erp_warehouses`، `erp_stock_items` و `inventory_fifo_batches` پیش‌تر
 * هیچ ستون مستأجری نداشتند و خواندن/نوشتن میان همه سازمان‌ها مشترک بود. این
 * Migration:
 *   • ستون `tenant_id` را به هر سه جدول اضافه و ردیف‌های موجود را با مستأجر
 *     پیش‌فرض پر می‌کند؛
 *   • ستون‌ها را NOT NULL می‌کند؛
 *   • ایندکس‌های ترکیبی لازم برای کوئری‌های مستأجری را می‌سازد؛
 *   • ایندکس‌های یکتای سراسری `ix_erp_warehouses_name` و
 *     `ix_erp_stock_items_sku` (ساخته‌شده توسط لایه پرسیستنس SQLAlchemy) را به
 *     ایندکس‌های یکتای ترکیبی `(tenant_id, name)` و `(tenant_id, sku)` تبدیل
 *     می‌کند تا دو سازمان بتوانند نام انبار/SKU یکسان داشته باشند.
 *
 * طبق Rule #4 AGENTS.md (Contract-First Synchronization) این تغییر صریحاً از
 * طریق Migration اعمال می‌شود و هرگز به synchronize=true تکیه نمی‌کنیم.
 * ردیف‌های پیش‌فرض پیش‌تر در Migration 1789120000000/1789140000000 با همین
 * شناسه ثابت مستأجر پر شده‌اند.
 */
export class AddInventoryTenantIsolation1789170000000
  implements MigrationInterface
{
  name = 'AddInventoryTenantIsolation1789170000000';

  /** شناسه ثابت مستأجر پیش‌فرض (همان مقدار backfill در 1789120000000). */
  private readonly defaultTenantId = '00000000-0000-0000-0000-000000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // erp_warehouses — افزودن، پرکردن و الزامی‌کردن ستون مستأجر
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "erp_warehouses" ADD COLUMN IF NOT EXISTS "tenant_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "erp_warehouses" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL`,
      [this.defaultTenantId],
    );
    await queryRunner.query(
      `ALTER TABLE "erp_warehouses" ALTER COLUMN "tenant_id" SET NOT NULL`,
    );

    // گسترش یکتایی سراسری نام انبار به ترکیب (tenant_id, name)
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_erp_warehouses_name"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_erp_warehouses_tenant_name" ON "erp_warehouses" ("tenant_id", "name")`,
    );

    // ------------------------------------------------------------------
    // erp_stock_items — افزودن، پرکردن و الزامی‌کردن ستون مستأجر
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "erp_stock_items" ADD COLUMN IF NOT EXISTS "tenant_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "erp_stock_items" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL`,
      [this.defaultTenantId],
    );
    await queryRunner.query(
      `ALTER TABLE "erp_stock_items" ALTER COLUMN "tenant_id" SET NOT NULL`,
    );

    // گسترش یکتایی سراسری SKU به ترکیب (tenant_id, sku)
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_erp_stock_items_sku"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_erp_stock_items_tenant_sku" ON "erp_stock_items" ("tenant_id", "sku")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_stock_items_tenant_barcode" ON "erp_stock_items" ("tenant_id", "barcode")`,
    );

    // ------------------------------------------------------------------
    // inventory_fifo_batches — افزودن، پرکردن و الزامی‌کردن ستون مستأجر
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "inventory_fifo_batches" ADD COLUMN IF NOT EXISTS "tenant_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "inventory_fifo_batches" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL`,
      [this.defaultTenantId],
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_fifo_batches" ALTER COLUMN "tenant_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_inventory_fifo_batches_tenant_sku_received" ON "inventory_fifo_batches" ("tenant_id", "sku", "received_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_inventory_fifo_batches_tenant_warehouse" ON "inventory_fifo_batches" ("tenant_id", "warehouse_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // inventory_fifo_batches — حذف ایندکس‌های مستأجری و ستون
    // ------------------------------------------------------------------
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_inventory_fifo_batches_tenant_warehouse"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_inventory_fifo_batches_tenant_sku_received"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_fifo_batches" DROP COLUMN IF EXISTS "tenant_id"`,
    );

    // ------------------------------------------------------------------
    // erp_stock_items — بازگرداندن یکتایی سراسری SKU و حذف ستون
    // ------------------------------------------------------------------
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_erp_stock_items_tenant_barcode"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_erp_stock_items_tenant_sku"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "ix_erp_stock_items_sku" ON "erp_stock_items" ("sku")`,
    );
    await queryRunner.query(
      `ALTER TABLE "erp_stock_items" DROP COLUMN IF EXISTS "tenant_id"`,
    );

    // ------------------------------------------------------------------
    // erp_warehouses — بازگرداندن یکتایی سراسری نام و حذف ستون
    // ------------------------------------------------------------------
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_erp_warehouses_tenant_name"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "ix_erp_warehouses_name" ON "erp_warehouses" ("name")`,
    );
    await queryRunner.query(
      `ALTER TABLE "erp_warehouses" DROP COLUMN IF EXISTS "tenant_id"`,
    );
  }
}
