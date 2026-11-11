import { CreateTreasurySmsDrafts1789900003200 } from '../../migrations/1789900003200-CreateTreasurySmsDrafts';

const runner = () => {
  const queries: string[] = [];
  return { queries, q: { query: jest.fn(async (sql: string) => void queries.push(sql)) } };
};

describe('CreateTreasurySmsDrafts migration (T92)', () => {
  it('creates fin_treasury_sms_drafts with tenant_id and FORCE row level security', async () => {
    const { q, queries } = runner();
    await new CreateTreasurySmsDrafts1789900003200().up(q as never);
    const sql = queries.join('\n');

    expect(queries.find((x) => x.includes('CREATE TABLE IF NOT EXISTS "fin_treasury_sms_drafts"'))).toContain('"tenant_id" uuid NOT NULL');
    expect(sql).toContain('ALTER TABLE "fin_treasury_sms_drafts" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "fin_treasury_sms_drafts" FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY "fin_treasury_sms_drafts_tenant"');
    expect(sql).toContain('IDX_fin_treasury_sms_drafts_tenant_status');
    expect(sql).toContain('IDX_fin_treasury_sms_drafts_tenant_created');
  });

  it('down() removes policies and drops table', async () => {
    const { q, queries } = runner();
    await new CreateTreasurySmsDrafts1789900003200().down(q as never);
    const sql = queries.join('\n');

    expect(sql).toContain('DROP POLICY IF EXISTS "fin_treasury_sms_drafts_tenant"');
    expect(sql).toContain('DROP TABLE IF EXISTS "fin_treasury_sms_drafts"');
  });
});
