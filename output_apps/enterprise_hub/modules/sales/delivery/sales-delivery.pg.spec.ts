/**
 * Delivery notes with partial delivery on a REAL PostgreSQL as a non-superuser role (#536, T1):
 * the order lock, over-delivery refusal, FIFO stock out through the real inventory service, the
 * SALES_DELIVERY stock document, the COGS voucher through the real posting engine (replay safe
 * under the `sales_delivery` source key), the order-line bump, fulfilment/backorder reporting,
 * idempotency, rollback and FORCE RLS on the two new tables.
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set. Each run creates and
 * drops its own database and role. Optional: ROXIRA_TEST_PG_USER, ROXIRA_TEST_PG_PORT, ROXIRA_TEST_PG_PASSWORD.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55433 ROXIRA_TEST_PG_USER=postgres npx jest --runInBand modules/sales/delivery/sales-delivery.pg.spec.ts
 */
import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { AccountingRepository } from '../../accounting/repositories/accounting.repository';
import { AccountingService } from '../../accounting/services/accounting.service';
import { CurrencyService } from '../../currency/services/currency.service';
import { PartyRole } from '../../parties/enums/party-role.enum';
import { PartiesRepository } from '../../parties/repositories/parties.repository';
import { PartiesService } from '../../parties/services/parties.service';
import { PostingRulesRepository } from '../../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { FifoBatchEntity } from '../../inventory/entities/fifo-batch.entity';
import { StockItemEntity } from '../../inventory/entities/stock-item.entity';
import { WarehouseEntity } from '../../inventory/entities/warehouse.entity';
import { InventoryRepository } from '../../inventory/repositories/inventory.repository';
import { StockDocumentsRepository } from '../../inventory/repositories/stock-documents.repository';
import { InventoryService } from '../../inventory/services/inventory.service';
import { StockDocumentsService } from '../../inventory/services/stock-documents.service';
import { SalesRepository } from '../repositories/sales.repository';
import { SalesService } from '../services/sales.service';
import { SalesAvailabilityService } from '../services/sales-availability.service';
import { SalesDeliveryRepository } from './repositories/sales-delivery.repository';
import { SalesDeliveryService } from './services/sales-delivery.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'sales-app-test-only';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const NEW_TABLES = ['erp_sales_deliveries', 'erp_sales_delivery_lines'];

