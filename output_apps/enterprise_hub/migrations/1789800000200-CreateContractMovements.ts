import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Contract movements (T3, #227): advance payments and retention releases, each posted once with its
 * voucher. Also keeps on a statement the statutory figures its deductions were computed from.
 */
export class CreateContractMovements1789800000200 implements MigrationInterface {
  name = 'CreateContractMovements1789800000200';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "erp_progress_statements" ADD COLUMN "terms_snapshot" jsonb`);
    await q.query(
      `CREATE TABLE "erp_contract_movements" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "contract_id" integer NOT NULL,
        "kind" character varying(24) NOT NULL,
        "movement_date" date NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "request_key" character varying(64),
        "terms_snapshot" jsonb,
        "journal_entry_id" integer,
        "journal_entry_number" character varying(64),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_erp_contract_movements_kind" CHECK ("kind" IN ('advance','retention_release')),
        CONSTRAINT "CHK_erp_contract_movements_amount" CHECK ("amount" > 0),
        CONSTRAINT "FK_erp_contract_movements_contract" FOREIGN KEY ("tenant_id", "contract_id") REFERENCES "erp_contracts" ("tenant_id", "id") ON DELETE RESTRICT
      )`,
    );
    await q.query(`CREATE UNIQUE INDEX "UQ_erp_contract_movements_key" ON "erp_contract_movements" ("tenant_id", "contract_id", "kind", "request_key") WHERE "request_key" IS NOT NULL`);
    await q.query(`CREATE INDEX "IDX_erp_contract_movements_contract" ON "erp_contract_movements" ("tenant_id", "contract_id", "kind")`);
    await enableTenantRls(q, 'erp_contract_movements');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'erp_contract_movements');
    await q.query(`DROP TABLE IF EXISTS "erp_contract_movements"`);
    await q.query(`ALTER TABLE "erp_progress_statements" DROP COLUMN "terms_snapshot"`);
  }
}
