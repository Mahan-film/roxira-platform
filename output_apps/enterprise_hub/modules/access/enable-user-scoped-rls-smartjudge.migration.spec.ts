import { EnableUserScopedRlsSmartJudge1789900012500 } from '../../migrations/1789900012500-EnableUserScopedRlsSmartJudge';

describe('EnableUserScopedRlsSmartJudge1789900012500 (#929 / T215)', () => {
  it('enables user-scoped RLS on all 6 Smart Judge tables with IF EXISTS guards', async () => {
    const queries: string[] = [];
    const qr = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return [];
      }),
    } as any;

    const migration = new EnableUserScopedRlsSmartJudge1789900012500();
    await migration.up(qr);

    expect(queries.length).toBe(1);
    const sql = queries[0];
    for (const table of [
      'chat_conversations',
      'chat_messages',
      'support_tickets',
      'payment_orders',
      'user_entitlements',
      'user_retrial_requests',
    ]) {
      expect(sql).toContain(`table_name = '${table}'`);
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`${table}_user_isolation`);
    }
    expect(sql).toContain("NULLIF(current_setting('app.current_user_ref', true), '')");
  });

  it('reverts policies and disables RLS cleanly in down()', async () => {
    const queries: string[] = [];
    const qr = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return [];
      }),
    } as any;

    const migration = new EnableUserScopedRlsSmartJudge1789900012500();
    await migration.down(qr);

    expect(queries.length).toBe(1);
    const sql = queries[0];
    expect(sql).toContain('DROP POLICY IF EXISTS');
    expect(sql).toContain('DISABLE ROW LEVEL SECURITY');
  });
});
