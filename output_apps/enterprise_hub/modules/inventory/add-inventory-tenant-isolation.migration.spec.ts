import { AddInventoryTenantIsolation1789170000000 } from '../../migrations/1789170000000-AddInventoryTenantIsolation';

/** Runner ساختگی TypeORM که SQL اجراشده را ثبت می‌کند (بدون پایگاه‌داده). */
const createRunner = () => {
  const queries: string[] = [];
  const params: unknown[][] = [];
  const runner = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      queries.push(sql);
      params.push(values ?? []);
      return undefined;
    }),
  };
  return { runner, queries, params };
};

describe('AddInventoryTenantIsolation migration', () => {
  it('exports a class exposing up() and down()', () => {
    const migration = new AddInventoryTenantIsolation1789170000000();
    expect(migration.name).toBe('AddInventoryTenantIsolation1789170000000');
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });

  it('adds tenant_id, backfills and enforces NOT NULL on every table', async () => {
    const { runner, queries, params } = createRunner();
    await new AddInventoryTenantIsolation1789170000000().up(runner as never);

    const sql = queries.join('\n');
    for (const table of [
      'erp_warehouses',
      'erp_stock_items',
      'inventory_fifo_batches',
    ]) {
      expect(sql).toContain(
        `"${table}" ADD COLUMN IF NOT EXISTS "tenant_id" uuid`,
      );
      expect(sql).toContain(
        `UPDATE "${table}" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL`,
      );
      expect(sql).toContain(
        `"${table}" ALTER COLUMN "tenant_id" SET NOT NULL`,
      );
    }
    expect(params.flat()).toContain('00000000-0000-0000-0000-000000000001');
  });

  it('drops the real global unique indexes and creates composite uniques', async () => {
    const { runner, queries } = createRunner();
    await new AddInventoryTenantIsolation1789170000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('DROP INDEX IF EXISTS "ix_erp_warehouses_name"');
    expect(sql).toContain('DROP INDEX IF EXISTS "ix_erp_stock_items_sku"');
    expect(sql).toContain('IDX_erp_warehouses_tenant_name');
    expect(sql).toContain('("tenant_id", "name")');
    expect(sql).toContain('IDX_erp_stock_items_tenant_sku');
    expect(sql).toContain('("tenant_id", "sku")');
  });

  it('creates tenant query indexes for batches and barcode', async () => {
    const { runner, queries } = createRunner();
    await new AddInventoryTenantIsolation1789170000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('IDX_erp_stock_items_tenant_barcode');
    expect(sql).toContain('IDX_inventory_fifo_batches_tenant_sku_received');
    expect(sql).toContain('("tenant_id", "sku", "received_date")');
    expect(sql).toContain('IDX_inventory_fifo_batches_tenant_warehouse');
    expect(sql).toContain('("tenant_id", "warehouse_id")');
  });

  it('down() restores the global uniques and drops tenant artifacts', async () => {
    const { runner, queries } = createRunner();
    await new AddInventoryTenantIsolation1789170000000().down(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "ix_erp_warehouses_name"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "ix_erp_stock_items_sku"',
    );
    for (const table of [
      'erp_warehouses',
      'erp_stock_items',
      'inventory_fifo_batches',
    ]) {
      expect(sql).toContain(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "tenant_id"`,
      );
    }
  });
});
