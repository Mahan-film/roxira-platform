import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Row-level security for CRM tables (#475, #619).
 *
 * Enables and forces row-level security on `crm_leads` and `crm_activities`
 * after moving `CrmRepository` and `CrmActivityRepository` onto `TenantScope`.
 * (`contact_messages` and `enterprise_inquiries` have nullable `tenant_id` for
 * unauthenticated public forms and are handled separately per #475.)
 */
export const CRM_RLS_TABLES = ['crm_leads', 'crm_activities'] as const;

export class EnableRlsCrm1789900000700 implements MigrationInterface {
  name = 'EnableRlsCrm1789900000700';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of CRM_RLS_TABLES) {
      await enableTenantRls(q, table);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [...CRM_RLS_TABLES].reverse()) {
      await disableTenantRls(q, table);
    }
  }
}
