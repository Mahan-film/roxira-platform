/**
 * ورود کالا با بهای واحد و موجودی افتتاحیه روی PostgreSQL واقعی.
 *
 * همین رجیستری واقعی (`InventoryItemsRegistry`) را با رکوردهای نرمال‌شده
 * صدا می‌زند: لایه FIFO با بهای واحد ساخته می‌شود، سند حسابداری ثبت
 * نمی‌شود (کالای ۱۳۰۱ فقط در بستهٔ تراز افتتاحیه ثبت می‌شود)، ورود دوباره
 * بی‌اثر است، ردیف‌های نامعتبر هیچ ردیفی به‌جا نمی‌گذارند و شکست داخل
 * تراکنش کل ردیف را برمی‌گرداند. Skipped unless ROXIRA_TEST_PG_HOST is set.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55433 ROXIRA_TEST_PG_USER=postgres \
 *     npx jest modules/inventory/items-import-stock.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { FifoBatchEntity } from './entities/fifo-batch.entity';
import { StockItemEntity } from './entities/stock-item.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import { InventoryRepository } from './repositories/inventory.repository';
import { InventoryService } from './services/inventory.service';
import { InventoryItemsRegistry } from '../data_import/registry/inventory-items.registry';
import { NormalisedRecord } from '../data_import/registry/import-registry.types';

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

const record = (rowNumber: number, values: Record<string, unknown>): NormalisedRecord => ({
  rowNumber,
  values,
});

/** ردیف‌های اصلی نمونهٔ بریف: بهای واحد ریالی، موجودی و شماره دسته. */
const OPENING_RECORDS = [
  record(2, { sku: 'ITM-1', name: 'کالای یک', quantity: 88, unitCost: 14900000, batchNumber: 'LOT-1' }),
  record(3, { sku: 'ITM-2', name: 'کالای دو', quantity: 86, unitCost: 8900000 }),
  record(4, { sku: 'ITM-3', name: 'کالای سه', unitCost: 5000000 }),
];

