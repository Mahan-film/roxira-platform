import { TenantScope } from '../access/services/tenant-scope';
/**
 * A purchase and a sale on the M1 fixture chart (e2e/fixtures/sample-company) with NO posting-rules
 * mapping: each role must land on its proper account (#504, #497a), not on notes receivable 1110 or
 * prepayments 1401, and a stock-only purchase must not create 5201. Skipped unless ROXIRA_TEST_PG_HOST is set; each run creates and drops its own
 * database:
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55441 npx jest modules/invoicing/invoicing.role-accounts.pg.spec.ts
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { ChartOfAccountEntity } from '../accounting/entities/chart-of-account.entity';
import { JournalEntryLineEntity } from '../accounting/entities/journal-entry-line.entity';
import { JournalEntryEntity } from '../accounting/entities/journal-entry.entity';
import { PeriodLockEntity } from '../accounting/entities/period-lock.entity';
import { AccountType } from '../accounting/enums/accounting.enum';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { CurrencyService } from '../currency/services/currency.service';
import { FifoBatchEntity } from '../inventory/entities/fifo-batch.entity';
import { StockItemEntity } from '../inventory/entities/stock-item.entity';
import { WarehouseEntity } from '../inventory/entities/warehouse.entity';
import { InventoryRepository } from '../inventory/repositories/inventory.repository';
import { StockDocumentsRepository } from '../inventory/repositories/stock-documents.repository';
import { InventoryService } from '../inventory/services/inventory.service';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoiceDirection, InvoiceSubject } from './enums/invoice-kind.enum';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicePostingService } from './services/invoice-posting.service';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const T = '11111111-1111-4111-8111-111111111111';
const SKU = 'ROLE-1';

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

describePg('role accounts on the fixture chart (PostgreSQL)', () => {
  const db = `roles_${process.pid}`;
  let admin: DataSource;
  let ds: DataSource;
  let invoicing: InvoicingRepository;
  let posting: InvoicePostingService;
  let inventory: InventoryService;
  const q = <R = Record<string, string>>(sql: string, params: unknown[] = []) =>
    ds.query(sql, params) as Promise<R[]>;

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
    invoicing = new InvoicingRepository(ds.getRepository(InvoiceEntity), ds);
    posting = new InvoicePostingService(
      invoicing,
      inventory,
      accounting,
      new PostingRulesService(new PostingRulesRepository(new TenantScope(ds)), accounting),
      new StockDocumentsRepository(ds),
    );
    const types: Record<string, AccountType> = {
      دارایی: AccountType.ASSET, بدهی: AccountType.LIABILITY, سرمایه: AccountType.EQUITY,
      درآمد: AccountType.REVENUE, هزینه: AccountType.EXPENSE,
    };
    const csv = fs.readFileSync(path.join(__dirname, '../../../../e2e/fixtures/sample-company/chart-of-accounts.csv'), 'utf8');
    await new AccountingRepository(new TenantScope(ds)).insertMissingAccounts(
      T,
      csv.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
        const [code, name, type] = line.split(',');
        return { code, name, accountType: types[type], currency: 'IRR' as never, balance: '0' };
      }),
    );
    await inventory.createStockItem(T, { sku: SKU, barcode: SKU, name: 'kind item' } as never);
  }, 180_000);

  afterAll(async () => {
    await ds?.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.destroy();
  });

  let n = 0;
  const make = (over: Partial<InvoiceEntity>) =>
    invoicing.create(T, {
      taxInvoiceNumber: `K-${++n}`,
      sellerInfo: { name: 's' },
      buyerInfo: { name: 'b' },
      currency: 'IRR' as never,
      totalAmount: 1000,
      totalDiscount: 0,
      totalTax: 100,
      finalPayable: 1100,
      status: InvoiceStatus.ISSUED,
      issuedAt: new Date('2026-09-10T12:00:00Z'),
      items: [{ itemId: 1, sku: SKU, description: 'x', quantity: 10, unitPrice: 100, discount: 0, vatRate: 0.1, tax: 100, total: 1100 }],
      ...over,
    } as Partial<InvoiceEntity>);
  const stock = async () =>
    Number((await q<{ quantity: number }>('SELECT quantity FROM erp_stock_items WHERE tenant_id=$1 AND sku=$2', [T, SKU]))[0].quantity);
  const issue = (id: string) => posting.postIssued({ tenantId: T, invoiceId: id, status: InvoiceStatus.ISSUED });
  const balance = async (code: string) => {
    const rows = await q<{ balance: string }>('SELECT balance FROM fin_chart_of_accounts WHERE tenant_id=$1 AND code=$2', [T, code]);
    return rows.length ? Number(rows[0].balance) : 0;
  };

  const accountOf = async (name: string) =>
    (await q<{ code: string }>('SELECT code FROM fin_chart_of_accounts WHERE tenant_id=$1 AND name=$2', [T, name])).map((r) => r.code);

  it('sale and purchase with no mapping land on trade receivable, payable, output VAT and a real input-VAT account', async () => {
    // Purchase of 10 at net 100 each (1000) + VAT 100, stock only: payable 1100 credit.
    const purchase = await make({ direction: InvoiceDirection.PURCHASE });
    await issue(purchase.id);
    expect((await invoicing.findById(T, purchase.id))?.postingError).toBeNull();
    expect(await balance('1301')).toBe(1000);
    expect(await balance('2101')).toBe(-1100);
    // 1401 exists as «پیش‌پرداخت خرید و اجاره»: untouched; input VAT is a new account under 1402.
    expect(await balance('1401')).toBe(0);
    expect(await balance('1402')).toBe(100);
    expect(await accountOf('مالیات بر ارزش افزوده خرید (اعتبار مالیاتی)')).toEqual(['1402']);
    // Every purchase line is stock, so no purchases account is conjured (#497 a).
    expect(await accountOf('خرید کالا و خدمات')).toEqual([]);

    // Sale of 4 (revenue 400 + VAT 40): receivable 440, COGS at the layer cost 4 x 100.
    const sale = await make({
      totalAmount: 400, totalTax: 40, finalPayable: 440,
      items: [{ itemId: 1, sku: SKU, description: 'x', quantity: 4, unitPrice: 100, discount: 0, vatRate: 0.1, tax: 40, total: 440 }] as never,
    });
    await issue(sale.id);
    expect((await invoicing.findById(T, sale.id))?.postingError).toBeNull();
    expect(await balance('1201')).toBe(440);
    expect(await balance('1110')).toBe(0);
    expect(await balance('4101')).toBe(-400);
    expect(await balance('2201')).toBe(-40);
    expect(await balance('5101')).toBe(400);
    expect(await balance('1301')).toBe(600);
  });

  it('a purchase with a non-stock line creates the purchases account, only then', async () => {
    const service = await make({
      direction: InvoiceDirection.PURCHASE, totalAmount: 500, totalTax: 0, finalPayable: 500,
      items: [{ description: 'اجاره', quantity: 1, unitPrice: 500, discount: 0, vatRate: 0, tax: 0, total: 500 }] as never,
    });
    await issue(service.id);
    expect((await invoicing.findById(T, service.id))?.postingError).toBeNull();
    expect(await accountOf('خرید کالا و خدمات')).toEqual(['5201']);
    expect(await balance('5201')).toBe(500);
    expect(await balance('2101')).toBe(-1600);
  });
});
