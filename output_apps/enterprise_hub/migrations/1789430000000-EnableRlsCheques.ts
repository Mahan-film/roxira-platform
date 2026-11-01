import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Row-level security for the cheque register (RLS rollout batch 1, the pilot).
 *
 * ChequesRepository runs every query through TenantScope, which sets `app.tenant_id` for the
 * transaction. The policies make that setting the only way to see or write a row, so a repository
 * bug can no longer leak another tenant's cheques. Reversible; no data is touched.
 *
 * Deploy order: this needs the repository change from the same PR. Rows are invisible to any
 * session that does not set app.tenant_id, except a superuser / BYPASSRLS role.
 */
export class EnableRlsCheques1789430000000 implements MigrationInterface {
  name = 'EnableRlsCheques1789430000000';

  public async up(q: QueryRunner): Promise<void> {
    await enableTenantRls(q, 'fin_cheques');
    await enableTenantRls(q, 'fin_cheque_events');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'fin_cheque_events');
    await disableTenantRls(q, 'fin_cheques');
  }
}
