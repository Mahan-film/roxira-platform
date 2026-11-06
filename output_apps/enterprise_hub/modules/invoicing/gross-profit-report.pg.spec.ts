/**
 * Gross profit report on a REAL PostgreSQL: the route's service reads the SALE invoices of the JWT
 * tenant only, takes revenue from the invoice lines and cost from the recorded postings, and filters
 * by issue date. Skipped unless ROXIRA_TEST_PG_HOST is set; each run creates and drops its own database.
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ReportExportService } from '../accounting/services/report-export.service';
import { GrossProfitReportQueryDto } from './dto/gross-profit-report.dto';
import { InvoiceEntity, InvoicePostingMeta } from './entities/invoice.entity';
import { InvoiceDirection, InvoiceSubject } from './enums/invoice-kind.enum';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { GrossProfitReportService } from './services/gross-profit-report.service';

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

const costLine = (
  sku: string,
  quantity: number,
  unitCost: number,
  value: number,
): InvoicePostingMeta['lines'][number] => ({
  sku,
  quantity,
  unitCost,
  value,
  moved: 'OUT',
  warehouseId: null,
});

const meta = (stockValue: number, lines: InvoicePostingMeta['lines']): InvoicePostingMeta => ({ stockValue, lines });

describePg('Gross profit report on PostgreSQL', () => {
  const dbName = `rx_gross_profit_rep_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let ds: DataSource;
  let service: GrossProfitReportService;
  let nextNumber = 1;

  const seed = async (
    tenantId: string,
    over: Omit<Partial<InvoiceEntity>, 'issuedAt' | 'items' | 'buyerInfo'> & {
      items: ReturnType<typeof line>[];
      buyer: string;
      issuedAt: string;
    },
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
        postingMeta: null,
        issuedAt: new Date(issuedAt),
        ...rest,
      } as InvoiceEntity),
    );
    return saved.id;
  };

  const run = async (tenant: string, query: GrossProfitReportQueryDto) =>
    (await service.build(tenant, query)).json as {
      groups: Array<{
        key: string;
        revenue: number;
        cogs: number;
        profit: number;
        marginBp: string | null;
        margin: string;
      }>;
    };
  const rows = (json: Awaited<ReturnType<typeof run>>) => json.groups.map((g) => [g.key, g.revenue, g.cogs, g.profit]);
  const margins = (json: Awaited<ReturnType<typeof run>>) => json.groups.map((g) => [g.key, g.marginBp, g.margin]);

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
    ds = await new DataSource(options(dbName)).initialize();
    await ds.runMigrations();
    service = new GrossProfitReportService(new InvoicingRepository(ds.getRepository(InvoiceEntity), ds));

    // INV-1: A qty5 @1000 tax500 -> revenue 5000, cost 3000; B qty1 @500 tax50 -> revenue 500, cost 200.
    await seed(T1, {
      buyer: 'شرکت نمونه',
      issuedAt: '2026-05-01T08:00:00+03:30',
      items: [line('A', 5, 1000, 500), line('B', 1, 500, 50)],
      postingMeta: meta(3200, [costLine('A', 5, 600, 3000), costLine('B', 1, 200, 200)]),
    });
    // INV-2: A qty1 @1000 tax100 -> revenue 1000, cost 600.
    await seed(T1, {
      buyer: 'شرکت نمونه',
      issuedAt: '2026-05-02T08:00:00+03:30',
      items: [line('A', 1, 1000, 100)],
      postingMeta: meta(600, [costLine('A', 1, 600, 600)]),
    });
    // INV-3: not posted, so it carries revenue but no cost; June, so the May range leaves it out.
    await seed(T1, {
      buyer: 'شرکت نمونه',
      issuedAt: '2026-06-20T08:00:00+03:30',
      items: [line('A', 1, 1000, 100)],
    });
    // T2: A qty100 @1000 tax10000 -> revenue 100000, cost 60000.
    await seed(T2, {
      buyer: 'شرکت نمونه',
      issuedAt: '2026-05-10T08:00:00+03:30',
      items: [line('A', 100, 1000, 10000)],
      postingMeta: meta(60000, [costLine('A', 100, 600, 60000)]),
    });
  }, 120000);

  afterAll(async () => {
    await ds?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin?.destroy();
  });

  const may = { from: '2026-05-01', to: '2026-05-31' };

  it('groups by item in May: revenue, recorded cost and margin in basis points', async () => {
    // A: revenue 5000+1000=6000, COGS 3000+600=3600, profit 2400, marginBp 4000.
    // B: revenue 500, COGS 200, profit 300, marginBp 6000.
    const json = await run(T1, { groupBy: 'item', ...may });
    expect(rows(json)).toEqual([
      ['A', 6000, 3600, 2400],
      ['B', 500, 200, 300],
    ]);
    expect(margins(json)).toEqual([
      ['A', '4000', '40.00%'],
      ['B', '6000', '60.00%'],
    ]);
  });

  it('groups by customer in May', async () => {
    // شرکت نمونه: revenue 6000+500=6500, COGS 3600+200=3800, profit 2700.
    expect(rows(await run(T1, { groupBy: 'customer', ...may }))).toEqual([['شرکت نمونه', 6500, 3800, 2700]]);
  });

  it('groups by invoice in May', async () => {
    // INV-1: revenue 5500, cost 3200, profit 2300. INV-2: revenue 1000, cost 600, profit 400.
    expect(rows(await run(T1, { groupBy: 'invoice', ...may }))).toEqual([
      ['INV-1', 5500, 3200, 2300],
      ['INV-2', 1000, 600, 400],
    ]);
  });

  it('without a range it includes the June invoice, which has no recorded cost', async () => {
    // A: revenue 6000+1000=7000, COGS 3600, profit 3400. B: 500, 200, 300.
    expect(rows(await run(T1, { groupBy: 'item' }))).toEqual([
      ['A', 7000, 3600, 3400],
      ['B', 500, 200, 300],
    ]);
  });

  it("never shows another company's invoices, and an empty range gives an empty list", async () => {
    // T2: revenue 100000, COGS 60000, profit 40000.
    expect(rows(await run(T2, { groupBy: 'item' }))).toEqual([['A', 100000, 60000, 40000]]);
    expect((await run(T1, { groupBy: 'item', from: '2025-01-01', to: '2025-01-31' })).groups).toEqual([]);
    expect((await run('33333333-3333-4333-8333-333333333333', { groupBy: 'item' })).groups).toEqual([]);
  });

  it('refuses a reversed range and renders XLSX and PDF', async () => {
    await expect(service.build(T1, { groupBy: 'item', from: '2026-06-01', to: '2026-05-01' })).rejects.toBeInstanceOf(BadRequestException);
    const exporter = new ReportExportService(undefined as never);
    const { table } = await service.build(T1, { groupBy: 'item', ...may });
    expect((await exporter.render(table, 'xlsx', 'gross-profit-by-item')).body.subarray(0, 2).toString()).toBe('PK');
    expect((await exporter.render(table, 'pdf', 'gross-profit-by-item')).body.subarray(0, 4).toString()).toBe('%PDF');
  });
});
