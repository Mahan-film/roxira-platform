import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

export const BANKING_RLS_TABLES = [
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
] as const;

export class EnableRlsBanking1789900000900 implements MigrationInterface {
  name = 'EnableRlsBanking1789900000900';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of BANKING_RLS_TABLES) {
      await enableTenantRls(queryRunner, table);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [...BANKING_RLS_TABLES].reverse()) {
      await disableTenantRls(queryRunner, table);
    }
  }
}
