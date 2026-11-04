/**
 * The "below reorder point" list (E2.1, I-02) against a REAL PostgreSQL: an item is on the list
 * when it has a minimum (> 0) and its stock is at or below it; editing the minimum moves it on
 * or off the list; another tenant's items never show. Skipped unless ROXIRA_TEST_PG_HOST is set.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55441 npx jest modules/inventory/reorder-point.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { QueryStockItemDto } from './dto/query-stock-item.dto';
import { FifoBatchEntity } from './entities/fifo-batch.entity';
import { StockItemEntity } from './entities/stock-item.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import { InventoryRepository } from './repositories/inventory.repository';
import { InventoryService } from './services/inventory.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const T = '11111111-1111-4111-8111-111111111111';
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

const query = (extra: Partial<QueryStockItemDto> = {}) =>
  ({ page: 1, limit: 100, lowStockOnly: true, noStockOnly: false, ...extra }) as QueryStockItemDto;

describePg('below reorder point list on PostgreSQL', () => {
  const db = `reorder_${process.pid}`;
  let admin: DataSource;
  let ds: DataSource;
  let inventory: InventoryService;
  const ids: Record<string, number> = {};

  const below = async (tenant = T, extra: Partial<QueryStockItemDto> = {}) =>
    (await inventory.listStockItems(tenant, query(extra))).data.map((item) => item.sku).sort();

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
    const items: Array<[string, number, number]> = [
      ['R-BELOW', 3, 10],
      ['R-AT', 5, 5],
      ['R-ABOVE', 12, 10],
      ['R-NOMIN', 0, 0],
      ['R-FRAC', 0.25, 0.5],
    ];
    for (const [sku, quantity, minQuantity] of items) {
      const created = await inventory.createStockItem(T, {
        sku,
        barcode: `B-${sku}`,
        name: `کالای ${sku}`,
        quantity,
        minQuantity,
      } as never);
      ids[sku] = created.id;
    }
    ids.OTHER = (
      await inventory.createStockItem(T2, {
        sku: 'R-OTHER',
        barcode: 'B-OTHER',
        name: 'کالای مستاجر دیگر',
        quantity: 1,
        minQuantity: 100,
      } as never)
    ).id;
  }, 180_000);

  afterAll(async () => {
    await ds?.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.destroy();
  });

  it('lists items at or below a positive minimum, and only those', async () => {
    expect(await below()).toEqual(['R-AT', 'R-BELOW', 'R-FRAC']);
    const result = await inventory.listStockItems(T, query());
    expect(result.total).toBe(3);
    expect(result.data.every((item) => item.isLowStock)).toBe(true);
  });

  it('lowStockOnly=false lists every item', async () => {
    expect(await below(T, { lowStockOnly: false })).toEqual(['R-ABOVE', 'R-AT', 'R-BELOW', 'R-FRAC', 'R-NOMIN']);
  });

  it('search narrows the list, so the export matches the table', async () => {
    expect(await below(T, { search: 'BELOW' })).toEqual(['R-BELOW']);
  });

  it('editing the minimum moves an item on or off the list', async () => {
    await inventory.updateStockItem(T, ids['R-ABOVE'], { minQuantity: 12 });
    await inventory.updateStockItem(T, ids['R-BELOW'], { minQuantity: 0 });
    expect(await below()).toEqual(['R-ABOVE', 'R-AT', 'R-FRAC']);
    const row = await ds.query(`SELECT min_quantity FROM erp_stock_items WHERE id = $1`, [ids['R-ABOVE']]);
    expect(Number(row[0].min_quantity)).toBe(12);
  });

  it("never shows or edits another tenant's items", async () => {
    expect(await below(T)).not.toContain('R-OTHER');
    expect(await below(T2)).toEqual(['R-OTHER']);
    await expect(inventory.updateStockItem(T, ids.OTHER, { minQuantity: 0 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await below(T2)).toEqual(['R-OTHER']);
  });
});
