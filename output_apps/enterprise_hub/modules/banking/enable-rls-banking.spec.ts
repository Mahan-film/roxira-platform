import { QueryRunner } from 'typeorm';
import {
  BANKING_RLS_TABLES,
  EnableRlsBanking1789900000900,
} from '../../migrations/1789900000900-EnableRlsBanking';

describe('EnableRlsBanking1789900000900', () => {
  it('enables and forces RLS on all 11 banking and reconciliation tables and reverts cleanly', async () => {
    expect(BANKING_RLS_TABLES).toEqual([
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
    ]);

    const queries: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    } as unknown as QueryRunner;

    const migration = new EnableRlsBanking1789900000900();
    await migration.up(runner);
    for (const table of BANKING_RLS_TABLES) {
      expect(queries.some((q) => q.includes(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`))).toBe(
        true,
      );
    }

    queries.length = 0;
    await migration.down(runner);
    for (const table of BANKING_RLS_TABLES) {
      expect(
        queries.some((q) => q.includes(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`)),
      ).toBe(true);
    }
  });
});
