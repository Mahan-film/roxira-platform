/**
 * Stores, warehouses and transfers against a REAL PostgreSQL. Skipped unless ROXIRA_TEST_PG_HOST
 * is set; each run creates and drops its own database:
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55441 npx jest modules/inventory/stock-transfer.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FifoBatchEntity } from './entities/fifo-batch.entity';
import { StockItemEntity } from './entities/stock-item.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import { InventoryRepository } from './repositories/inventory.repository';
import { StockDocumentsRepository } from './repositories/stock-documents.repository';
import { InventoryService } from './services/inventory.service';
import { StockDocumentsService } from './services/stock-documents.service';
import { StoresService } from './services/stores.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const options = (database: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username: USER,
  database,
  entities: [path.join(__dirname, '../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('stores, warehouses and transfers on PostgreSQL', () => {
  const db = `transfer_${process.pid}`;
  let admin: DataSource;
  let ds: DataSource;
  let inventory: InventoryService;
  let documents: StockDocumentsService;
  let stores: StoresService;
  const q = <R = Record<string, string>>(sql: string, params: unknown[] = []) => ds.query(sql, params) as Promise<R[]>;

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${db}"`);
    ds = await new DataSource(options(db)).initialize();
    await ds.runMigrations();
    inventory = new InventoryService(
      new InventoryRepository(
        ds.getRepository(WarehouseEntity),
        ds.getRepository(StockItemEntity),
        ds.getRepository(FifoBatchEntity),
        ds,
      ),
    );
    const docRepo = new StockDocumentsRepository(ds);
    documents = new StockDocumentsService(docRepo);
    stores = new StoresService(docRepo);
  }, 180_000);

  afterAll(async () => {
    await ds?.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.destroy();
  });

  const layers = (tenant: string, warehouseId: number) =>
    q<{ quantity_remaining: string; unit_purchase_cost: string; received_date: Date }>(
      `SELECT quantity_remaining, unit_purchase_cost, received_date FROM inventory_fifo_batches
       WHERE tenant_id=$1 AND warehouse_id=$2 AND quantity_remaining > 0 ORDER BY received_date, id`,
      [tenant, warehouseId],
    );

  it('groups warehouses under a store, refuses duplicates and cross-tenant stores', async () => {
    const shop = await stores.create(T1, { code: 'VNK', name: 'ونک' });
    await expect(stores.create(T1, { code: 'VNK', name: 'other' })).rejects.toBeInstanceOf(ConflictException);
    await expect(stores.create(T1, { code: 'X2', name: 'ونک' })).rejects.toBeInstanceOf(ConflictException);
    const otherTenantStore = await stores.create(T2, { code: 'VNK', name: 'ونک' }); // same code is fine elsewhere
    const wh = await inventory.createWarehouse(T1, { name: 'انبار ونک', locationCode: 'VNK-1', storeId: shop.id });
    expect(wh.storeId).toBe(shop.id);
    await expect(
      inventory.createWarehouse(T1, { name: 'x2', locationCode: 'X-1', storeId: otherTenantStore.id }),
    ).rejects.toThrow(/یافت نشد/);
    expect((await stores.list(T1))[0].warehouseCount).toBe(1);
  });

  it('transfers FIFO layers keeping cost and date; item total unchanged; atomic on shortage', async () => {
    const a = await inventory.createWarehouse(T1, { name: 'A', locationCode: 'A-1' });
    const b = await inventory.createWarehouse(T1, { name: 'B', locationCode: 'B-1' });
    await inventory.createStockItem(T1, { sku: 'TR-1', barcode: 'TR-1', name: 'تست انتقال' } as never);
    await inventory.receiveStock(T1, { sku: 'TR-1', quantity: 10, unitPurchaseCost: 100, warehouseId: a.id } as never);
    await inventory.receiveStock(T1, { sku: 'TR-1', quantity: 5, unitPurchaseCost: 120, warehouseId: a.id } as never);

    const doc = await documents.createTransfer(T1, 'u1', {
      fromWarehouseId: a.id,
      toWarehouseId: b.id,
      lines: [{ sku: 'TR-1', quantity: 12 }],
    });
    expect(doc.docNumber).toMatch(/^TR-\d{8}-\d{5}$/);
    expect(doc.lines).toHaveLength(1);
    // 10 @100 + 2 @120 = 1240
    expect(doc.totalValue).toBe(1240);

    const atA = await layers(T1, a.id);
    const atB = await layers(T1, b.id);
    expect(atA.map((l) => [Number(l.quantity_remaining), Number(l.unit_purchase_cost)])).toEqual([[3, 120]]);
    expect(atB.map((l) => [Number(l.quantity_remaining), Number(l.unit_purchase_cost)])).toEqual([
      [10, 100],
      [2, 120],
    ]);
    // Oldest layer stays oldest at the destination.
    expect(new Date(atB[0].received_date).getTime()).toBeLessThanOrEqual(new Date(atB[1].received_date).getTime());
    expect(Number((await q('SELECT quantity FROM erp_stock_items WHERE sku=$1', ['TR-1']))[0].quantity)).toBe(15);

    // A shortage on the second line rolls the first back.
    await inventory.createStockItem(T1, { sku: 'TR-2', barcode: 'TR-2', name: 'دوم' } as never);
    await inventory.receiveStock(T1, { sku: 'TR-2', quantity: 1, unitPurchaseCost: 5, warehouseId: a.id } as never);
    await expect(
      documents.createTransfer(T1, 'u1', {
        fromWarehouseId: a.id,
        toWarehouseId: b.id,
        lines: [
          { sku: 'TR-1', quantity: 1 },
          { sku: 'TR-2', quantity: 2 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await layers(T1, a.id)).map((l) => Number(l.quantity_remaining))).toEqual([3, 1]);
    expect((await documents.list(T1, { page: 1, limit: 20 })).total).toBe(1);
  });

  it('rejects same-warehouse and other-tenant transfers; inactive warehouses take nothing', async () => {
    const a = (await inventory.listWarehouses(T1)).find((w) => w.name === 'A')!;
    await expect(
      documents.createTransfer(T1, 'u1', { fromWarehouseId: a.id, toWarehouseId: a.id, lines: [{ sku: 'TR-1', quantity: 1 }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const foreign = await inventory.createWarehouse(T2, { name: 'F', locationCode: 'F-1' });
    await expect(
      documents.createTransfer(T1, 'u1', { fromWarehouseId: a.id, toWarehouseId: foreign.id, lines: [{ sku: 'TR-1', quantity: 1 }] }),
    ).rejects.toThrow(/یافت نشد/);
    await expect(inventory.updateWarehouse(T1, a.id, { isActive: false })).rejects.toBeInstanceOf(ConflictException);

    const empty = await inventory.createWarehouse(T1, { name: 'E', locationCode: 'E-1' });
    await inventory.updateWarehouse(T1, empty.id, { isActive: false });
    await expect(
      documents.createTransfer(T1, 'u1', { fromWarehouseId: a.id, toWarehouseId: empty.id, lines: [{ sku: 'TR-1', quantity: 1 }] }),
    ).rejects.toThrow(/غیرفعال/);
    await expect(
      inventory.receiveStock(T1, { sku: 'TR-1', quantity: 1, unitPurchaseCost: 1, warehouseId: empty.id } as never),
    ).rejects.toThrow(/غیرفعال/);
  });

  it('migration down removes the new objects and up restores them', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    const names = ['erp_stores', 'erp_stock_documents', 'erp_stock_document_lines'];
    const exist = async () =>
      (await runner.query(`SELECT table_name FROM information_schema.tables WHERE table_name = ANY($1)`, [names])).length;
    expect(await exist()).toBe(3);
    const { CreateStoresAndStockDocuments1789440000000: M } = await import('../../migrations/1789440000000-CreateStoresAndStockDocuments');
    await new M().down(runner);
    expect(await exist()).toBe(0);
    await new M().up(runner);
    expect(await exist()).toBe(3);
    await runner.release();
  });
});
