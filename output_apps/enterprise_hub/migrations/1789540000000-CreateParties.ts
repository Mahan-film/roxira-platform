import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Party master: customers and suppliers of a tenant, keyed by a per-tenant code. A party with
 * role 'both' acts as customer and supplier at once. Every treasury document, invoice and ledger
 * line references a party by that code; this table is the source of truth for codes and names.
 *
 * The table carries `tenant_id`, is created with FORCE row-level security in the same migration,
 * and is only reached through PartiesRepository, which runs inside TenantScope. Purely additive.
 */
export class CreateParties1789540000000 implements MigrationInterface {
  name = 'CreateParties1789540000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE IF NOT EXISTS "erp_parties" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "code" character varying(64) NOT NULL,
        "name" character varying(200) NOT NULL,
        "role" character varying(16) NOT NULL,
        "national_id" character varying(20),
        "economic_code" character varying(20),
        "phone" character varying(32),
        "email" character varying(254),
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_erp_parties_role" CHECK ("role" IN ('customer','supplier','both')),
        CONSTRAINT "CHK_erp_parties_code" CHECK ("code" <> ''),
        CONSTRAINT "CHK_erp_parties_name" CHECK ("name" <> '')
      )`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_erp_parties_tenant_code" ON "erp_parties" ("tenant_id", "code")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_parties_tenant_role_active" ON "erp_parties" ("tenant_id", "role", "active")`,
    );
    await enableTenantRls(q, 'erp_parties');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'erp_parties');
    await q.query(`DROP TABLE IF EXISTS "erp_parties"`);
  }
}
