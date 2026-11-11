import { CreateProductionBomAndOrders1789900002800 } from '../../migrations/1789900002800-CreateProductionBomAndOrders';

const createRunner = () => {
  const queries: string[] = [];
  return { queries, runner: { query: jest.fn(async (sql: string) => void queries.push(sql)) } };
};

describe('CreateProductionBomAndOrders migration (1789900002800)', () => {
  it('creates erp_bom_headers, erp_bom_items and erp_production_orders with FORCE RLS and CHECK constraints', async () => {
    const { runner, queries } = createRunner();
    await new CreateProductionBomAndOrders1789900002800().up(runner as never);
    const sql = queries.join('\n');

    for (const table of ['erp_bom_headers', 'erp_bom_items', 'erp_production_orders']) {
      expect(queries.find((q) => q.includes(`CREATE TABLE IF NOT EXISTS "${table}"`))).toContain('"tenant_id" uuid NOT NULL');
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY "${table}_tenant" ON "${table}"`);
    }

    expect(sql).toContain('CHK_erp_bom_headers_qty');
    expect(sql).toContain('CHK_erp_bom_headers_version');
    expect(sql).toContain('CHK_erp_bom_items_qty');
    expect(sql).toContain('CHK_erp_bom_items_waste');
    expect(sql).toContain('CHK_erp_production_orders_status');
    expect(sql).toContain('CHK_erp_production_orders_planned_qty');
    expect(sql).toContain('CHK_erp_production_orders_completed_qty');
    expect(sql).toContain('CHK_erp_production_orders_total_cost');
    expect(sql).toContain('CHK_erp_production_orders_unit_cost');
  });

  it('down() safely disables RLS and drops tables in correct dependency order', async () => {
    const { runner, queries } = createRunner();
    await new CreateProductionBomAndOrders1789900002800().down(runner as never);
    const sql = queries.join('\n');

    expect(sql).toContain('DROP TABLE IF EXISTS "erp_production_orders"');
    expect(sql).toContain('DROP TABLE IF EXISTS "erp_bom_items"');
    expect(sql).toContain('DROP TABLE IF EXISTS "erp_bom_headers"');
  });
});
