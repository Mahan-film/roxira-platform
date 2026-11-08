import { QueryRunner } from 'typeorm';
import {
  EnableRlsInventory1789900001100,
  INVENTORY_RLS_TABLES,
} from '../../migrations/1789900001100-EnableRlsInventory';

describe('EnableRlsInventory1789900001100', () => {
  it('enables and forces RLS on all 6 inventory and ERP stock tables and reverts cleanly', async () => {
    expect(INVENTORY_RLS_TABLES).toEqual([
      'erp_stock_document_lines',
      'erp_stock_documents',
      'erp_stock_items',
      'erp_stores',
      'erp_warehouses',
      'inventory_fifo_batches',
    ]);

    const queries: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    } as unknown as QueryRunner;

    const migration = new EnableRlsInventory1789900001100();
    await migration.up(runner);
    for (const table of INVENTORY_RLS_TABLES) {
      expect(queries.some((q) => q.includes(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`))).toBe(
        true,
      );
    }

    queries.length = 0;
    await migration.down(runner);
    for (const table of INVENTORY_RLS_TABLES) {
      expect(
        queries.some((q) => q.includes(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`)),
      ).toBe(true);
    }
  });
});
