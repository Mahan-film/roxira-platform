/**
 * Stock cardex and stock balance reports on a REAL PostgreSQL: the fixture data is made through the
 * real stock-document services, tenant B's stock never leaks into tenant A's reports or the other way
 * around, and the report value/quantity tie out to `inventory_fifo_batches` (so the per-layer transfer
 * replay matches what FIFO actually did). Skipped unless ROXIRA_TEST_PG_HOST is set; each run creates
 * and drops its own database.
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FifoBatchEntity } from './entities/fifo-batch.entity';
import { StockItemEntity } from './entities/stock-item.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import { InventoryRepository } from './repositories/inventory.repository';
import { StockDocumentsRepository } from './repositories/stock-documents.repository';
import { InventoryService } from './services/inventory.service';
import { StockDocumentsService } from './services/stock-documents.service';
import { ReportExportService } from '../accounting/services/report-export.service';
import { StockReportService } from './services/stock-report.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const AS_OF = '2026-05-31';

interface BalanceJson {
  asOf: string;
  lines: Array<{ itemId: string; warehouseId: string | null; quantity: string; value: number; shortageQty: string }>;
  items: Array<{ itemId: string; quantity: string; value: number; shortageQty: string }>;
  alerts: Array<{ itemId: string; quantity: string; reorderPoint: string; shortfall: string }>;
}
interface CardexJson {
  sku: string;
  opening: { quantity: string; value: number };
  rows: Array<{ date: string; document: string; inQty: string; outQty: string; runningQty: string; runningValue: number }>;
  closing: { quantity: string; value: number };
  shortageQty: string;
}

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

/** Money the report sends as a number, back to exact minor units. */
const minor = (value: number): bigint => BigInt(Math.round(value * 100));

