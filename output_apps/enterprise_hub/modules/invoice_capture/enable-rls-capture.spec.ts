import { QueryRunner } from 'typeorm';
import { TENANT_MATCH } from '../../migrations/data/tenant-rls';
import {
  CAPTURE_RLS_TABLES,
  EnableRlsCapture1789900000800,
} from '../../migrations/1789900000800-EnableRlsCapture';

describe('EnableRlsCapture1789900000800', () => {
  it('covers all 6 capture tables without duplicates', () => {
    expect(CAPTURE_RLS_TABLES).toEqual([
      'capture_audit',
      'capture_documents',
      'capture_files',
      'capture_settings',
      'capture_vendor_rules',
      'capture_vendors',
    ]);
    expect(new Set(CAPTURE_RLS_TABLES).size).toBe(6);
  });

  it('up() enables and forces RLS with the standard tenant policy on all 6 capture tables', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    } as unknown as QueryRunner;

    const migration = new EnableRlsCapture1789900000800();
    await migration.up(runner);

    expect(queries).toHaveLength(CAPTURE_RLS_TABLES.length * 4);
    for (const table of CAPTURE_RLS_TABLES) {
      expect(queries).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(queries).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      expect(queries).toContain(`DROP POLICY IF EXISTS "${table}_tenant" ON "${table}"`);
      expect(queries).toContain(
        `CREATE POLICY "${table}_tenant" ON "${table}" USING (${TENANT_MATCH}) WITH CHECK (${TENANT_MATCH})`,
      );
    }
  });

  it('down() drops the policy and disables FORCE and RLS in reverse order', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    } as unknown as QueryRunner;

    const migration = new EnableRlsCapture1789900000800();
    await migration.down(runner);

    expect(queries).toHaveLength(CAPTURE_RLS_TABLES.length * 3);
    const firstReversed = CAPTURE_RLS_TABLES[CAPTURE_RLS_TABLES.length - 1];
    expect(queries.slice(0, 3)).toEqual([
      `DROP POLICY IF EXISTS "${firstReversed}_tenant" ON "${firstReversed}"`,
      `ALTER TABLE "${firstReversed}" NO FORCE ROW LEVEL SECURITY`,
      `ALTER TABLE "${firstReversed}" DISABLE ROW LEVEL SECURITY`,
    ]);
  });
});
