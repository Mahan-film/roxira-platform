import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Landed costs on a goods receipt and their per-line allocations (#227 T2), tenant scoped.
 *
 * Money columns are bigint minor units (rial x 100); quantities are bigint hundredths. The cost
 * points at one receipt and each allocation at one receipt line; the shares, the on-hand part
 * (raises the FIFO layer) and the sold part (COGS) always add up to the amount, which the CHECK
 * constraints pin. `idempotency_key` is unique per tenant so a retried request returns the first
 * document. Both tables carry `tenant_id` and are created with FORCE row-level security. Purely
 * additive.
 *
 * Revert: `down()` disables the policies and drops the two tables (landed costs are lost).
 */
export class CreateLandedCosts1789700000002 implements MigrationInterface {
  name = 'CreateLandedCosts1789700000002';

  private readonly tables = ['erp_landed_costs', 'erp_landed_cost_allocations'];

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "erp_landed_costs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "receipt_id" uuid NOT NULL,
        "category" varchar(16) NOT NULL,
        "basis" varchar(8) NOT NULL,
        "amount" bigint NOT NULL,
        "cost_date" varchar(10) NOT NULL,
        "supplier_code" varchar(64) NOT NULL,
        "reference" varchar(128) NOT NULL,
        "idempotency_key" varchar(128),
        "inventory_amount" bigint NOT NULL DEFAULT 0,
        "cogs_amount" bigint NOT NULL DEFAULT 0,
        "journal_entry_id" varchar(64),
        "created_by" varchar(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_erp_landed_costs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_erp_landed_costs_receipt" FOREIGN KEY ("receipt_id")
          REFERENCES "erp_goods_receipts" ("id"),
        CONSTRAINT "UQ_erp_landed_costs_tenant_idempotency" UNIQUE ("tenant_id", "idempotency_key"),
        CONSTRAINT "CHK_erp_landed_costs_category"
          CHECK ("category" IN ('FREIGHT', 'CUSTOMS', 'INSURANCE', 'OTHER')),
        CONSTRAINT "CHK_erp_landed_costs_basis" CHECK ("basis" IN ('VALUE', 'QUANTITY', 'WEIGHT')),
        CONSTRAINT "CHK_erp_landed_costs_amount"
          CHECK ("amount" > 0 AND "amount" < 1000000000000000000),
        CONSTRAINT "CHK_erp_landed_costs_split"
          CHECK ("inventory_amount" >= 0 AND "cogs_amount" >= 0
                 AND "inventory_amount" + "cogs_amount" = "amount")
      )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_landed_costs_tenant_receipt" ON "erp_landed_costs" ("tenant_id", "receipt_id", "created_at")`,
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "erp_landed_cost_allocations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "landed_cost_id" uuid NOT NULL,
        "receipt_line_id" uuid NOT NULL,
        "sku" varchar(64) NOT NULL,
        "quantity" bigint NOT NULL,
        "basis_value" bigint NOT NULL,
        "share" bigint NOT NULL,
        "to_inventory" bigint NOT NULL DEFAULT 0,
        "to_cogs" bigint NOT NULL DEFAULT 0,
        "fifo_batch_id" int,
        CONSTRAINT "PK_erp_landed_cost_allocations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_erp_landed_cost_allocations_cost" FOREIGN KEY ("landed_cost_id")
          REFERENCES "erp_landed_costs" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_erp_landed_cost_allocations_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_erp_landed_cost_allocations_parts"
          CHECK ("basis_value" >= 0 AND "share" >= 0 AND "to_inventory" >= 0 AND "to_cogs" >= 0
                 AND "share" = "to_inventory" + "to_cogs")
      )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_landed_cost_allocations_tenant_cost" ON "erp_landed_cost_allocations" ("tenant_id", "landed_cost_id")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_landed_cost_allocations_tenant_receipt_line" ON "erp_landed_cost_allocations" ("tenant_id", "receipt_line_id")`,
    );

    for (const table of this.tables) {
      await enableTenantRls(q, table);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [...this.tables].reverse()) {
      await disableTenantRls(q, table);
    }
    await q.query(`DROP TABLE IF EXISTS "erp_landed_cost_allocations"`);
    await q.query(`DROP TABLE IF EXISTS "erp_landed_costs"`);
  }
}
