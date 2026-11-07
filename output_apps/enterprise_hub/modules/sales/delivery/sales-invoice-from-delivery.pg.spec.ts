/**
 * Invoicing from delivery lines on a REAL PostgreSQL as a non-superuser role (#563 T1 slice 4):
 * one invoice over lines of several deliveries of one customer, delivery lines locked FOR UPDATE,
 * the over-invoicing refusal (409), mixed customers refused (400), VAT from the statutory store
 * on the invoice date, revenue and VAT posted through the real invoice posting path while stock
 * and COGS stay untouched (the delivery already posted them), the link table with FORCE RLS and
 * the idempotency-key replay.
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set. Each run creates and
 * drops its own database and role. Optional: ROXIRA_TEST_PG_USER, ROXIRA_TEST_PG_PORT, ROXIRA_TEST_PG_PASSWORD.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55433 ROXIRA_TEST_PG_USER=postgres npx jest --runInBand modules/sales/delivery/sales-invoice-from-delivery.pg.spec.ts
 */
import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { InvoicingRepository } from '../../invoicing/repositories/invoicing.repository';
import { InvoicePostingService } from '../../invoicing/services/invoice-posting.service';
import { InvoicingService } from '../../invoicing/services/invoicing.service';
import { VatRateResolver } from '../../invoicing/services/vat-rate.resolver';
import { StatutoryRepository } from '../../hr/statutory/statutory.repository';
import { SalesRepository } from '../repositories/sales.repository';
import { SalesService } from '../services/sales.service';
import { SalesAvailabilityService } from '../services/sales-availability.service';
import { SalesDeliveryRepository } from './repositories/sales-delivery.repository';
import { SalesInvoiceDeliveryRepository } from './repositories/sales-invoice-delivery.repository';
import { SalesDeliveryService } from './services/sales-delivery.service';
import { SalesInvoiceFromDeliveryService } from './services/sales-invoice-from-delivery.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'sales-app-test-only';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const NEW_TABLE = 'erp_sales_invoice_delivery_lines';
// Made-up test rates, chosen to differ per effective date; not legal figures (see VAT-01).
const RATE_SPRING = 0.1;
const RATE_AUTUMN = 0.08;

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

