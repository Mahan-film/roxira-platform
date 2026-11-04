import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Row-level security for the general ledger (RLS rollout batch 2).
 *
 * AccountingRepository and LedgerReportRepository run every query through TenantScope, and a
 * caller's transaction (cheques, payroll, invoicing, bank reconciliation...) is bound to the
 * tenant before any ledger statement. Foreign keys and the existing integrity triggers are
 * unaffected: FK checks bypass RLS and the triggers run in the same tenant context.
 * Reversible; no data is touched.
 */
const TABLES = [
  'fin_chart_of_accounts',
  'fin_journal_entries',
  'fin_journal_entry_lines',
  'fin_period_locks',
  'fin_balance_reconciliation_log',
];

export class EnableRlsLedger1789440000000 implements MigrationInterface {
  name = 'EnableRlsLedger1789440000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of TABLES) await enableTenantRls(q, table);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [...TABLES].reverse()) await disableTenantRls(q, table);
  }
}
