import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * T184 per-tenant statement settings: `auto_post_exact` (default false) lets an import post the voucher
 * of an exact reference + equal amount match by itself. Off, every match waits for a person's
 * confirmation. Tenant-scoped with ENABLE + FORCE ROW LEVEL SECURITY.
 */
export class CreateBankStatementSettings1789900011520 implements MigrationInterface {
  name = 'CreateBankStatementSettings1789900011520';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "fin_bank_stmt_settings" (
        "tenant_id" uuid NOT NULL,
        "auto_post_exact" boolean NOT NULL DEFAULT false,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fin_bank_stmt_settings" PRIMARY KEY ("tenant_id")
      )
    `);
    await enableTenantRls(q, 'fin_bank_stmt_settings');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'fin_bank_stmt_settings');
    await q.query(`DROP TABLE IF EXISTS "fin_bank_stmt_settings"`);
  }
}
