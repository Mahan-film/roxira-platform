import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Row-level security for all remaining 42 tenant tables (#475).
 *
 * Enables and forces row-level security with the standard `tenant_id` policy
 * (`"tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid` for both
 * USING and WITH CHECK) on every public table carrying `tenant_id` that did not yet
 * have FORCE RLS. Reversible; no data is modified.
 */
export const REMAINING_RLS_TABLES = [
  // Auth & tenant access
  'auth_refresh_tokens',
  'tenant_invitations',
  'tenant_memberships',
  'tenant_module_entitlements',
  'tenant_module_requests',
  'users',
  // Invoice capture
  'capture_audit',
  'capture_documents',
  'capture_files',
  'capture_settings',
  'capture_vendor_rules',
  'capture_vendors',
  // CRM & inquiries
  'contact_messages',
  'crm_activities',
  'crm_leads',
  'enterprise_inquiries',
  // Damages & data import
  'damage_calculations',
  'data_import_batch_items',
  'data_import_batches',
  'data_import_mapping_memory',
  // Inventory & stock
  'erp_stock_document_lines',
  'erp_stock_documents',
  'erp_stock_items',
  'erp_stores',
  'erp_warehouses',
  'inventory_fifo_batches',
  // Banking & reconciliation
  'fin_bank_accounts',
  'fin_bank_recon_attachments',
  'fin_bank_recon_audit',
  'fin_bank_recon_drafts',
  'fin_bank_recon_items',
  'fin_bank_recon_matches',
  'fin_bank_recon_reports',
  'fin_bank_recon_rules',
  'fin_bank_recon_sessions',
  'fin_bank_recon_settings',
  'fin_bank_statement_lines',
  // Invoicing & tax compliance
  'invoices',
  'moadian_credentials',
  'moadian_submissions',
  'tax_invoice_signatures',
  'tax_signing_keys',
] as const;

export class EnableRlsRemainingTenantTables1789900000600 implements MigrationInterface {
  name = 'EnableRlsRemainingTenantTables1789900000600';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of REMAINING_RLS_TABLES) {
      await enableTenantRls(q, table);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [...REMAINING_RLS_TABLES].reverse()) {
      await disableTenantRls(q, table);
    }
  }
}
