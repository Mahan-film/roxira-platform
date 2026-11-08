import { QueryRunner } from 'typeorm';
import { TENANT_MATCH } from '../../migrations/data/tenant-rls';
import {
  CRM_RLS_TABLES,
  EnableRlsCrm1789900000700,
} from '../../migrations/1789900000700-EnableRlsCrm';

describe('EnableRlsCrm1789900000700', () => {
  it('covers crm_leads and crm_activities without duplicates', () => {
    expect(CRM_RLS_TABLES).toEqual(['crm_leads', 'crm_activities']);
    expect(new Set(CRM_RLS_TABLES).size).toBe(2);
  });

  it('up() enables and forces RLS with the standard tenant policy on both CRM tables', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    } as unknown as QueryRunner;

    const migration = new EnableRlsCrm1789900000700();
    await migration.up(runner);

    expect(queries).toHaveLength(CRM_RLS_TABLES.length * 4);
    for (const table of CRM_RLS_TABLES) {
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

    const migration = new EnableRlsCrm1789900000700();
    await migration.down(runner);

    expect(queries).toHaveLength(CRM_RLS_TABLES.length * 3);
    const firstReversed = CRM_RLS_TABLES[CRM_RLS_TABLES.length - 1];
    expect(queries.slice(0, 3)).toEqual([
      `DROP POLICY IF EXISTS "${firstReversed}_tenant" ON "${firstReversed}"`,
      `ALTER TABLE "${firstReversed}" NO FORCE ROW LEVEL SECURITY`,
      `ALTER TABLE "${firstReversed}" DISABLE ROW LEVEL SECURITY`,
    ]);
  });
});
