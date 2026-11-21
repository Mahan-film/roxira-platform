/**
 * T209: runs as the shared NOSUPERUSER NOBYPASSRLS app role with two tenants and proves that
 * `InventoryRepository.findStoreById` goes through TenantScope: tenant B cannot read tenant A's store.
 */
import { FifoBatchEntity } from './entities/fifo-batch.entity';
import { StockItemEntity } from './entities/stock-item.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import { InventoryRepository } from './repositories/inventory.repository';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as TENANT_A,
  TEST_T2 as TENANT_B,
} from '../../test/support/test-pg';

describePg('InventoryRepository.findStoreById (NOSUPERUSER NOBYPASSRLS, two tenants)', () => {
  let testDb: TestDatabaseContext;
  let repo: InventoryRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase('t209inv');
    repo = new InventoryRepository(
      testDb.app.getRepository(WarehouseEntity),
      testDb.app.getRepository(StockItemEntity),
      testDb.app.getRepository(FifoBatchEntity),
      testDb.app,
      testDb.scope,
    );
  }, 180_000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('returns the own tenant store and null for another tenant', async () => {
    const [{ id }] = await testDb.rawQuery<{ id: number }>(
      `INSERT INTO erp_stores (tenant_id, code, name) VALUES ($1, 'S1', 'Store A') RETURNING id`,
      [TENANT_A],
    );

    expect((await repo.findStoreById(TENANT_A, id))?.name).toBe('Store A');
    expect(await repo.findStoreById(TENANT_B, id)).toBeNull();
  });

  it('a bare connection without app.tenant_id sees no store rows (RLS), the scoped path still works', async () => {
    const [{ id }] = await testDb.rawQuery<{ id: number }>(
      `INSERT INTO erp_stores (tenant_id, code, name) VALUES ($1, 'S2', 'Store A2') RETURNING id`,
      [TENANT_A],
    );

    expect(await testDb.app.query(`SELECT id FROM erp_stores WHERE id = $1`, [id])).toEqual([]);
    expect((await repo.findStoreById(TENANT_A, id))?.id).toBe(id);
  });
});
