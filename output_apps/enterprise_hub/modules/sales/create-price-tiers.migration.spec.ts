import { CreatePriceTiersAndCommissions1789900002600 } from '../../migrations/1789900002600-CreatePriceTiersAndCommissions';

const createRunner = () => {
  const queries: string[] = [];
  return { queries, runner: { query: jest.fn(async (sql: string) => void queries.push(sql)) } };
};

describe('CreatePriceTiersAndCommissions migration (1789900002600)', () => {
  it('creates erp_price_tiers and erp_sales_commission_policies with FORCE RLS and CHECK constraints', async () => {
    const { runner, queries } = createRunner();
    await new CreatePriceTiersAndCommissions1789900002600().up(runner as never);
    const sql = queries.join('\n');

    expect(sql).toContain('ALTER TABLE "erp_parties"');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "customer_group"');
    expect(sql).toContain('CHK_erp_parties_customer_group');

    for (const table of ['erp_price_tiers', 'erp_sales_commission_policies']) {
      expect(queries.find((q) => q.includes(`CREATE TABLE IF NOT EXISTS "${table}"`))).toContain('"tenant_id" uuid NOT NULL');
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY "${table}_tenant" ON "${table}"`);
    }

    expect(sql).toContain('CHK_erp_price_tiers_price');
    expect(sql).toContain('CHK_erp_price_tiers_discount');
    expect(sql).toContain('CHK_erp_price_tiers_group');
    expect(sql).toContain('CHK_erp_sales_comm_rate');
  });

  it('down() safely disables RLS and drops tables/columns', async () => {
    const { runner, queries } = createRunner();
    await new CreatePriceTiersAndCommissions1789900002600().down(runner as never);
    const sql = queries.join('\n');

    expect(sql).toContain('DROP TABLE IF EXISTS "erp_sales_commission_policies"');
    expect(sql).toContain('DROP TABLE IF EXISTS "erp_price_tiers"');
    expect(sql).toContain('ALTER TABLE "erp_parties" DROP COLUMN IF EXISTS "customer_group"');
  });
});
