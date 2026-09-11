import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * افزودن ستون‌های تکمیلی ماژول انبارداری چند‌انباره و FIFO.
 *
 * چرا Migration جداگانه؟
 * جداول `erp_warehouses`، `erp_stock_items` و `inventory_fifo_batches`
 * پیش‌تر توسط لایه ERP پایتونی ایجاد شده‌اند. برای قیمت‌گذاری FIFO واقعی در
 * چند انبار، هر «دسته» (batch) باید به انبار خودش متصل باشد؛ همچنین برای
 * هشدار کسری، آستانه حداقل موجودی روی کالا نگهداری می‌شود.
 *
 * طبق Rule #4 AGENTS.md (Contract-First Synchronization) این تغییر صریحاً از
 * طریق Migration اعمال می‌شود و هرگز به synchronize=true تکیه نمی‌کنیم.
 */
export class CreateInventoryWarehouseLinkColumns1789060000000
  implements MigrationInterface
{
  name = 'CreateInventoryWarehouseLinkColumns1789060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "erp_stock_items" ADD COLUMN IF NOT EXISTS "min_quantity" double precision NOT NULL DEFAULT 0`,
    );

    await queryRunner.query(
      `ALTER TABLE "inventory_fifo_batches" ADD COLUMN IF NOT EXISTS "warehouse_id" integer`,
    );

    await queryRunner.query(`
      ALTER TABLE "inventory_fifo_batches"
      ADD CONSTRAINT "FK_inventory_fifo_batches_warehouse"
      FOREIGN KEY ("warehouse_id")
      REFERENCES "erp_warehouses"("id")
      ON DELETE SET NULL
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_inventory_fifo_batches_warehouse" ON "inventory_fifo_batches" ("warehouse_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_inventory_fifo_batches_sku_received" ON "inventory_fifo_batches" ("sku", "received_date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_inventory_fifo_batches_sku_received"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_inventory_fifo_batches_warehouse"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_fifo_batches" DROP CONSTRAINT IF EXISTS "FK_inventory_fifo_batches_warehouse"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_fifo_batches" DROP COLUMN IF EXISTS "warehouse_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "erp_stock_items" DROP COLUMN IF EXISTS "min_quantity"`,
    );
  }
}