describePg('items import with unit cost and opening stock on PostgreSQL', () => {
  const db = `items_import_${process.pid}`;
  let admin: DataSource;
  let ds: DataSource;
  let inventory: InventoryService;
  let registry: InventoryItemsRegistry;
  const q = <R = Record<string, string>>(sql: string, params: unknown[] = []) =>
    ds.query(sql, params) as Promise<R[]>;

  const layers = async () =>
    q<{ sku: string; batch_number: string; quantity_remaining: string; unit_purchase_cost: string; warehouse_id: number | null }>(
      `SELECT sku, batch_number, quantity_remaining, unit_purchase_cost, warehouse_id
       FROM inventory_fifo_batches WHERE tenant_id=$1 ORDER BY sku`,
      [T],
    );

  const itemQuantity = async (sku: string, tenant = T) => {
    const rows = await q<{ quantity: string }>(
      `SELECT quantity FROM erp_stock_items WHERE tenant_id=$1 AND sku=$2`,
      [tenant, sku],
    );
    return rows.length === 0 ? null : Number(rows[0].quantity);
  };

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
    registry = new InventoryItemsRegistry(inventory);
  }, 180_000);

  afterAll(async () => {
    await ds?.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.destroy();
  });

  it('creates the item plus its opening FIFO layer and never touches the journal', async () => {
    const before = await q(`SELECT 1 FROM fin_journal_entries WHERE tenant_id=$1`, [T]);
    expect(before).toHaveLength(0);

    const result = await registry.commit(T, OPENING_RECORDS);
    expect(result.inserted.map((r) => r.rowNumber)).toEqual([2, 3, 4]);
    expect(result.failed).toEqual([]);

    const batchRows = await layers();
    expect(batchRows).toHaveLength(2); // ITM-3 بدون موجودی، لایه‌ای ندارد
    expect(batchRows.map((b) => [b.sku, b.batch_number])).toEqual([
      ['ITM-1', 'LOT-1'],
      ['ITM-2', 'OPEN-ITM-2'],
    ]);
    expect(batchRows.map((b) => Number(b.quantity_remaining))).toEqual([88, 86]);
    expect(batchRows.map((b) => Number(b.unit_purchase_cost))).toEqual([14900000, 8900000]);

    expect(await itemQuantity('ITM-1')).toBe(88);
    expect(await itemQuantity('ITM-2')).toBe(86);
    expect(await itemQuantity('ITM-3')).toBe(0);

    const valuation = await inventory.getFifoValuation(T);
    expect(valuation.totalInventoryValue).toBe(88 * 14900000 + 86 * 8900000); // 2,076,600,000

    const after = await q(`SELECT 1 FROM fin_journal_entries WHERE tenant_id=$1`, [T]);
    expect(after).toHaveLength(0);
  });

  it('is idempotent: the same file again inserts nothing and a direct commit conflicts', async () => {
    // مسیر سرویس ورود داده: ابتدا کلیدهای تکراری بررسی و رد می‌شوند.
    const keys = OPENING_RECORDS.flatMap((r) => registry.duplicateKeys(r));
    const existing = await registry.findExistingDuplicateKeys(T, keys);
    expect(existing).toEqual(['sku:ITM-1', 'sku:ITM-2', 'sku:ITM-3']);

    const remaining = OPENING_RECORDS.filter(
      (r) => !registry.duplicateKeys(r).some((key) => existing.includes(key)),
    );
    expect(remaining).toEqual([]); // سرویس ورود داده هیچ ردیفی را برای commit نفرستاده است
    const filtered = await registry.commit(T, remaining);
    expect(filtered.inserted).toEqual([]);
    expect(filtered.failed).toEqual([]);

    // ولی اگر همین رکوردها مستقیم commit شوند، سه ردیف با Conflict رد می‌شوند.
    const direct = await registry.commit(T, OPENING_RECORDS);
    expect(direct.inserted).toEqual([]);
    expect(direct.failed.map((f) => f.rowNumber)).toEqual([2, 3, 4]);
    expect(direct.failed.every((f) => f.message.length > 0)).toBe(true);

    const valuation = await inventory.getFifoValuation(T);
    expect(valuation.totalInventoryValue).toBe(2076600000);
    expect(await layers()).toHaveLength(2);
  });

  it('rejects bad rows without leaving any item behind', async () => {
    const cases = [
      record(2, { sku: 'BAD-1', name: 'بدون بهای واحد', quantity: 5 }),
      record(3, { sku: 'BAD-2', name: 'موجودی سه‌رقم اعشار', quantity: 1.234, unitCost: 100 }),
      record(4, { sku: 'BAD-3', name: 'بهای اعشاری', quantity: 5, unitCost: 12.5 }),
      record(5, { sku: 'BAD-4', name: 'بهای منفی', quantity: 5, unitCost: -1 }),
    ];
    const result = await registry.commit(T, cases);
    expect(result.inserted).toEqual([]);
    expect(result.failed.map((f) => f.rowNumber)).toEqual([2, 3, 4, 5]);
    expect(result.failed.every((f) => f.message.length > 0)).toBe(true);

    for (const sku of ['BAD-1', 'BAD-2', 'BAD-3', 'BAD-4']) {
      expect(await itemQuantity(sku)).toBeNull();
    }
    const valuation = await inventory.getFifoValuation(T);
    expect(valuation.totalInventoryValue).toBe(2076600000);
  });

  it('puts the layer in the tenant\u2019s lowest-id active warehouse, or no warehouse at all', async () => {
    const w1 = await inventory.createWarehouse(T, { name: 'W1', locationCode: 'A-1' });
    const w2 = await inventory.createWarehouse(T, { name: 'W2', locationCode: 'A-2' });
    expect(w2.id).toBeGreaterThan(w1.id);

    const withWarehouse = await registry.commit(T, [
      record(2, { sku: 'WH-1', name: 'کالای انباردار', quantity: 3, unitCost: 100 }),
    ]);
    expect(withWarehouse.failed).toEqual([]);
    const whLayers = await q<{ sku: string; warehouse_id: number }>(
      `SELECT sku, warehouse_id FROM inventory_fifo_batches WHERE tenant_id=$1 AND sku='WH-1'`,
      [T],
    );
    expect(whLayers.map((l) => [l.sku, l.warehouse_id])).toEqual([['WH-1', w1.id]]);

    // مستأجر T2 هیچ انباری ندارد؛ لایه بدون انبار ساخته می‌شود.
    const withoutWarehouse = await registry.commit(T2, [
      record(2, { sku: 'WH-2', name: 'کالای بی‌انبار', quantity: 2, unitCost: 50 }),
    ]);
    expect(withoutWarehouse.failed).toEqual([]);
    const t2Layers = await q<{ sku: string; warehouse_id: number | null }>(
      `SELECT sku, warehouse_id FROM inventory_fifo_batches WHERE tenant_id=$1 AND sku='WH-2'`,
      [T2],
    );
    expect(t2Layers.map((l) => [l.sku, l.warehouse_id])).toEqual([['WH-2', null]]);
  });

  it('a failure inside the transaction rolls the whole item row back', async () => {
    const spy = jest
      .spyOn(inventory, 'receiveStock')
      .mockRejectedValueOnce(new Error('لایه ساخته نشد.'));
    try {
      const result = await registry.commit(T, [
        record(2, { sku: 'ATOM-1', name: 'کالای اتمی', quantity: 5, unitCost: 100 }),
      ]);
      expect(result.inserted).toEqual([]);
      expect(result.failed).toEqual([{ rowNumber: 2, message: 'لایه ساخته نشد.' }]);
      expect(await itemQuantity('ATOM-1')).toBeNull();
      const atomLayers = await q(
        `SELECT 1 FROM inventory_fifo_batches WHERE tenant_id=$1 AND sku='ATOM-1'`,
        [T],
      );
      expect(atomLayers).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
