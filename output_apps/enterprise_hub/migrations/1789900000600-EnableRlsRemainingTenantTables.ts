import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Row-level security for Invoicing & Tax Compliance / Moadian tables (#475, #617).
 *
 * Enables and forces row-level security with the standard `tenant_id` policy
 * (`"tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid` for both
 * USING and WITH CHECK) after moving `InvoicingRepository`, `MoadianRepository`,
 * `TaxComplianceRepository`, and `SeasonalReportRepository` onto `TenantScope`.
 */
export const INVOICING_AND_TAX_RLS_TABLES = [
  'invoices',
  'moadian_credentials',
  'moadian_submissions',
  'tax_invoice_signatures',
  'tax_signing_keys',
] as const;

export class EnableRlsRemainingTenantTables1789900000600 implements MigrationInterface {
  name = 'EnableRlsRemainingTenantTables1789900000600';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of INVOICING_AND_TAX_RLS_TABLES) {
      await enableTenantRls(q, table);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [...INVOICING_AND_TAX_RLS_TABLES].reverse()) {
      await disableTenantRls(q, table);
    }
  }
}
