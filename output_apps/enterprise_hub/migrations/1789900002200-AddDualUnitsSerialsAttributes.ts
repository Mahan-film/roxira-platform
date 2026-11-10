import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 1789900002200: Add dual units, serial numbers, and attributes to inventory (#230 / T73).
 *
 * Supports:
 * - Primary and secondary units with conversion ratios (e.g. carton <-> piece)
 * - Serial number tracking on FIFO batches and document movement lines
 * - Up to 10 key-value attributes on items and batches
 */
export class AddDualUnitsSerialsAttributes1789900002200 implements MigrationInterface {
  name = 'AddDualUnitsSerialsAttributes1789900002200';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "erp_stock_items"
      ADD COLUMN IF NOT EXISTS "primary_unit" varchar(32) NOT NULL DEFAULT 'piece',
      ADD COLUMN IF NOT EXISTS "secondary_unit" varchar(32) NULL,
      ADD COLUMN IF NOT EXISTS "unit_ratio" numeric(12, 4) NULL,
      ADD COLUMN IF NOT EXISTS "attributes" jsonb NULL
    `);

    await q.query(`
      ALTER TABLE "inventory_fifo_batches"
      ADD COLUMN IF NOT EXISTS "serial_numbers" jsonb NULL,
      ADD COLUMN IF NOT EXISTS "attributes" jsonb NULL
    `);

    await q.query(`
      ALTER TABLE "erp_stock_document_lines"
      ADD COLUMN IF NOT EXISTS "secondary_quantity" numeric(12, 2) NULL,
      ADD COLUMN IF NOT EXISTS "serial_numbers" jsonb NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "erp_stock_document_lines"
      DROP COLUMN IF EXISTS "serial_numbers",
      DROP COLUMN IF EXISTS "secondary_quantity"
    `);

    await q.query(`
      ALTER TABLE "inventory_fifo_batches"
      DROP COLUMN IF EXISTS "attributes",
      DROP COLUMN IF EXISTS "serial_numbers"
    `);

    await q.query(`
      ALTER TABLE "erp_stock_items"
      DROP COLUMN IF EXISTS "attributes",
      DROP COLUMN IF EXISTS "unit_ratio",
      DROP COLUMN IF EXISTS "secondary_unit",
      DROP COLUMN IF EXISTS "primary_unit"
    `);
  }
}
