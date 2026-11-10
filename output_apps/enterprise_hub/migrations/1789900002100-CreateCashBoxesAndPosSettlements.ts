import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Cash boxes and POS settlements (Task T54 / #230):
 *   - `fin_cash_boxes`: physical cash boxes linked to general ledger account codes.
 *   - `fin_pos_settlements`: POS terminal batch settlement records with bank fee deductions.
 *   - Both protected with `ENABLE` + `FORCE ROW LEVEL SECURITY`.
 */
export class CreateCashBoxesAndPosSettlements1789900002100 implements MigrationInterface {
  name = 'CreateCashBoxesAndPosSettlements1789900002100';

  private readonly tableBoxes = 'fin_cash_boxes';
  private readonly tableSettlements = 'fin_pos_settlements';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "${this.tableBoxes}" (
        "id" SERIAL NOT NULL,
        "tenant_id" uuid NOT NULL,
        "name" varchar(128) NOT NULL,
        "code" varchar(32) NOT NULL,
        "ledger_account_id" integer NOT NULL,
        "currency" varchar(8) NOT NULL DEFAULT 'IRR',
        "opening_balance" numeric(18,2) NOT NULL DEFAULT 0,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fin_cash_boxes" PRIMARY KEY ("id")
      )
    `);

    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_cash_boxes_tenant_code"
        ON "${this.tableBoxes}" ("tenant_id", "code")
    `);

    await enableTenantRls(q, this.tableBoxes);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "${this.tableSettlements}" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "bank_account_id" integer NOT NULL,
        "terminal_number" varchar(64) NOT NULL,
        "date" date NOT NULL,
        "gross_amount" numeric(18,2) NOT NULL,
        "fee_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "net_amount" numeric(18,2) NOT NULL,
        "reference_number" varchar(64) NULL,
        "journal_entry_id" integer NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fin_pos_settlements" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fin_pos_settlements_amounts" CHECK ("gross_amount" = "fee_amount" + "net_amount")
      )
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_pos_settlements_tenant_date"
        ON "${this.tableSettlements}" ("tenant_id", "date" DESC)
    `);

    await enableTenantRls(q, this.tableSettlements);
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, this.tableSettlements);
    await q.query(`DROP TABLE IF EXISTS "${this.tableSettlements}"`);

    await disableTenantRls(q, this.tableBoxes);
    await q.query(`DROP TABLE IF EXISTS "${this.tableBoxes}"`);
  }
}
