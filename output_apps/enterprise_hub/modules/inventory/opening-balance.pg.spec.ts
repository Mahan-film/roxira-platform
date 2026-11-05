/**
 * The reviewed opening-balance flow against a REAL PostgreSQL: nothing is invented (empty cells
 * stay empty), problems block posting, the poster must echo the reviewed figures, and posting
 * creates dated FIFO layers and one balanced voucher. Skipped unless ROXIRA_TEST_PG_HOST is set.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55441 npx jest modules/inventory/opening-balance.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { CurrencyService } from '../currency/services/currency.service';
import { FifoBatchEntity } from './entities/fifo-batch.entity';
import { StockItemEntity } from './entities/stock-item.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { InventoryRepository } from './repositories/inventory.repository';
import { StockDocumentsRepository } from './repositories/stock-documents.repository';
import { InventoryService } from './services/inventory.service';
import { OpeningBalanceService } from './services/opening-balance.service';
import { StockDocumentsService } from './services/stock-documents.service';

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

describePg('opening balances on PostgreSQL', () => {
  const db = `opening_${process.pid}`;
  let admin: DataSource;
  let ds: DataSource;
  let inventory: InventoryService;
  let openings: OpeningBalanceService;
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
    const repo = new StockDocumentsRepository(ds);
    const documents = new StockDocumentsService(
      repo,
      inventory,
      accounting,
      new PostingRulesService(new PostingRulesRepository(new TenantScope(ds)), accounting),
    );
    openings = new OpeningBalanceService(repo, documents, inventory);
    wh = (await inventory.createWarehouse(T, { name: 'انبار اصلی', locationCode: 'A-1' })).id;
    for (const sku of ['O-1', 'O-2', 'O-3', 'O-4']) {
      await inventory.createStockItem(T, { sku, barcode: sku, name: `کالای ${sku}` } as never);
    }
    await inventory.createStockItem(T, { sku: '=EVIL', barcode: 'E', name: '=cmd|calc' } as never);
  }, 180_000);

  afterAll(async () => {
    await ds?.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.destroy();
  });

  it('the template lists every item without stock, empty cells, spreadsheet formulas neutralised', async () => {
    const csv = await openings.template(T);
    const rows = csv.split('\n');
    expect(rows[0]).toBe('sku,barcode,name,quantity,unit_cost');
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.endsWith(',,'))).toHaveLength(5);
    expect(rows.some((r) => r.startsWith("'=EVIL"))).toBe(true);
    expect(await openings.template(T2)).toBe('sku,barcode,name,quantity,unit_cost');
  });

  let draftId: number;

  it('a draft holds only what was entered: zero lines are dropped, nothing is defaulted', async () => {
    const draft = await openings.createDraft(T, 'u1', { toWarehouseId: wh, docDate: '2026-01-01' });
    draftId = draft.documentId;
    expect(draft).toMatchObject({ status: 'DRAFT', lineCount: 0, canPost: false, itemsStillWithoutStock: 5 });
    const review = await openings.replaceLines(T, draftId, [
      { sku: 'O-1', quantity: 10, unitCost: 100 },
      { sku: 'O-2', quantity: 0, unitCost: 5 },
      { sku: 'O-3', quantity: 4, unitCost: 0 },
      { sku: 'NOPE', quantity: 1, unitCost: 1 },
      { sku: 'O-1', quantity: 1, unitCost: 100 },
    ]);
    expect(review.lineCount).toBe(4);
    expect(review.problems.map((p) => p.code).sort()).toEqual(['DUPLICATE_SKU', 'MISSING_COST', 'UNKNOWN_SKU']);
    expect(review.canPost).toBe(false);
    await expect(openings.markReviewed(T, 'u1', draftId).then((r) => r.canPost)).resolves.toBe(false);
    await expect(openings.post(T, 'u1', draftId, { lineCount: 4, totalValue: 1100 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a clean draft still needs review, and editing the lines clears the review', async () => {
    let review = await openings.replaceLines(T, draftId, [
      { sku: 'O-1', quantity: 10, unitCost: 100 },
      { sku: 'O-3', quantity: 4, unitCost: 25.5 },
    ]);
    expect(review).toMatchObject({ problems: [], reviewed: false, canPost: false, lineCount: 2, totalValue: 1102, itemsStillWithoutStock: 3 });
    await expect(openings.post(T, 'u1', draftId, { lineCount: 2, totalValue: 1102 })).rejects.toThrow(/بازبینی/);
    review = await openings.markReviewed(T, 'u1', draftId);
    expect(review).toMatchObject({ reviewed: true, canPost: true });
    review = await openings.replaceLines(T, draftId, [
      { sku: 'O-1', quantity: 10, unitCost: 100 },
      { sku: 'O-3', quantity: 4, unitCost: 25.5 },
    ]);
    expect(review.reviewed).toBe(false);
    await openings.markReviewed(T, 'u1', draftId);
  });

  it('posting needs the reviewed figures echoed back', async () => {
    await expect(openings.post(T, 'u1', draftId, { lineCount: 2, totalValue: 1000 })).rejects.toBeInstanceOf(ConflictException);
    await expect(openings.post(T, 'u1', draftId, { lineCount: 3, totalValue: 1102 })).rejects.toBeInstanceOf(ConflictException);
    expect(await q(`SELECT 1 FROM inventory_fifo_batches WHERE tenant_id=$1`, [T])).toHaveLength(0);
  });

  it('posting creates dated FIFO layers and one balanced voucher; the document is then frozen', async () => {
    const posted = await openings.post(T, 'u1', draftId, { lineCount: 2, totalValue: 1102 });
    expect(posted).toMatchObject({ status: 'POSTED', canPost: false });

    const layers = await q<{ sku: string; received_date: Date; unit_purchase_cost: string; warehouse_id: number }>(
      `SELECT sku, received_date, unit_purchase_cost, warehouse_id FROM inventory_fifo_batches WHERE tenant_id=$1 ORDER BY sku`,
      [T],
    );
    expect(layers.map((l) => [l.sku, Number(l.unit_purchase_cost), l.warehouse_id])).toEqual([['O-1', 100, wh], ['O-3', 25.5, wh]]);
    expect(new Date(layers[0].received_date).toISOString().slice(0, 10)).toBe('2026-01-01');
    const doc = (await q<{ journal_entry_id: number }>(`SELECT journal_entry_id FROM erp_stock_documents WHERE id=$1`, [draftId]))[0];
    const lines = await q<{ code: string; debit: string; credit: string }>(
      `SELECT a.code, l.debit, l.credit FROM fin_journal_entry_lines l JOIN fin_chart_of_accounts a ON a.id=l.account_id WHERE l.journal_entry_id=$1 ORDER BY l.id`,
      [doc.journal_entry_id],
    );
    expect(lines.map((l) => [l.code, Number(l.debit), Number(l.credit)])).toEqual([['1030', 1102, 0], ['3030', 0, 1102]]);

    await expect(openings.replaceLines(T, draftId, [])).rejects.toBeInstanceOf(ConflictException);
    await expect(openings.deleteDraft(T, draftId)).rejects.toBeInstanceOf(ConflictException);
    // The untouched items still show as "no stock": no number was invented for them.
    expect((await inventory.listStockItems(T, { page: 1, limit: 50, noStockOnly: true })).data.map((i) => i.sku).sort()).toEqual(['=EVIL', 'O-2', 'O-4']);
  });

  it('a second opening over an item that already has stock is blocked', async () => {
    const second = await openings.createDraft(T, 'u1', { toWarehouseId: wh, docDate: '2026-01-01' });
    const review = await openings.replaceLines(T, second.documentId, [{ sku: 'O-1', quantity: 1, unitCost: 100 }]);
    expect(review.problems.map((p) => p.code)).toEqual(['ALREADY_HAS_STOCK']);
    await openings.deleteDraft(T, second.documentId);
    expect(await q(`SELECT 1 FROM erp_stock_documents WHERE id=$1`, [second.documentId])).toHaveLength(0);
  });

  it('another tenant cannot see or change the draft', async () => {
    const mine = await openings.createDraft(T, 'u1', { toWarehouseId: wh, docDate: '2026-02-01' });
    await expect(openings.review(T2, mine.documentId)).rejects.toThrow(/یافت نشد/);
    await expect(openings.replaceLines(T2, mine.documentId, [])).rejects.toThrow(/یافت نشد/);
    await expect(openings.deleteDraft(T2, mine.documentId)).rejects.toThrow(/یافت نشد/);
  });
});
