/**
 * Sales report (#243) on a REAL PostgreSQL: the route's service reads the invoices of the JWT tenant only,
 * counts a return as a subtraction, leaves out drafts, and filters by issue date. Skipped unless
 * ROXIRA_TEST_PG_HOST is set; each run creates and drops its own database.
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ReportExportService } from '../accounting/services/report-export.service';
import { SalesReportQueryDto } from './dto/sales-report.dto';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoiceDirection, InvoiceSubject } from './enums/invoice-kind.enum';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { SalesReportService } from './services/sales-report.service';

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

const line = (sku: string, quantity: number, unitPrice: number, tax: number) => ({
  sku,
  description: `کالای ${sku}`,
  quantity,
  unitPrice,
  discount: 0,
  vatRate: 0.1,
  tax,
  total: quantity * unitPrice + tax,
});

describePg('Sales report on PostgreSQL', () => {
  const dbName = `rx_sales_rep_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let ds: DataSource;
  let service: SalesReportService;
  let nextNumber = 1;

  const seed = async (
    tenantId: string,
    over: Omit<Partial<InvoiceEntity>, 'issuedAt' | 'items' | 'buyerInfo'> & { items: ReturnType<typeof line>[]; buyer: string; issuedAt: string },
  ): Promise<string> => {
    const { items, buyer, issuedAt, ...rest } = over;
    const totalTax = items.reduce((sum, item) => sum + item.tax, 0);
    const finalPayable = items.reduce((sum, item) => sum + item.total, 0);
    const repo = ds.getRepository(InvoiceEntity);
    const saved = await repo.save(
      repo.create({
        tenantId,
        taxInvoiceNumber: `INV-${nextNumber++}`,
        sellerInfo: { name: 'فروشگاه نمونه' } as InvoiceEntity['sellerInfo'],
        buyerInfo: { name: buyer } as InvoiceEntity['buyerInfo'],
        items,
        currency: 'IRR' as InvoiceEntity['currency'],
        totalAmount: finalPayable - totalTax,
        totalDiscount: 0,
        totalTax,
        finalPayable,
        direction: InvoiceDirection.SALE,
        subject: InvoiceSubject.ORIGINAL,
        status: InvoiceStatus.ISSUED,
        issuedAt: new Date(issuedAt),
        ...rest,
      } as InvoiceEntity),
    );
    return saved.id;
  };

  const run = async (tenant: string, query: SalesReportQueryDto) =>
    (await service.build(tenant, query)).json as {
      groups: Array<{ key: string; quantity: string; net: number; vat: number }>;
    };
  const rows = (json: Awaited<ReturnType<typeof run>>) => json.groups.map((g) => [g.key, g.quantity, g.net, g.vat]);

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
    ds = await new DataSource(options(dbName)).initialize();
    await ds.runMigrations();
    service = new SalesReportService(new InvoicingRepository(ds.getRepository(InvoiceEntity), ds));

    await seed(T1, { buyer: 'شرکت الف', issuedAt: '2026-05-01T08:00:00+03:30', items: [line('SKU-A', 2, 1000, 200), line('SKU-B', 1, 500, 50)] });
    const second = await seed(T1, { buyer: 'شرکت ب', status: InvoiceStatus.PAID, issuedAt: '2026-05-02T08:00:00+03:30', items: [line('SKU-A', 1, 1000, 100)] });
    await seed(T1, { buyer: 'شرکت ب', subject: InvoiceSubject.RETURN, relatedInvoiceId: second, issuedAt: '2026-05-03T08:00:00+03:30', items: [line('SKU-A', 1, 1000, 100)] });
    await seed(T1, { buyer: 'شرکت الف', status: InvoiceStatus.DRAFT, issuedAt: '2026-05-04T08:00:00+03:30', items: [line('SKU-A', 7, 1000, 700)] });
    await seed(T1, { buyer: 'شرکت الف', issuedAt: '2026-06-20T08:00:00+03:30', items: [line('SKU-A', 1, 1000, 100)] });
    await seed(T2, { buyer: 'شرکت الف', issuedAt: '2026-05-10T08:00:00+03:30', items: [line('SKU-A', 100, 1000, 10000)] });
  }, 120000);

  afterAll(async () => {
    await ds?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin?.destroy();
  });

  const may = { from: '2026-05-01', to: '2026-05-31' };

  it('groups by item in May: the return subtracts and the draft is left out (amounts in rials)', async () => {
    // SKU-A: qty 2+1-1 = 2, net 2000+1000-1000 = 2000, VAT 200+100-100 = 200. SKU-B: 1, 500, 50.
    expect(rows(await run(T1, { groupBy: 'item', ...may }))).toEqual([
      ['SKU-A', '2', 2000, 200],
      ['SKU-B', '1', 500, 50],
    ]);
  });

  it('groups by customer in May', async () => {
    // شرکت الف: 2000 + 500 = 2500, VAT 250. شرکت ب: sale 1000 minus return 1000 = 0.
    expect(rows(await run(T1, { groupBy: 'customer', ...may }))).toEqual([
      ['شرکت الف', '3', 2500, 250],
      ['شرکت ب', '0', 0, 0],
    ]);
  });

  it('without a range it includes the June invoice', async () => {
    expect(rows(await run(T1, { groupBy: 'item' }))).toEqual([
      ['SKU-A', '3', 3000, 300],
      ['SKU-B', '1', 500, 50],
    ]);
  });

  it('never shows another company\'s invoices, and an empty range gives an empty list', async () => {
    // T2: qty 100, net 100000, VAT 10000.
    expect(rows(await run(T2, { groupBy: 'item' }))).toEqual([['SKU-A', '100', 100000, 10000]]);
    expect((await run(T1, { groupBy: 'item', from: '2025-01-01', to: '2025-01-31' })).groups).toEqual([]);
    expect((await run('33333333-3333-4333-8333-333333333333', { groupBy: 'item' })).groups).toEqual([]);
  });

  it('refuses a reversed range and renders XLSX and PDF', async () => {
    await expect(service.build(T1, { groupBy: 'item', from: '2026-06-01', to: '2026-05-01' })).rejects.toBeInstanceOf(BadRequestException);
    const exporter = new ReportExportService(undefined as never);
    const { table } = await service.build(T1, { groupBy: 'item', ...may });
    expect((await exporter.render(table, 'xlsx', 'sales-by-item')).body.subarray(0, 2).toString()).toBe('PK');
    expect((await exporter.render(table, 'pdf', 'sales-by-item')).body.subarray(0, 4).toString()).toBe('%PDF');
  });
});