describePg('Sales invoice from delivery lines on PostgreSQL (non-superuser, real invoicing path)', () => {
  const db = `rx_invd_${process.pid}_${Date.now()}`;
  const role = `rx_inv_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let sales: SalesService;
  let inventory: InventoryService;
  let deliveries: SalesDeliveryService;
  let invoices: SalesInvoiceFromDeliveryService;
  let posting: InvoicePostingService;
  let warehouseId: number;
  let itemA: number;
  let orderId: number;
  let deliveryA: { id: number; lineId: number };
  let deliveryB: { id: number; lineId: number };

  const q = <R = Record<string, string>>(sql: string, params: unknown[] = []) => app.query(sql, params) as Promise<R[]>;

  /** A raw read inside one tenant-bound transaction, for tables with FORCE RLS. */
  const scoped = async <R = Record<string, string>>(sql: string, params: unknown[] = [], tenant = T1): Promise<R[]> =>
    app.transaction(async (m) => {
      await TenantScope.bind(m, tenant);
      return m.query(sql, params) as Promise<R[]>;
    });

  const qty = async (sku: string) =>
    Number((await q('SELECT quantity FROM erp_stock_items WHERE tenant_id=$1 AND sku=$2', [T1, sku]))[0].quantity);
  const invoiceCount = async () =>
    Number((await q('SELECT count(*)::int AS c FROM invoices WHERE tenant_id=$1', [T1]))[0].c);
  const cogsSum = async () =>
    Number(
      (
        await scoped(
          `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS s
             FROM fin_journal_entry_lines l JOIN fin_chart_of_accounts a ON a.id = l.account_id
            WHERE a.tenant_id = $1 AND a.code = '5101'`,
          [T1],
        )
      )[0].s,
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
    const availability = new SalesAvailabilityService(salesRepo);
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
    const postingRules = new PostingRulesService(new PostingRulesRepository(new TenantScope(app)), accounting);
    deliveries = new SalesDeliveryService(
      salesRepo,
      new SalesDeliveryRepository(scope),
      inventory,
      stockDocuments,
      stockDocsRepository,
      postingRules,
    );

    const invoicingRepository = new InvoicingRepository(app.getRepository(InvoiceEntity), app);
    // The tenant row only feeds the seller name and the country rule; the VAT rate never comes
    // from it (#126) — it comes from the statutory store through the real resolver.
    const tenants = {
      findById: async (id: string) => ({ id, name: 'شرکت آزمون', countryCode: 'IR' }),
    } as unknown as TenantsRepository;
    const currency = {
      getRate: () => 1,
      round: (value: number) => value,
    } as unknown as CurrencyService;
    const vatRates = new VatRateResolver(new StatutoryRepository(new TenantScope(app)));
    const invoicing = new InvoicingService(
      invoicingRepository,
      currency,
      undefined,
      undefined,
      tenants,
      undefined,
      undefined,
      vatRates,
    );
    posting = new InvoicePostingService(invoicingRepository, inventory, accounting, postingRules, stockDocsRepository);
    invoices = new SalesInvoiceFromDeliveryService(
      new SalesInvoiceDeliveryRepository(scope),
      new SalesDeliveryRepository(scope),
      invoicing,
      invoicingRepository,
      vatRates,
      tenants,
    );

    await owner
      .query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [T1, T1.slice(0, 8)])
      .catch(() => undefined);
    await owner
      .query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [T2, T2.slice(0, 8)])
      .catch(() => undefined);
    await parties.create(T1, { code: 'CUST', name: 'مشتری نمونه', role: PartyRole.CUSTOMER } as never);
    await parties.create(T1, { code: 'CUST2', name: 'مشتری دوم', role: PartyRole.CUSTOMER } as never);
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

    // Statutory VAT rates of fiscal year 1405: two made-up versions by effective date.
    await owner.query(
      `INSERT INTO statutory_parameters
         (tenant_id, country, fiscal_year, param_key, effective_from, version, value, source, source_kind, verified, created_by)
       VALUES (NULL, 'IR', 1405, 'vat_general_rate', '2026-03-21', 1, $1::jsonb, 'pg spec', 'REPORT', false, 'spec'),
              (NULL, 'IR', 1405, 'vat_general_rate', '2026-09-23', 1, $2::jsonb, 'pg spec', 'REPORT', false, 'spec')`,
      [JSON.stringify(String(RATE_SPRING)), JSON.stringify(String(RATE_AUTUMN))],
    );

    // Order O for 10.00 of A at 1,000,000 (the sale price, distinct from the FIFO cost).
    const order = await sales.createOrder(T1, {
      partyCode: 'CUST',
      warehouseId,
      orderDate: '2026-05-03',
      lines: [{ itemId: itemA, quantity: 10, unitPrice: 1_000_000 }],
    } as never);
    await sales.confirmOrder(T1, orderId = order.id);
    const orderLineId = order.lines![0].id;

    // Delivery A: 4.00 at cost 4,000; delivery B: 6.00 at cost 7,000 (1 x 1,000 + 5 x 1,200).
    const a = await deliveries.createDelivery(T1, orderId, {
      deliveryDate: '2026-05-04',
      lines: [{ orderLineId, quantity: 4 }],
    });
    const b = await deliveries.createDelivery(T1, orderId, {
      deliveryDate: '2026-05-05',
      lines: [{ orderLineId, quantity: 6 }],
    });
    deliveryA = { id: a.id, lineId: a.lines![0].id };
    deliveryB = { id: b.id, lineId: b.lines![0].id };
    expect(await qty('A')).toBe(5);
    expect(await cogsSum()).toBe(11_000);
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('invoices 3.00 of delivery A and 2.00 of delivery B at the order price: subtotal 5,000,000, VAT per the statutory rate', async () => {
    const invoice = await invoices.createFromDeliveries(T1, {
      invoiceDate: '2026-05-04',
      idempotencyKey: 'inv-1',
      deliveryLines: [
        { deliveryLineId: deliveryA.lineId, quantity: 3 },
        { deliveryLineId: deliveryB.lineId, quantity: 2 },
      ],
    });
    expect(invoice.replayed).toBe(false);
    expect(invoice.status).toBe('ISSUED');
    expect(invoice.partyCode).toBe('CUST');
    expect(invoice.invoiceDate).toBe('2026-05-04');
    expect(invoice.totalAmount).toBe(5_000_000); // 5 x 1,000,000
    expect(invoice.totalTax).toBe(500_000); // 10% of 5,000,000 on the invoice date
    expect(invoice.finalPayable).toBe(5_500_000);
    expect(invoice.lines).toEqual([
      {
        deliveryId: deliveryA.id,
        deliveryNumber: 'DN-1',
        deliveryLineId: deliveryA.lineId,
        orderLineId: expect.any(Number),
        itemId: itemA,
        sku: 'A',
        invoiceLineNo: 1,
        quantity: 3,
      },
      {
        deliveryId: deliveryB.id,
        deliveryNumber: 'DN-2',
        deliveryLineId: deliveryB.lineId,
        orderLineId: expect.any(Number),
        itemId: itemA,
        sku: 'A',
        invoiceLineNo: 2,
        quantity: 2,
      },
    ]);

    const [row] = await q<Array<Record<string, unknown>>>(
      `SELECT status, issued_at::text AS issued_at, idempotency_key, total_amount, total_tax, final_payable, items
         FROM invoices WHERE id = $1 AND tenant_id = $2`,
      [invoice.invoiceId, T1],
    );
    expect(row.status).toBe('ISSUED');
    // The invoice is dated on the invoice date (Tehran midnight = 20:30 UTC), not on "now"; the
    // column is a naive timestamp, so the text form is timezone-independent.
    expect(row.issued_at).toBe('2026-05-03 20:30:00');
    expect(row.idempotency_key).toBe('DINV-inv-1');
    expect(Number(row.total_amount)).toBe(5_000_000);
    expect(Number(row.final_payable)).toBe(5_500_000);
    const invoiceItems = row.items as Array<Record<string, unknown>>;
    expect(invoiceItems.map((item) => [item.description, item.quantity, item.unitPrice, item.vatRate, item.tax])).toEqual([
      ['کالا A', 3, 1_000_000, RATE_SPRING, 300_000],
      ['کالا A', 2, 1_000_000, RATE_SPRING, 200_000],
    ]);
    // No stock link: posting must never move stock or post COGS for this invoice.
    expect(invoiceItems.every((item) => item.itemId === null && item.sku === null)).toBe(true);

    const deliveryLines = await scoped<Array<Record<string, string>>>(
      `SELECT id, invoiced_quantity FROM erp_sales_delivery_lines WHERE tenant_id=$1 AND id = ANY($2::int[]) ORDER BY id`,
      [T1, [deliveryA.lineId, deliveryB.lineId]],
    );
    expect(deliveryLines.map((line) => line.invoiced_quantity)).toEqual(['3.00', '2.00']);
    const [orderLine] = await scoped<Array<Record<string, string>>>(
      `SELECT invoiced_quantity FROM erp_sales_order_lines WHERE tenant_id=$1 AND order_id=$2`,
      [T1, orderId],
    );
    expect(orderLine.invoiced_quantity).toBe('5.00');
    const links = await scoped<Array<Record<string, unknown>>>(
      `SELECT invoice_id, delivery_line_id, invoice_line_no, quantity
         FROM erp_sales_invoice_delivery_lines WHERE tenant_id=$1 ORDER BY invoice_line_no`,
      [T1],
    );
    expect(links.map((link) => [String(link.invoice_id), Number(link.delivery_line_id), Number(link.invoice_line_no), link.quantity])).toEqual([
      [invoice.invoiceId, deliveryA.lineId, 1, '3.00'],
      [invoice.invoiceId, deliveryB.lineId, 2, '2.00'],
    ]);
  });

  it('posting the invoice books revenue and VAT only: no stock movement, no COGS, no stock document', async () => {
    const [row] = await q<Array<Record<string, string>>>(
      `SELECT id, status FROM invoices WHERE tenant_id=$1 AND idempotency_key=$2`,
      [T1, 'DINV-inv-1'],
    );
    await posting.postIssued({ tenantId: T1, invoiceId: row.id, status: 'ISSUED' });
    const [posted] = await q<Array<Record<string, unknown>>>(
      `SELECT journal_entry_id, posting_error, posting_meta FROM invoices WHERE id = $1 AND tenant_id = $2`,
      [row.id, T1],
    );
    expect(posted.posting_error).toBeNull();
    const meta = posted.posting_meta as { stockValue: number; lines: unknown[]; posted: { stock: string } };
    expect(meta.stockValue).toBe(0);
    expect(meta.lines).toEqual([]);
    expect(meta.posted.stock).toBe('0');

    // Exactly the three revenue rows: AR / Sales / VAT payable. No inventory (1301), no COGS (5101).
    const entryLines = await scoped(
      `SELECT a.code, l.debit, l.credit FROM fin_journal_entry_lines l JOIN fin_chart_of_accounts a ON a.id = l.account_id
        WHERE l.journal_entry_id = $1 ORDER BY l.id`,
      [Number(posted.journal_entry_id)],
    );
    expect(entryLines.map((line) => [line.code, Number(line.debit), Number(line.credit)])).toEqual([
      ['1201', 5_500_000, 0],
      ['4101', 0, 5_000_000],
      ['2301', 0, 500_000],
    ]);

    expect(await qty('A')).toBe(5);
    const layers = await q(
      `SELECT quantity_remaining, unit_purchase_cost FROM inventory_fifo_batches WHERE tenant_id=$1 AND sku='A' AND warehouse_id=$2 ORDER BY id`,
      [T1, warehouseId],
    );
    expect(layers.map((layer) => [Number(layer.quantity_remaining), Number(layer.unit_purchase_cost)])).toEqual([
      [0, 1000],
      [5, 1200],
    ]);
    expect(await cogsSum()).toBe(11_000); // the two deliveries, nothing from the invoice
    const docs = await q(
      `SELECT count(*)::int AS c FROM erp_stock_documents WHERE tenant_id=$1 AND source_invoice_id=$2`,
      [T1, row.id],
    );
    expect(Number(docs[0].c)).toBe(0);
  });

  it('the order invoicing status reads ordered, delivered, invoiced and remaining per line', async () => {
    const status = await invoices.getOrderInvoicing(T1, orderId);
    expect(status.status).toBe('PARTIAL');
    expect(status.lines).toEqual([
      {
        orderLineId: expect.any(Number),
        itemId: itemA,
        ordered: 10,
        delivered: 10,
        invoiced: 5,
        remaining: 5,
        status: 'PARTIAL',
      },
    ]);
    await expect(invoices.getOrderInvoicing(T1, 999999)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('over-invoicing a line above delivered minus invoiced is refused with 409 and nothing changes', async () => {
    // Delivery A has 1.00 left (4.00 delivered, 3.00 invoiced); asking 2.00 is a conflict.
    await expect(
      invoices.createFromDeliveries(T1, {
        invoiceDate: '2026-05-06',
        deliveryLines: [{ deliveryLineId: deliveryA.lineId, quantity: 2 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    const lines = await scoped<Array<Record<string, string>>>(
      `SELECT id, invoiced_quantity FROM erp_sales_delivery_lines WHERE tenant_id=$1 AND id = ANY($2::int[]) ORDER BY id`,
      [T1, [deliveryA.lineId, deliveryB.lineId]],
    );
    expect(lines.map((line) => line.invoiced_quantity)).toEqual(['3.00', '2.00']);
    expect(await invoiceCount()).toBe(1);
    expect(await cogsSum()).toBe(11_000);
  });

  it('lines of two different customers are refused with 400 in one invoice', async () => {
    const order2 = await sales.createOrder(T1, {
      partyCode: 'CUST2',
      warehouseId,
      orderDate: '2026-05-06',
      lines: [{ itemId: itemA, quantity: 2, unitPrice: 1_000_000 }],
    } as never);
    await sales.confirmOrder(T1, order2.id);
    const c = await deliveries.createDelivery(T1, order2.id, {
      deliveryDate: '2026-05-07',
      lines: [{ orderLineId: order2.lines![0].id, quantity: 2 }],
    });
    await expect(
      invoices.createFromDeliveries(T1, {
        invoiceDate: '2026-05-07',
        deliveryLines: [
          { deliveryLineId: deliveryA.lineId, quantity: 1 },
          { deliveryLineId: c.lines![0].id, quantity: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await invoiceCount()).toBe(1);
    expect(await cogsSum()).toBe(13_400); // only delivery C posted its own COGS
  });

  it('a repeated idempotency key returns the same invoice and writes nothing', async () => {
    const body = {
      invoiceDate: '2026-05-04',
      idempotencyKey: 'inv-1',
      deliveryLines: [
        { deliveryLineId: deliveryA.lineId, quantity: 3 },
        { deliveryLineId: deliveryB.lineId, quantity: 2 },
      ],
    };
    const replay = await invoices.createFromDeliveries(T1, body);
    const stored = await q<Array<{ id: string }>>(`SELECT id FROM invoices WHERE tenant_id=$1 AND idempotency_key=$2`, [
      T1,
      'DINV-inv-1',
    ]);
    expect(replay.replayed).toBe(true);
    expect(replay.invoiceId).toBe(stored[0].id);
    expect(replay.totalAmount).toBe(5_000_000);
    expect(replay.finalPayable).toBe(5_500_000);
    expect(await invoiceCount()).toBe(1);
    const lines = await scoped<Array<Record<string, string>>>(
      `SELECT invoiced_quantity FROM erp_sales_delivery_lines WHERE tenant_id=$1 AND id = ANY($2::int[]) ORDER BY id`,
      [T1, [deliveryA.lineId, deliveryB.lineId]],
    );
    expect(lines.map((line) => line.invoiced_quantity)).toEqual(['3.00', '2.00']);
  });

  it('a second invoice on a later date takes the statutory rate of THAT date and completes the order', async () => {
    // 2026-10-01 is after the second 1405 version (0.08 from 2026-09-23): VAT 400,000 on 5,000,000.
    const invoice = await invoices.createFromDeliveries(T1, {
      invoiceDate: '2026-10-01',
      deliveryLines: [
        { deliveryLineId: deliveryA.lineId, quantity: 1 },
        { deliveryLineId: deliveryB.lineId, quantity: 4 },
      ],
    });
    expect(invoice.totalAmount).toBe(5_000_000);
    expect(invoice.totalTax).toBe(400_000);
    expect(invoice.finalPayable).toBe(5_400_000);
    expect(invoice.lines.map((line) => [line.deliveryNumber, line.quantity])).toEqual([
      ['DN-1', 1],
      ['DN-2', 4],
    ]);

    await posting.postIssued({ tenantId: T1, invoiceId: invoice.invoiceId, status: 'ISSUED' });
    const [posted] = await q<Array<Record<string, string>>>(
      `SELECT journal_entry_id, posting_error FROM invoices WHERE id = $1 AND tenant_id = $2`,
      [invoice.invoiceId, T1],
    );
    expect(posted.posting_error).toBeNull();
    expect(await qty('A')).toBe(3); // delivery C took 2; invoicing never touches stock

    const status = await invoices.getOrderInvoicing(T1, orderId);
    expect(status.status).toBe('COMPLETE');
    expect(status.lines[0]).toMatchObject({ ordered: 10, delivered: 10, invoiced: 10, remaining: 0, status: 'COMPLETE' });
  });

  it('delivery lines of another tenant are not found (404), never invoiced', async () => {
    await expect(
      invoices.createFromDeliveries(T2, {
        invoiceDate: '2026-05-04',
        deliveryLines: [{ deliveryLineId: deliveryA.lineId, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await invoiceCount()).toBe(2);
  });

  it('the link table has FORCE RLS with one policy; tenant B sees nothing of tenant A', async () => {
    const [row] = await owner.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
         FROM pg_class c WHERE c.relname = $1`,
      [NEW_TABLE],
    );
    expect({ table: NEW_TABLE, ...row }).toMatchObject({
      table: NEW_TABLE,
      relrowsecurity: true,
      relforcerowsecurity: true,
      policies: 1,
    });
    await app.transaction(async (m) => {
      await TenantScope.bind(m, T2);
      expect(await m.query(`SELECT 1 FROM "${NEW_TABLE}"`)).toEqual([]);
    });
  });
});
