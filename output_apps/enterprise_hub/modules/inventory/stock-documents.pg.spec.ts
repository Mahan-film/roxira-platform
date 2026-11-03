/**
 * Receipts, deliveries and adjustments against a REAL PostgreSQL: receipts create FIFO layers at
 * the stated cost and date, deliveries consume them, adjustments keep the ledger equal to the
 * shelf, and the item list can show what has no stock. Skipped unless ROXIRA_TEST_PG_HOST is set.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55441 npx jest modules/inventory/stock-documents.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { CurrencyService } from '../currency/services/currency.service';
import { FifoBatchEntity } from './entities/fifo-batch.entity';
import { StockItemEntity } from './entities/stock-item.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import { InventoryRepository } from './repositories/inventory.repository';
import { StockDocumentsRepository } from './repositories/stock-documents.repository';
import { InventoryService } from './services/inventory.service';
import { StockDocumentsService } from './services/stock-documents.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const T = '11111111-1111-4111-8111-111111111111';

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

describePg('stock documents on PostgreSQL', () => {
  const db = `stockdocs_${process.pid}`;
  let admin: DataSource;
  let ds: DataSource;
  let inventory: InventoryService;
  let documents: StockDocumentsService;
  let wh: number;
  const q = <R = Record<string, string>>(sql: string, params: unknown[] = []) => ds.query(sql, params) as Promise<R[]>;

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${db}"`);
    ds = await new DataSource(options(db)).initialize();
    await ds.runMigrations();
    const accounting = new AccountingService(
      new AccountingRepository(new TenantScope(ds)),
      { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService,
    );
    inventory = new InventoryService(
      new InventoryRepository(
        ds.getRepository(WarehouseEntity),
        ds.getRepository(StockItemEntity),
        ds.getRepository(FifoBatchEntity),
        ds,
      ),
    );
    documents = new StockDocumentsService(new StockDocumentsRepository(ds), inventory, accounting);
    wh = (await inventory.createWarehouse(T, { name: 'اصلی', locationCode: 'M-1' })).id;
    for (const sku of ['D-1', 'D-2', 'D-3']) {
      await inventory.createStockItem(T, { sku, barcode: sku, name: `کالا ${sku}` } as never);
    }
  }, 180_000);

  afterAll(async () => {
    await ds?.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.destroy();
  });

  const qty = async (sku: string) =>
    Number((await q('SELECT quantity FROM erp_stock_items WHERE tenant_id=$1 AND sku=$2', [T, sku]))[0].quantity);

  it('a receipt creates one FIFO layer per line at the stated cost and document date', async () => {
    const doc = await documents.createReceipt(T, 'u1', {
      toWarehouseId: wh,
      docDate: '2026-03-01',
      reference: 'INV-SUP-9',
      lines: [
        { sku: 'D-1', quantity: 10, unitCost: 100 },
        { sku: 'D-2', quantity: 4, unitCost: 250.5 },
      ],
    });
    expect(doc.docNumber).toMatch(/^PR-20260301-\d{5}$/);
    expect(doc.totalValue).toBe(2002);
    const layers = await q<{ sku: string; received_date: Date; unit_purchase_cost: string }>(
      `SELECT sku, received_date, unit_purchase_cost FROM inventory_fifo_batches WHERE tenant_id=$1 ORDER BY sku`,
      [T],
    );
    expect(layers.map((l) => [l.sku, Number(l.unit_purchase_cost)])).toEqual([['D-1', 100], ['D-2', 250.5]]);
    expect(new Date(layers[0].received_date).toISOString().slice(0, 10)).toBe('2026-03-01');
    expect(await qty('D-1')).toBe(10);
    // A later receipt is a younger layer: the delivery takes the older cost first.
    await documents.createReceipt(T, 'u1', { toWarehouseId: wh, docDate: '2026-04-01', lines: [{ sku: 'D-1', quantity: 5, unitCost: 130 }] });
    const delivery = await documents.createDelivery(T, 'u1', { fromWarehouseId: wh, lines: [{ sku: 'D-1', quantity: 12 }] });
    expect(delivery.totalValue).toBe(10 * 100 + 2 * 130);
    expect(await qty('D-1')).toBe(3);
  });

  it('a delivery larger than the shelf is refused and leaves no document', async () => {
    const before = (await documents.list(T, { page: 1, limit: 100 })).total;
    await expect(
      documents.createDelivery(T, 'u1', { fromWarehouseId: wh, lines: [{ sku: 'D-2', quantity: 99 }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await documents.list(T, { page: 1, limit: 100 })).total).toBe(before);
  });

  it('an adjustment moves stock and posts one balanced voucher; a loss and a gain mirror', async () => {
    const loss = await documents.createAdjustment(T, 'u1', {
      warehouseId: wh,
      reason: 'انبارگردانی: ضایعات',
      lines: [{ sku: 'D-2', quantity: -1 }],
    });
    expect(loss.journalEntryId).not.toBeNull();
    expect(await qty('D-2')).toBe(3);
    const gain = await documents.createAdjustment(T, 'u1', {
      warehouseId: wh,
      reason: 'انبارگردانی: اضافه',
      lines: [{ sku: 'D-3', quantity: 2, unitCost: 40 }],
    });
    expect(await qty('D-3')).toBe(2);
    expect(gain.totalValue).toBe(80);

    const lines = await q<{ code: string; debit: string; credit: string }>(
      `SELECT a.code, l.debit, l.credit FROM fin_journal_entry_lines l JOIN fin_chart_of_accounts a ON a.id = l.account_id
       WHERE l.journal_entry_id = $1 ORDER BY l.id`,
      [loss.journalEntryId],
    );
    expect(lines).toHaveLength(2);
    expect(Number(lines[0].debit)).toBeCloseTo(250.5);
    expect(Number(lines[1].credit)).toBeCloseTo(250.5);
    expect(await q(`SELECT journal_entry_id FROM fin_journal_entry_lines GROUP BY journal_entry_id HAVING SUM(debit) <> SUM(credit)`)).toEqual([]);
  });

  it('a positive adjustment line needs a cost and a zero line is refused', async () => {
    await expect(
      documents.createAdjustment(T, 'u1', { warehouseId: wh, reason: 'x', lines: [{ sku: 'D-3', quantity: 1 }] }),
    ).rejects.toThrow(/بهای واحد/);
    await expect(
      documents.createAdjustment(T, 'u1', { warehouseId: wh, reason: 'x', lines: [{ sku: 'D-3', quantity: 0 }] }),
    ).rejects.toThrow(/صفر/);
  });

  it('the item list can show items with nothing on the shelf', async () => {
    await inventory.createStockItem(T, { sku: 'D-EMPTY', barcode: 'D-EMPTY', name: 'بدون موجودی' } as never);
    const result = await inventory.listStockItems(T, { page: 1, limit: 50, noStockOnly: true });
    expect(result.data.map((i) => i.sku)).toEqual(['D-EMPTY']);
    expect(result.noStockCount).toBe(1);
  });
});
