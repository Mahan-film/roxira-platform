import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Row-level security for Invoice Capture tables (#475, #621).
 *
 * Enables and forces row-level security on all 6 `capture_*` tables after
 * moving `CaptureRepository` and `SeasonalReportRepository` onto `TenantScope`.
 */
export const CAPTURE_RLS_TABLES = [
  'capture_audit',
  'capture_documents',
  'capture_files',
  'capture_settings',
  'capture_vendor_rules',
  'capture_vendors',
] as const;

export class EnableRlsCapture1789900000800 implements MigrationInterface {
  name = 'EnableRlsCapture1789900000800';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of CAPTURE_RLS_TABLES) {
      await enableTenantRls(q, table);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [...CAPTURE_RLS_TABLES].reverse()) {
      await disableTenantRls(q, table);
    }
  }
}