describePg('stock reports on PostgreSQL', () => {
  const db = `stock_reports_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let ds: DataSource;
  let inventory: InventoryService;
  let documents: StockDocumentsService;
  let reports: StockReportService;
  let a1: number;
  let a2: number;
  const q = <R = Record<string, string>>(sql: string, params: unknown[] = []) => ds.query(sql, params) as Promise<R[]>;

  const balance = async (tenant: string, asOf = AS_OF): Promise<BalanceJson> =>
    (await reports.stockBalanceReport(tenant, { asOf })).json as BalanceJson;
  const cardex = async (tenant: string, sku: string): Promise<CardexJson> =>
    (await reports.cardexReport(tenant, { sku })).json as CardexJson;

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${db}"`);
    ds = await new DataSource(options(db)).initialize();
    await ds.runMigrations();

    const inventoryRepo = new InventoryRepository(
      ds.getRepository(WarehouseEntity),
      ds.getRepository(StockItemEntity),
      ds.getRepository(FifoBatchEntity),
      ds,
    );
    inventory = new InventoryService(inventoryRepo);
    const docRepo = new StockDocumentsRepository(ds);
    documents = new StockDocumentsService(docRepo, inventory);
    reports = new StockReportService(docRepo, inventoryRepo);

    // Tenant A: two layers at different costs in w1, then a 12-unit transfer to w2 and a 3-unit delivery.
    a1 = (await inventory.createWarehouse(T1, { name: 'A-1', locationCode: 'A-1' })).id;
    a2 = (await inventory.createWarehouse(T1, { name: 'A-2', locationCode: 'A-2' })).id;
    await inventory.createStockItem(T1, { sku: 'A-1', barcode: 'A-1', name: 'کالای ای' } as never);
    await documents.createReceipt(T1, 'u1', { toWarehouseId: a1, docDate: '2026-05-01', lines: [{ sku: 'A-1', quantity: 10, unitCost: 100 }] });
    await documents.createReceipt(T1, 'u1', { toWarehouseId: a1, docDate: '2026-05-02', lines: [{ sku: 'A-1', quantity: 5, unitCost: 200 }] });
    await documents.createTransfer(T1, 'u1', { fromWarehouseId: a1, toWarehouseId: a2, docDate: '2026-05-03', lines: [{ sku: 'A-1', quantity: 12 }] });
    await documents.createDelivery(T1, 'u1', { fromWarehouseId: a2, docDate: '2026-05-03', lines: [{ sku: 'A-1', quantity: 3 }] });

    // Tenant B: the same SKU with different quantities, plus a SKU only it has.
    const b1 = await inventory.createWarehouse(T2, { name: 'B-1', locationCode: 'B-1' });
    await inventory.createStockItem(T2, { sku: 'A-1', barcode: 'A-1', name: 'کالای بی' } as never);
    await inventory.createStockItem(T2, { sku: 'B-ONLY', barcode: 'B-ONLY', name: 'فقط بی' } as never);
    await documents.createReceipt(T2, 'u1', { toWarehouseId: b1.id, docDate: '2026-05-01', lines: [{ sku: 'A-1', quantity: 4, unitCost: 900 }] });
    await documents.createReceipt(T2, 'u1', { toWarehouseId: b1.id, docDate: '2026-05-01', lines: [{ sku: 'B-ONLY', quantity: 6, unitCost: 70 }] });
  }, 180_000);

  afterAll(async () => {
    await ds?.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.destroy();
  });

  const sqlTotals = async (tenant: string) => {
    const [row] = await q<{ value_minor: string; qty_hundredths: string }>(
      `SELECT COALESCE(SUM(quantity_remaining * unit_purchase_cost) * 100, 0) AS value_minor,
              COALESCE(SUM(quantity_remaining) * 100, 0) AS qty_hundredths
       FROM inventory_fifo_batches WHERE tenant_id = $1 AND quantity_remaining > 0`,
      [tenant],
    );
    return { valueMinor: BigInt(Math.round(Number(row.value_minor))), qtyHundredths: BigInt(Math.round(Number(row.qty_hundredths))) };
  };

  const sqlWarehouse = async (tenant: string, warehouseId: number) => {
    const [row] = await q<{ value_minor: string; qty_hundredths: string }>(
      `SELECT COALESCE(SUM(quantity_remaining * unit_purchase_cost) * 100, 0) AS value_minor,
              COALESCE(SUM(quantity_remaining) * 100, 0) AS qty_hundredths
       FROM inventory_fifo_batches WHERE tenant_id = $1 AND warehouse_id = $2 AND quantity_remaining > 0`,
      [tenant, warehouseId],
    );
    return { valueMinor: BigInt(Math.round(Number(row.value_minor))), qtyHundredths: BigInt(Math.round(Number(row.qty_hundredths))) };
  };

  const sqlSku = async (tenant: string, sku: string) => {
    const [row] = await q<{ value_minor: string; qty_hundredths: string }>(
      `SELECT COALESCE(SUM(quantity_remaining * unit_purchase_cost) * 100, 0) AS value_minor,
              COALESCE(SUM(quantity_remaining) * 100, 0) AS qty_hundredths
       FROM inventory_fifo_batches WHERE tenant_id = $1 AND sku = $2 AND quantity_remaining > 0`,
      [tenant, sku],
    );
    return { valueMinor: BigInt(Math.round(Number(row.value_minor))), qtyHundredths: BigInt(Math.round(Number(row.qty_hundredths))) };
  };

  it('shows only the tenant\'s own stock: B has the same SKU and A never sees B (nor B A)', async () => {
    const aBalance = await balance(T1);
    expect(aBalance.items.map((item) => item.itemId)).toEqual(['A-1']);
    expect(aBalance.items.find((item) => item.itemId === 'A-1')).toEqual({
      itemId: 'A-1',
      quantity: '12.00',
      value: 1700,
      shortageQty: '0.00',
    });
    expect(aBalance.lines.some((line) => line.itemId === 'B-ONLY')).toBe(false);

    const bBalance = await balance(T2);
    expect(bBalance.items.map((item) => item.itemId).sort()).toEqual(['A-1', 'B-ONLY']);
    expect(bBalance.items.find((item) => item.itemId === 'A-1')!.value).toBe(3600); // 4 @ 900
    expect(bBalance.items.find((item) => item.itemId === 'B-ONLY')!.value).toBe(420); // 6 @ 70

    expect((await cardex(T1, 'A-1')).closing).toEqual({ quantity: '12.00', value: 1700 });
    expect((await cardex(T2, 'A-1')).closing).toEqual({ quantity: '4.00', value: 3600 });
    await expect(reports.cardexReport(T1, { sku: 'B-ONLY' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ties the balance value and quantity out to inventory_fifo_batches, overall and per item', async () => {
    const json = await balance(T1);
    const totalValue = json.lines.reduce((sum, line) => sum + minor(line.value), 0n);
    const totalQty = BigInt(json.lines.reduce((sum, line) => sum + Math.round(Number(line.quantity) * 100), 0));
    const dbTotals = await sqlTotals(T1);
    expect(totalValue).toBe(dbTotals.valueMinor);
    expect(totalQty).toBe(dbTotals.qtyHundredths);

    // The item total is the sum of its warehouse lines and matches the DB for that SKU.
    const item = json.items.find((row) => row.itemId === 'A-1')!;
    const dbItem = await sqlSku(T1, 'A-1');
    expect(minor(item.value)).toBe(dbItem.valueMinor);
    expect(BigInt(Math.round(Number(item.quantity) * 100))).toBe(dbItem.qtyHundredths);
    expect(item.quantity).toBe('12.00');
  });

  it('splits the transferred value per layer, one warehouse at a time', async () => {
    const json = await balance(T1);
    const w1 = json.lines.find((line) => line.warehouseId === String(a1))!;
    const w2 = json.lines.find((line) => line.warehouseId === String(a2))!;

    // Receipts put 10 @100 and 5 @200 in w1 (1000 + 1000 rial).
    // The transfer out takes 10 @100 + 2 @200 = 1240 rial, leaving w1 with 3 @200 = 600.
    // The transfer in re-creates w2's 10 @100 and 2 @200 (1240); a delivery of 3 @100 (300) leaves
    // w2 with 7 @100 + 2 @200 = 9 units worth 700 + 400 = 1100 rial.
    // A single blended transfer line (12 @ 1240/12 = 103.33) would have split this differently.
    expect(w1.quantity).toBe('3.00');
    expect(w1.value).toBe(600);
    expect(w2.quantity).toBe('9.00');
    expect(w2.value).toBe(1100);

    const dbW1 = await sqlWarehouse(T1, a1);
    const dbW2 = await sqlWarehouse(T1, a2);
    expect(minor(w1.value)).toBe(dbW1.valueMinor);
    expect(BigInt(Math.round(Number(w1.quantity) * 100))).toBe(dbW1.qtyHundredths);
    expect(minor(w2.value)).toBe(dbW2.valueMinor);
    expect(BigInt(Math.round(Number(w2.quantity) * 100))).toBe(dbW2.qtyHundredths);
  });

  it('rejects a reversed cardex range and a range with no movements', async () => {
    await expect(reports.cardexReport(T1, { sku: 'A-1', from: '2026-06-01', to: '2026-05-01' })).rejects.toBeInstanceOf(BadRequestException);
    const empty = await reports.cardexReport(T1, { sku: 'A-1', from: '2025-01-01', to: '2025-01-31' });
    const json = empty.json as CardexJson;
    expect(json.rows).toEqual([]);
    expect(json.opening).toEqual({ quantity: '0.00', value: 0 });
    expect(json.closing).toEqual({ quantity: '0.00', value: 0 });
  });
  it('renders both reports as XLSX and PDF files', async () => {
    const exporter = new ReportExportService(undefined as never);
    const tables = [
      (await reports.cardexReport(T1, { sku: 'A-1' })).table,
      (await reports.stockBalanceReport(T1, { asOf: AS_OF })).table,
      (await reports.stockBalanceReport(T1, { asOf: AS_OF, view: 'reorder' })).table,
    ];
    for (const table of tables) {
      expect((await exporter.render(table, 'xlsx', 'r')).body.subarray(0, 2).toString()).toBe('PK');
      expect((await exporter.render(table, 'pdf', 'r')).body.subarray(0, 4).toString()).toBe('%PDF');
    }
  });
});
