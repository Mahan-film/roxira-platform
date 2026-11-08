import { QueryRunner } from 'typeorm';
import { TENANT_MATCH } from '../../../migrations/data/tenant-rls';
import {
  EnableRlsRemainingTenantTables1789900000600,
  REMAINING_RLS_TABLES,
} from '../../../migrations/1789900000600-EnableRlsRemainingTenantTables';

describe('EnableRlsRemainingTenantTables1789900000600', () => {
  it('covers all 42 remaining tenant tables without duplicates', () => {
    expect(REMAINING_RLS_TABLES).toHaveLength(42);
    expect(new Set(REMAINING_RLS_TABLES).size).toBe(42);
  });

  it('up() enables and forces RLS with the standard tenant policy on every table', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    } as unknown as QueryRunner;

    const migration = new EnableRlsRemainingTenantTables1789900000600();
    await migration.up(runner);

    expect(queries).toHaveLength(REMAINING_RLS_TABLES.length * 4);
    for (const table of REMAINING_RLS_TABLES) {
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

    const migration = new EnableRlsRemainingTenantTables1789900000600();
    await migration.down(runner);

    expect(queries).toHaveLength(REMAINING_RLS_TABLES.length * 3);
    const firstReversed = REMAINING_RLS_TABLES[REMAINING_RLS_TABLES.length - 1];
    expect(queries.slice(0, 3)).toEqual([
      `DROP POLICY IF EXISTS "${firstReversed}_tenant" ON "${firstReversed}"`,
      `ALTER TABLE "${firstReversed}" NO FORCE ROW LEVEL SECURITY`,
      `ALTER TABLE "${firstReversed}" DISABLE ROW LEVEL SECURITY`,
    ]);
  });
});
