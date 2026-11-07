/**
 * Partial returns of delivery invoices on a REAL PostgreSQL as a non-superuser role (#565 T1
 * slice 5). Hand numbers: delivered and invoiced 5.00 at 1,000,000 (VAT 10%), delivery cost
 * 3,000,000 (600,000 per unit, one FIFO layer).
 *  - a line not billed on the invoice is refused (400) and changes nothing;
 *  - return 2.00: credit 2,000,000 + VAT 200,000, stock +2.00 valued 1,200,000, COGS reversal 1,200,000;
 *  - a second return of 4.00 is refused (409): 3.00 is still open;
 *  - a repeated key returns the same return and books nothing twice;
 *  - after the statutory rate became 8%, a return of 1.00 still reverses at the original 10%;
 *  - two concurrent calls with one key create one return;
 *  - returning above what is still open (1.01 of 1.00) is refused (409);
 *  - another tenant sees 404.
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55433 ROXIRA_TEST_PG_USER=postgres npx jest --runInBand modules/sales/returns/sales-return.pg.spec.ts
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
import { SalesDeliveryRepository } from '../delivery/repositories/sales-delivery.repository';
import { SalesInvoiceDeliveryRepository } from '../delivery/repositories/sales-invoice-delivery.repository';
import { SalesDeliveryService } from '../delivery/services/sales-delivery.service';
import { SalesInvoiceFromDeliveryService } from '../delivery/services/sales-invoice-from-delivery.service';
import { CreateReturnDto, ReturnResponseDto } from './dto/sales-return.dto';
import { SalesReturnRepository } from './repositories/sales-return.repository';
import { SalesReturnService } from './services/sales-return.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'sales-return-test-only';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

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

describePg('Sales returns of delivery invoices on PostgreSQL (non-superuser, real invoicing path)', () => {
  const db = `rx_ret_${process.pid}_${Date.now()}`;
  const role = `rx_ret_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let returns: SalesReturnService;
  let posting: InvoicePostingService;
  let warehouseId: number;
  let itemA: number;
  let d1Line: number;
  let d2Line: number;
  let invoiceId: string;

  const q = <R = Record<string, string>>(sql: string, params: unknown[] = []) => app.query(sql, params) as Promise<R[]>;

  /** A raw read inside one tenant-bound transaction, for tables with FORCE RLS. */
  const scoped = async <R = Record<string, unknown>>(sql: string, params: unknown[] = [], tenant = T1): Promise<R[]> =>
    app.transaction(async (m) => {
      await TenantScope.bind(m, tenant);
      return m.query(sql, params) as Promise<R[]>;
    });

  const qty = async (sku: string) =>
    Number((await q('SELECT quantity FROM erp_stock_items WHERE tenant_id=$1 AND sku=$2', [T1, sku]))[0].quantity);
  /** Sum of debit minus credit on the COGS account (5101), in rials. */
  const cogsBalance = async () =>
    Number(
      (
        await scoped<{ s: string }>(
          `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS s
             FROM fin_journal_entry_lines l JOIN fin_chart_of_accounts a ON a.id = l.account_id
            WHERE a.tenant_id = $1 AND a.code = '5101'`,
          [T1],
        )
      )[0].s,
    );
  const invoicesWithKey = async (key: string) =>
    scoped<{ id: string }>(`SELECT id FROM invoices WHERE tenant_id = $1 AND idempotency_key = $2`, [T1, key]);
  const returnTotals = async (id: string) =>
    (
      await scoped<{ totalAmount: string; totalTax: string; finalPayable: string; subject: number; relatedInvoiceId: string }>(
        `SELECT "totalAmount", "totalTax", "finalPayable", subject, related_invoice_id AS "relatedInvoiceId"
           FROM invoices WHERE tenant_id = $1 AND id = $2`,
        [T1, id],
      )
    )[0];
  const returnedOf = async (deliveryLineId: number) =>
    Number(
      (
        await scoped<{ returned_quantity: string }>(
          'SELECT returned_quantity FROM erp_sales_delivery_lines WHERE tenant_id=$1 AND id=$2',
          [T1, deliveryLineId],
        )
      )[0].returned_quantity,
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
    const sales = new SalesService(salesRepo, parties);
    const availability = new SalesAvailabilityService(salesRepo);
    const inventory = new InventoryService(
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
    const deliveries = new SalesDeliveryService(
      salesRepo,
      new SalesDeliveryRepository(scope),
      inventory,
      stockDocuments,
      stockDocsRepository,
      postingRules,
    );

    const invoicingRepository = new InvoicingRepository(app.getRepository(InvoiceEntity), app);
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
    const fromDeliveries = new SalesInvoiceFromDeliveryService(
      new SalesInvoiceDeliveryRepository(scope),
      new SalesDeliveryRepository(scope),
      invoicing,
      invoicingRepository,
      vatRates,
      tenants,
    );
    returns = new SalesReturnService(
      new SalesReturnRepository(scope),
      invoicing,
      invoicingRepository,
      inventory,
      stockDocuments,
      postingRules,
    );

    for (const tenant of [T1, T2]) {
      await owner
        .query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [tenant, tenant.slice(0, 8)])
        .catch(() => undefined);
    }
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

    // One FIFO layer: 10 units at 600,000 (the cost per unit of the hand numbers).
    await inventory.receiveStock(T1, {
      sku: 'A',
      quantity: 10,
      unitPurchaseCost: 600_000,
      warehouseId,
      receivedAt: '2026-01-01T12:00:00.000Z',
      batchNumber: 'L1',
    } as never);

    // Order for 10.00 at 1,000,000; delivery 1 takes 5.00 (cost 3,000,000), delivery 2 takes 1.00.
    const order = await sales.createOrder(T1, {
      partyCode: 'CUST',
      warehouseId,
      orderDate: '2026-05-03',
      lines: [{ itemId: itemA, quantity: 10, unitPrice: 1_000_000 }],
    } as never);
    await sales.confirmOrder(T1, order.id);
    const orderLineId = order.lines![0].id;
    const d1 = await deliveries.createDelivery(T1, order.id, {
      deliveryDate: '2026-05-04',
      lines: [{ orderLineId, quantity: 5 }],
    });
    const d2 = await deliveries.createDelivery(T1, order.id, {
      deliveryDate: '2026-05-05',
      lines: [{ orderLineId, quantity: 1 }],
    });
    d1Line = d1.lines![0].id;
    d2Line = d2.lines![0].id;
    expect(await qty('A')).toBe(4);
    expect(await cogsBalance()).toBe(3_600_000); // 3,000,000 + 600,000

    // The invoice of delivery 1 for 5.00 (VAT 10% on 2026-05-04: the statutory rate then).
    const invoice = await fromDeliveries.createFromDeliveries(T1, {
      invoiceDate: '2026-05-04',
      idempotencyKey: 'inv-1',
      deliveryLines: [{ deliveryLineId: d1Line, quantity: 5 }],
    });
    invoiceId = invoice.invoiceId;
    expect(invoice.finalPayable).toBe(5_500_000);
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('refuses a line that is not billed on this invoice (400) and changes nothing', async () => {
    await expect(
      returns.createReturn(T1, invoiceId, { lines: [{ deliveryLineId: d2Line, quantity: 1 }], returnDate: '2026-05-10' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await qty('A')).toBe(4);
  });

  it('return 2.00: credit 2,000,000 + VAT 200,000, stock +2.00 at 1,200,000, COGS reversal 1,200,000', async () => {
    const before = await cogsBalance();
    const result = await returns.createReturn(T1, invoiceId, {
      lines: [{ deliveryLineId: d1Line, quantity: '2.00' }],
      returnDate: '2026-05-10',
      idempotencyKey: 'ret-1',
    });
    expect(result.relatedInvoiceId).toBe(invoiceId);
    expect(result.items).toEqual([{ deliveryLineId: d1Line, quantity: 2 }]);

    const totals = await returnTotals(result.id);
    expect(Number(totals.subject)).toBe(4); // RETURN
    expect(Number(totals.totalAmount)).toBe(2_000_000);
    expect(Number(totals.totalTax)).toBe(200_000);
    expect(Number(totals.finalPayable)).toBe(2_200_000);
    expect(totals.relatedInvoiceId).toBe(invoiceId);

    expect(await qty('A')).toBe(6); // 4 + 2.00
    const [batch] = await scoped<{ quantity_remaining: string; unit_purchase_cost: string }>(
      `SELECT quantity_remaining, unit_purchase_cost FROM inventory_fifo_batches WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`,
      [T1],
    );
    expect(Number(batch.quantity_remaining) * Number(batch.unit_purchase_cost)).toBe(1_200_000);
    expect(before - (await cogsBalance())).toBe(1_200_000);
    expect(await returnedOf(d1Line)).toBe(2);
  });

  it('the return posts its revenue and VAT reversal through the invoice posting path, balanced', async () => {
    const result = (await invoicesWithKey('RET-ret-1'))[0];
    await posting.postIssued({ tenantId: T1, invoiceId: result.id, status: 'ISSUED' });
    const lines = await scoped<{ debit: string; credit: string }>(
      `SELECT l.debit, l.credit FROM fin_journal_entry_lines l
         JOIN invoices i ON i.journal_entry_id = l.journal_entry_id AND i.tenant_id = $1
        WHERE i.id = $2 AND l.tenant_id = $1`,
      [T1, result.id],
    );
    const debit = lines.reduce((sum, row) => sum + Number(row.debit), 0);
    const credit = lines.reduce((sum, row) => sum + Number(row.credit), 0);
    expect(debit).toBe(credit);
    expect(lines.map((row) => Number(row.debit) + Number(row.credit)).sort((a, b) => a - b)).toEqual([
      200_000,
      2_000_000,
      2_200_000,
    ]);
  });

  it('a second return of 4.00 is refused (409): 3.00 is still open', async () => {
    await expect(
      returns.createReturn(T1, invoiceId, {
        lines: [{ deliveryLineId: d1Line, quantity: 4 }],
        returnDate: '2026-05-10',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await qty('A')).toBe(6);
  });

  it('a repeated key returns the same return and books nothing twice', async () => {
    const before = await cogsBalance();
    const again = await returns.createReturn(T1, invoiceId, {
      lines: [{ deliveryLineId: d1Line, quantity: '2.00' }],
      returnDate: '2026-05-10',
      idempotencyKey: 'ret-1',
    });
    const [first] = await invoicesWithKey('RET-ret-1');
    expect(again.id).toBe(first.id);
    expect(await qty('A')).toBe(6);
    expect(await cogsBalance()).toBe(before);
    expect(await returnedOf(d1Line)).toBe(2);
  });

  it('after the statutory rate became 8%, a return of 1.00 still reverses at the original 10%', async () => {
    await owner.query(
      `INSERT INTO statutory_parameters
         (tenant_id, country, fiscal_year, param_key, effective_from, version, value, source, source_kind, verified, created_by)
       VALUES (NULL, 'IR', 1405, 'vat_general_rate', '2026-09-23', 1, $1::jsonb, 'pg spec', 'REPORT', false, 'spec')`,
      [JSON.stringify('0.08')],
    );
    const result = await returns.createReturn(T1, invoiceId, {
      lines: [{ deliveryLineId: d1Line, quantity: 1 }],
      returnDate: '2026-10-01',
      idempotencyKey: 'ret-2',
    });
    const totals = await returnTotals(result.id);
    expect(Number(totals.totalAmount)).toBe(1_000_000);
    expect(Number(totals.totalTax)).toBe(100_000);
    expect(Number(totals.finalPayable)).toBe(1_100_000);
    expect(await qty('A')).toBe(7);
  });

  it('two concurrent calls with one key create one return', async () => {
    const body = { lines: [{ deliveryLineId: d1Line, quantity: 1 }], returnDate: '2026-10-02', idempotencyKey: 'race' };
    const settled = await Promise.allSettled([
      returns.createReturn(T1, invoiceId, body as CreateReturnDto),
      returns.createReturn(T1, invoiceId, body as CreateReturnDto),
    ]);
    const fulfilled = settled.filter((s): s is PromiseFulfilledResult<ReturnResponseDto> => s.status === 'fulfilled');
    expect(fulfilled).toHaveLength(2);
    expect(fulfilled[0].value.id).toBe(fulfilled[1].value.id);
    expect(await invoicesWithKey('RET-race')).toHaveLength(1);
    expect(await qty('A')).toBe(8);
  });

  it('returning above what is still open (1.01 of 1.00) is refused with 409', async () => {
    await expect(
      returns.createReturn(T1, invoiceId, { lines: [{ deliveryLineId: d1Line, quantity: '1.01' }], returnDate: '2026-10-02' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await qty('A')).toBe(8);
  });

  it('another tenant sees 404 for this invoice', async () => {
    await expect(
      returns.createReturn(T2, invoiceId, { lines: [{ deliveryLineId: d1Line, quantity: 1 }], returnDate: '2026-10-02' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