const options = (database: string, username = OWNER, password = OWNER_PW) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  password,
  database,
  entities: [path.join(__dirname, '../../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('Sales delivery notes on PostgreSQL (non-superuser, real posting engine)', () => {
  const db = `rx_deliv_${process.pid}_${Date.now()}`;
  const role = `rx_dlv_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let sales: SalesService;
  let availability: SalesAvailabilityService;
  let inventory: InventoryService;
  let deliveries: SalesDeliveryService;
  let postingRules: PostingRulesService;
  let warehouseId: number;
  let itemA: number;
  let orderId: number;
  let orderLineId: number;
  let d1: { id: number; journalEntryId: number | null };

  const q = <R = Record<string, string>>(sql: string, params: unknown[] = []) => app.query(sql, params) as Promise<R[]>;

  /** A raw read inside one tenant-bound transaction, for tables with FORCE RLS. */
  const scoped = async <R = Record<string, string>>(sql: string, params: unknown[] = [], tenant = T1): Promise<R[]> =>
    app.transaction(async (m) => {
      await TenantScope.bind(m, tenant);
      return m.query(sql, params) as Promise<R[]>;
    });

  const qty = async (sku: string) =>
    Number((await q('SELECT quantity FROM erp_stock_items WHERE tenant_id=$1 AND sku=$2', [T1, sku]))[0].quantity);
  const deliveryCount = async () =>
    Number((await scoped('SELECT count(*)::int AS c FROM erp_sales_deliveries WHERE tenant_id=$1', [T1]))[0].c);
  const stockDocCount = async () =>
    Number(
      (await q(`SELECT count(*)::int AS c FROM erp_stock_documents WHERE tenant_id=$1 AND doc_type='SALES_DELIVERY'`, [T1]))[0]
        .c,
    );
  const voucherCount = async () =>
    Number(
      (await scoped(`SELECT count(*)::int AS c FROM fin_posting_sources WHERE tenant_id=$1 AND source_type='sales_delivery'`, [
        T1,
      ]))[0].c,
    );

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_PW}'`);
    owner = await new DataSource(options(db)).initialize();
    await owner.runMigrations();
    await owner.query(`GRANT CONNECT ON DATABASE "${db}" TO ${role}`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    app = await new DataSource({ ...options(db, role, APP_PW), extra: { max: 8 } }).initialize();

    const scope = new TenantScope(app);
    const parties = new PartiesService(new PartiesRepository(scope));
    const salesRepo = new SalesRepository(scope);
    sales = new SalesService(salesRepo, parties);
    availability = new SalesAvailabilityService(salesRepo);
    inventory = new InventoryService(
      new InventoryRepository(
        app.getRepository(WarehouseEntity),
        app.getRepository(StockItemEntity),
        app.getRepository(FifoBatchEntity),
        app,
      ),
      availability,
    );
    const accounting = new AccountingService(
      new AccountingRepository(new TenantScope(app)),
      { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService,
    );
    const stockDocsRepository = new StockDocumentsRepository(app);
    const stockDocuments = new StockDocumentsService(stockDocsRepository, inventory, accounting);
    postingRules = new PostingRulesService(new PostingRulesRepository(new TenantScope(app)), accounting);
    deliveries = new SalesDeliveryService(
      salesRepo,
      new SalesDeliveryRepository(scope),
      inventory,
      stockDocuments,
      stockDocsRepository,
      postingRules,
    );

    await owner
      .query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [T1, T1.slice(0, 8)])
      .catch(() => undefined);
    await owner
      .query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [T2, T2.slice(0, 8)])
      .catch(() => undefined);
    await parties.create(T1, { code: 'CUST', name: 'مشتری نمونه', role: PartyRole.CUSTOMER } as never);
    await owner.query(
      `INSERT INTO erp_stock_items (tenant_id, sku, barcode, name, quantity, min_quantity) VALUES ($1, 'A', 'A', 'کالا A', 0, 0)`,
      [T1],
    );
    const items = await owner.query<Array<{ id: number; sku: string }>>(`SELECT id, sku FROM erp_stock_items WHERE tenant_id = $1`, [
      T1,
    ]);
    itemA = Number(items.find((row) => row.sku === 'A')!.id);
    const [warehouse] = await owner.query<Array<{ id: number }>>(
      `INSERT INTO erp_warehouses (tenant_id, name, location_code, is_active) VALUES ($1, 'انبار مرکزی', 'W-1', true) RETURNING id`,
      [T1],
    );
    warehouseId = Number(warehouse.id);

    // Two FIFO layers through the real receipt path: 5 at 1,000 then 10 at 1,200 (on-hand 15).
    await inventory.receiveStock(T1, {
      sku: 'A',
      quantity: 5,
      unitPurchaseCost: 1000,
      warehouseId,
      receivedAt: '2026-01-01T12:00:00.000Z',
      batchNumber: 'L1',
    } as never);
    await inventory.receiveStock(T1, {
      sku: 'A',
      quantity: 10,
      unitPurchaseCost: 1200,
      warehouseId,
      receivedAt: '2026-02-01T12:00:00.000Z',
      batchNumber: 'L2',
    } as never);
    expect(await qty('A')).toBe(15);

    // Confirmed order O for 12 of A at 2,000.
    const order = await sales.createOrder(T1, {
      partyCode: 'CUST',
      warehouseId,
      orderDate: '2026-05-03',
      lines: [{ itemId: itemA, quantity: 12, unitPrice: 2000 }],
    } as never);
    await sales.confirmOrder(T1, order.id);
    orderId = order.id;
    orderLineId = order.lines![0].id;
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('delivery 1 takes layer 1 only: cost 4,000, one balanced voucher, available unchanged', async () => {
    expect((await availability.availability(T1, [itemA]))[0]).toMatchObject({ onHand: 15, reserved: 12, available: 3 });
    const delivery = await deliveries.createDelivery(T1, orderId, {
      deliveryDate: '2026-05-04',
      lines: [{ orderLineId, quantity: 4 }],
    });
    d1 = { id: delivery.id, journalEntryId: delivery.journalEntryId };
    expect(delivery.number).toBe('DN-1');
    expect(delivery.status).toBe('POSTED');
    expect(delivery.orderId).toBe(orderId);
    expect(delivery.partyCode).toBe('CUST');
    expect(delivery.totalCost).toBe(4000);
    expect(delivery.stockDocumentId).not.toBeNull();
    expect(delivery.journalEntryId).not.toBeNull();
    expect(delivery.lines!.map((line) => [line.quantity, line.lineCost, line.unitCost])).toEqual([[4, 4000, 1000]]);
    expect(await qty('A')).toBe(11);

    // The order line moved but reservation semantics did not: open quantity fell 12 -> 8, on-hand
    // 15 -> 11, so available stays 3.
    const fulfilment = await deliveries.getFulfilment(T1, orderId);
    expect(fulfilment.status).toBe('PARTIAL');
    expect(fulfilment.lines).toEqual([
      { orderLineId, itemId: itemA, ordered: 12, delivered: 4, backorder: 8, status: 'PARTIAL' },
    ]);
    expect((await availability.availability(T1, [itemA]))[0]).toMatchObject({ onHand: 11, reserved: 8, available: 3 });

    const [document] = await q(
      `SELECT doc_type, status, doc_number, from_warehouse_id, reference FROM erp_stock_documents WHERE id = $1 AND tenant_id = $2`,
      [delivery.stockDocumentId, T1],
    );
    expect(document).toMatchObject({
      doc_type: 'SALES_DELIVERY',
      status: 'POSTED',
      doc_number: 'SD-DN-1',
      from_warehouse_id: warehouseId,
      reference: 'DN-1',
    });
    const [documentLine] = await q(
      `SELECT quantity, unit_cost, value FROM erp_stock_document_lines WHERE document_id = $1 AND tenant_id = $2`,
      [delivery.stockDocumentId, T1],
    );
    expect([Number(documentLine.quantity), Number(documentLine.unit_cost), Number(documentLine.value)]).toEqual([4, 1000, 4000]);

    // One voucher through the engine: debit cogs 4,000 / credit inventory 4,000.
    const entryLines = await scoped(
      `SELECT a.code, l.debit, l.credit FROM fin_journal_entry_lines l JOIN fin_chart_of_accounts a ON a.id = l.account_id
        WHERE l.journal_entry_id = $1 ORDER BY l.id`,
      [delivery.journalEntryId],
    );
    expect(entryLines.map((line) => [line.code, Number(line.debit), Number(line.credit)])).toEqual([
      ['5101', 4000, 0],
      ['1030', 0, 4000],
    ]);
    expect(
      await scoped(
        `SELECT 1 FROM fin_posting_sources WHERE tenant_id=$1 AND source_type='sales_delivery' AND source_id=$2 AND doc_type='invoice.sale_cogs'`,
        [T1, String(delivery.id)],
      ),
    ).toHaveLength(1);
  });

  it('delivery 2 crosses into layer 2: cost 7,000, PARTIAL fulfilment, layers 0 and 5', async () => {
    const delivery = await deliveries.createDelivery(T1, orderId, {
      deliveryDate: '2026-05-05',
      lines: [{ orderLineId, quantity: 6 }],
    });
    expect(delivery.number).toBe('DN-2');
    expect(delivery.totalCost).toBe(7000); // 1 x 1,000 + 5 x 1,200
    expect(delivery.lines!.map((line) => [line.lineCost, line.unitCost])).toEqual([[7000, 1166.67]]);
    expect(await qty('A')).toBe(5);
    const fulfilment = await deliveries.getFulfilment(T1, orderId);
    expect(fulfilment.status).toBe('PARTIAL');
    expect(fulfilment.lines[0]).toMatchObject({ delivered: 10, backorder: 2, status: 'PARTIAL' });

    const layers = await q(
      `SELECT quantity_remaining, unit_purchase_cost FROM inventory_fifo_batches WHERE tenant_id=$1 AND sku='A' AND warehouse_id=$2 ORDER BY id`,
      [T1, warehouseId],
    );
    expect(layers.map((layer) => [Number(layer.quantity_remaining), Number(layer.unit_purchase_cost)])).toEqual([
      [0, 1000],
      [5, 1200],
    ]);

    const second = await scoped(
      `SELECT a.code, l.debit, l.credit FROM fin_journal_entry_lines l JOIN fin_chart_of_accounts a ON a.id = l.account_id
        WHERE l.journal_entry_id = $1 ORDER BY l.id`,
      [delivery.journalEntryId],
    );
    expect(second.map((line) => [line.code, Number(line.debit), Number(line.credit)])).toEqual([
      ['5101', 7000, 0],
      ['1030', 0, 7000],
    ]);
    const sums = await scoped(
      `SELECT a.code, SUM(l.debit) AS debit, SUM(l.credit) AS credit
         FROM fin_journal_entry_lines l JOIN fin_chart_of_accounts a ON a.id = l.account_id
        WHERE l.journal_entry_id = ANY($1::int[]) GROUP BY a.code`,
      [[d1.journalEntryId, delivery.journalEntryId]],
    );
    const byCode = new Map(sums.map((row) => [row.code, [Number(row.debit), Number(row.credit)]]));
    expect(byCode.get('5101')).toEqual([11000, 0]);
    expect(byCode.get('1030')).toEqual([0, 11000]);
  });

  it('backorders after delivery 2 list exactly the open line of order O', async () => {
    const result = await deliveries.listBackorders(T1, {});
    expect(result.total).toBe(1);
    expect(result.data).toEqual([{ orderId, orderNumber: 'SO-1', partyCode: 'CUST', itemId: itemA, backorder: 2 }]);
    expect((await deliveries.listBackorders(T1, { partyCode: 'CUST' })).data).toEqual(result.data);
    expect((await deliveries.listBackorders(T1, { partyCode: 'NOBODY' })).total).toBe(0);
  });

  it('over-delivery is refused as a conflict and nothing changes at all', async () => {
    await expect(
      deliveries.createDelivery(T1, orderId, {
        deliveryDate: '2026-05-06',
        lines: [{ orderLineId, quantity: 3 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await deliveries.getFulfilment(T1, orderId)).lines[0]).toMatchObject({ delivered: 10, backorder: 2 });
    expect(await qty('A')).toBe(5);
    expect(await deliveryCount()).toBe(2);
    expect(await stockDocCount()).toBe(2);
    expect(await voucherCount()).toBe(2);
  });

  it('delivery 3 completes the order; the same idempotency key returns the same delivery', async () => {
    const body = { deliveryDate: '2026-05-07', idempotencyKey: 'k1', lines: [{ orderLineId, quantity: 2 }] };
    const delivery = await deliveries.createDelivery(T1, orderId, body);
    expect(delivery.number).toBe('DN-3');
    expect(delivery.totalCost).toBe(2400); // 2 x 1,200 (layer 2)
    expect(delivery.lines!.map((line) => [line.lineCost, line.unitCost])).toEqual([[2400, 1200]]);
    const fulfilment = await deliveries.getFulfilment(T1, orderId);
    expect(fulfilment.status).toBe('COMPLETE');
    expect(fulfilment.lines[0]).toMatchObject({ delivered: 12, backorder: 0, status: 'COMPLETE' });
    expect(await qty('A')).toBe(3);
    expect((await availability.availability(T1, [itemA]))[0]).toMatchObject({ onHand: 3, reserved: 0, available: 3 });

    const replay = await deliveries.createDelivery(T1, orderId, body);
    expect(replay.id).toBe(delivery.id);
    expect(replay.number).toBe(delivery.number);
    expect(await qty('A')).toBe(3);
    expect(await voucherCount()).toBe(3);
  });

  it('posting the same delivery source again replays the voucher and writes nothing', async () => {
    const result = await postingRules.post(T1, {
      docType: 'invoice.sale_cogs',
      sourceType: 'sales_delivery',
      sourceId: String(d1.id),
      date: '2026-05-04T12:00:00.000Z',
      amounts: { cost: 400000n },
      description: 'بهای تمام‌شده تحویل DN-1',
      entryNumber: 'DNC-DN-1',
      overrides: { inventory: '1030', cogs: '5101' },
    });
    expect(result.replayed).toBe(true);
    expect(result.entryId).toBe(d1.journalEntryId);
    expect(await voucherCount()).toBe(3);
  });

  it('a shortage on one line rolls the whole delivery back', async () => {
    await owner.query(
      `INSERT INTO erp_stock_items (tenant_id, sku, barcode, name, quantity, min_quantity) VALUES ($1, 'B', 'B', 'کالا B', 0, 0)`,
      [T1],
    );
    const items = await owner.query<Array<{ id: number; sku: string }>>(`SELECT id, sku FROM erp_stock_items WHERE tenant_id = $1`, [
      T1,
    ]);
    const itemB = Number(items.find((row) => row.sku === 'B')!.id);
    await inventory.receiveStock(T1, {
      sku: 'B',
      quantity: 1,
      unitPurchaseCost: 500,
      warehouseId,
      receivedAt: '2026-03-01T12:00:00.000Z',
    } as never);
    const order = await sales.createOrder(T1, {
      partyCode: 'CUST',
      warehouseId,
      orderDate: '2026-05-08',
      lines: [{ itemId: itemB, quantity: 3, unitPrice: 900 }],
    } as never);
    await sales.confirmOrder(T1, order.id);
    await expect(
      deliveries.createDelivery(T1, order.id, {
        deliveryDate: '2026-05-09',
        lines: [{ orderLineId: order.lines![0].id, quantity: 2 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await qty('B')).toBe(1);
    const fulfilment = await deliveries.getFulfilment(T1, order.id);
    expect(fulfilment.status).toBe('NONE');
    expect(fulfilment.lines[0]).toMatchObject({ delivered: 0, backorder: 3, status: 'NONE' });
    expect(await deliveryCount()).toBe(3);
    expect(await stockDocCount()).toBe(3);
    expect(await voucherCount()).toBe(3);
  });

  it('a DRAFT or CANCELLED order refuses delivery; a delivered order cannot be cancelled', async () => {
    const draft = await sales.createOrder(T1, {
      partyCode: 'CUST',
      warehouseId,
      orderDate: '2026-05-10',
      lines: [{ itemId: itemA, quantity: 1, unitPrice: 1200 }],
    } as never);
    await expect(
      deliveries.createDelivery(T1, draft.id, {
        deliveryDate: '2026-05-11',
        lines: [{ orderLineId: draft.lines![0].id, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await sales.confirmOrder(T1, draft.id);
    await sales.cancelOrder(T1, draft.id);
    await expect(
      deliveries.createDelivery(T1, draft.id, {
        deliveryDate: '2026-05-11',
        lines: [{ orderLineId: draft.lines![0].id, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(sales.cancelOrder(T1, orderId)).rejects.toBeInstanceOf(ConflictException);
    expect(await deliveryCount()).toBe(3);
  });

  it('both new tables have FORCE RLS with one policy; tenant B sees nothing of tenant A', async () => {
    for (const table of NEW_TABLES) {
      const [row] = await owner.query(
        `SELECT c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
           FROM pg_class c WHERE c.relname = $1`,
        [table],
      );
      expect({ table, ...row }).toMatchObject({ table, relrowsecurity: true, relforcerowsecurity: true, policies: 1 });
    }
    await expect(deliveries.getDelivery(T2, d1.id)).rejects.toBeInstanceOf(NotFoundException);
    expect((await deliveries.listDeliveries(T2, { limit: 50, offset: 0 })).total).toBe(0);
    await app.transaction(async (m) => {
      await TenantScope.bind(m, T2);
      for (const table of NEW_TABLES) {
        expect(await m.query(`SELECT 1 FROM "${table}"`)).toEqual([]);
      }
    });
  });

  it('reads and lists deliveries with their lines', async () => {
    const list = await deliveries.listDeliveries(T1, { orderId, limit: 50, offset: 0 });
    expect(list.total).toBe(3);
    expect(list.data.map((row) => row.number)).toEqual(['DN-3', 'DN-2', 'DN-1']);
    const one = await deliveries.getDelivery(T1, d1.id);
    expect(one.lines!.map((line) => line.lineNo)).toEqual([1]);
    const byParty = await deliveries.listDeliveries(T1, { partyCode: 'CUST', limit: 50, offset: 0 });
    expect(byParty.total).toBe(3);
    await expect(deliveries.getDelivery(T1, 999999)).rejects.toBeInstanceOf(NotFoundException);
  });
});
