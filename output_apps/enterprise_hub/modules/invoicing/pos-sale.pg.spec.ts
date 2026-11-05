/**
 * POS / quick sales against a REAL PostgreSQL: the three customer identity levels, exact-phone
 * reuse, the single walk-in customer, idempotent retries (also concurrent ones), payments split
 * across cash, bank and POS clearing, and automatic posting of revenue, tax, COGS and stock.
 * Skipped unless ROXIRA_TEST_PG_HOST is set; each run creates and drops its own database:
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55441 npx jest modules/invoicing/pos-sale.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { ContactMessageEntity } from '../crm/entities/contact-message.entity';
import { CrmLeadEntity } from '../crm/entities/crm-lead.entity';
import { CrmRepository } from '../crm/repositories/crm.repository';
import { CustomerIdentityService, WALK_IN_NAME } from '../crm/services/customer-identity.service';
import { CurrencyService } from '../currency/services/currency.service';
import { FifoBatchEntity } from '../inventory/entities/fifo-batch.entity';
import { StockItemEntity } from '../inventory/entities/stock-item.entity';
import { WarehouseEntity } from '../inventory/entities/warehouse.entity';
import { InventoryRepository } from '../inventory/repositories/inventory.repository';
import { InventoryService } from '../inventory/services/inventory.service';
import { TenantEntity } from '../tenants/entities/tenant.entity';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicePostingService } from './services/invoice-posting.service';
import { InvoicingService } from './services/invoicing.service';
import { PosSaleService } from './services/pos-sale.service';
import { CreatePosSaleDto } from './dto/pos-sale.dto';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { fixtureVatRates } from './__fixtures__/vat-rate.fixture';
import { InvoiceSubject } from './enums/invoice-kind.enum';

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

describePg('POS sales on PostgreSQL', () => {
  const db = `pos_${process.pid}`;
  let admin: DataSource;
  let ds: DataSource;
  let pos: PosSaleService;
  let inventory: InventoryService;
  const q = <R = Record<string, string>>(sql: string, params: unknown[] = []) => ds.query(sql, params) as Promise<R[]>;

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${db}"`);
    ds = await new DataSource(options(db)).initialize();
    await ds.runMigrations();
    await q(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'شرکت ما', 'ours'), ($2, 'دیگری', 'other')`, [T1, T2]);

    const accounting = new AccountingService(
      new AccountingRepository(new TenantScope(ds)),
      { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService,
    );
    const inventoryRepo = new InventoryRepository(
      ds.getRepository(WarehouseEntity),
      ds.getRepository(StockItemEntity),
      ds.getRepository(FifoBatchEntity),
      ds,
    );
    inventory = new InventoryService(inventoryRepo);
    const invoicingRepo = new InvoicingRepository(ds.getRepository(InvoiceEntity), ds);
    const posting = new InvoicePostingService(
      invoicingRepo,
      inventory,
      accounting,
      new PostingRulesService(new PostingRulesRepository(new TenantScope(ds)), accounting),
    );
    const crm = new CrmRepository(ds.getRepository(CrmLeadEntity), ds.getRepository(ContactMessageEntity));
    const identity = new CustomerIdentityService(crm);
    const tenants = new TenantsRepository(ds.getRepository(TenantEntity));
    // The real app posts through a queue; here the event is handled in-process, in order.
    const queue = {
      add: async (_job: string, event: { tenantId: string; invoiceId: string; status: string }) =>
        posting.handle(event as never),
    };
    const invoicing = new InvoicingService(
      invoicingRepo,
      { getRate: () => 1, round: (v: number) => v } as unknown as CurrencyService,
      crm,
      inventoryRepo,
      tenants,
      queue as never,
      identity,
      fixtureVatRates(),
    );
    pos = new PosSaleService(invoicing, invoicingRepo, inventoryRepo, identity, tenants);

    await inventory.createStockItem(T1, { sku: 'P-1', barcode: '6260000000011', name: 'کالای صندوق' } as never);
    await inventory.receiveStock(T1, { sku: 'P-1', quantity: 50, unitPurchaseCost: 60 } as never);
  }, 180_000);

  afterAll(async () => {
    await ds?.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.destroy();
  });

  let n = 0;
  const sale = (over: Partial<CreatePosSaleDto> = {}): CreatePosSaleDto => ({
    idempotencyKey: `pos-test-${++n}-${Date.now()}`,
    lines: [{ code: '6260000000011', quantity: 2, unitPrice: 500, vatRate: 10 }],
    payments: [{ method: 'CASH', amount: 1100 }],
    ...over,
  });
  const stock = async () =>
    Number((await q('SELECT quantity FROM erp_stock_items WHERE tenant_id=$1 AND sku=$2', [T1, 'P-1']))[0].quantity);
  const balance = async (name: string) =>
    Number(
      (await q<{ b: string }>(`SELECT COALESCE(SUM(balance),0) AS b FROM fin_chart_of_accounts WHERE tenant_id=$1 AND name LIKE $2`, [T1, name]))[0].b,
    );

  it('anonymous sale by barcode: walk-in customer, consumer type 2, posted end to end', async () => {
    const before = await stock();
    const result = await pos.createSale(T1, sale());
    expect(result).toMatchObject({ replayed: false, customerLevel: 'anonymous' });
    expect(result.invoice).toMatchObject({ einvoiceType: 2, status: 'PAID', finalPayable: 1100 });
    expect(result.invoice.buyerInfo.name).toBe(WALK_IN_NAME);

    const row = (await q<{ journal_entry_id: number; paid_journal_entry_id: number; posting_error: string | null }>(
      'SELECT journal_entry_id, paid_journal_entry_id, posting_error FROM invoices WHERE id=$1',
      [result.invoice.id],
    ))[0];
    expect(row.posting_error).toBeNull();
    expect(row.journal_entry_id).not.toBeNull();
    expect(row.paid_journal_entry_id).not.toBeNull();
    expect(await stock()).toBe(before - 2);
    expect(await balance('درآمد فروش%')).toBe(-1000);
    expect(await balance('%دریافتنی%')).toBe(0); // issued then fully settled
    expect(await balance('موجودی نقد و بانک')).toBe(1100);
    expect(await balance('بهای تمام%')).toBe(120);
  });

  it('only one walk-in customer exists however many anonymous sales are made', async () => {
    await pos.createSale(T1, sale());
    await pos.createSale(T1, sale());
    expect(await q(`SELECT 1 FROM crm_leads WHERE tenant_id=$1 AND is_walk_in`, [T1])).toHaveLength(1);
    expect(await q(`SELECT 1 FROM crm_leads WHERE tenant_id=$1 AND NOT is_walk_in`, [T1])).toHaveLength(0);
  });

  it('phone only creates a minimal customer once; name and phone reuses it', async () => {
    const first = await pos.createSale(T1, sale({ customer: { phone: '0912 555 0001' } }));
    expect(first).toMatchObject({ customerLevel: 'phone', customerCreated: true });
    const second = await pos.createSale(T1, sale({ customer: { phone: '+98 912 555 0001', name: 'نام دیگر' } }));
    expect(second).toMatchObject({ customerLevel: 'name_phone', customerCreated: false });
    expect(second.invoice.customerId).toBe(first.invoice.customerId);
    const lead = (await q<{ marketing_consent: boolean; email: string | null; source: string; phone_normalized: string }>(
      `SELECT marketing_consent, email, source, phone_normalized FROM crm_leads WHERE id=$1`,
      [first.invoice.customerId],
    ))[0];
    expect(lead).toMatchObject({ marketing_consent: false, email: null, source: 'POS', phone_normalized: '09125550001' });

    const named = await pos.createSale(T1, sale({ customer: { phone: '09125550002', name: 'سارا احمدی' } }));
    expect(named).toMatchObject({ customerLevel: 'name_phone', customerCreated: true });
    expect(named.invoice.buyerInfo.name).toBe('سارا احمدی');
    // The same phone in another tenant is not this customer (tenant 2 has no stock, so use a service line).
    const other = await pos.createSale(T2, sale({ customer: { phone: '09125550001' }, lines: [{ description: 'خدمت', quantity: 1, unitPrice: 1000, vatRate: 0 }], payments: [{ method: 'CASH', amount: 1000 }] }));
    expect(other.customerCreated).toBe(true);
    expect(other.invoice.customerId).not.toBe(first.invoice.customerId);
  });

  it('a retry with the same key returns the same invoice and posts nothing twice', async () => {
    const dto = sale();
    const before = await stock();
    const first = await pos.createSale(T1, dto);
    const retry = await pos.createSale(T1, dto);
    expect(retry.replayed).toBe(true);
    expect(retry.invoice.id).toBe(first.invoice.id);
    expect(await stock()).toBe(before - 2);
    expect(await q(`SELECT 1 FROM invoices WHERE idempotency_key=$1`, [dto.idempotencyKey])).toHaveLength(1);
    expect(await q(`SELECT 1 FROM fin_journal_entries WHERE entry_number LIKE $1`, [`INV-${first.invoice.id}-%`])).toHaveLength(2);
  });

  it('concurrent duplicates collapse to one invoice', async () => {
    const dto = sale();
    const before = await stock();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => pos.createSale(T1, dto)));
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<PosSaleService['createSale']>>> => r.status === 'fulfilled');
    expect(new Set(ok.map((r) => r.value.invoice.id)).size).toBe(1);
    expect(await q(`SELECT 1 FROM invoices WHERE idempotency_key=$1`, [dto.idempotencyKey])).toHaveLength(1);
    expect(await stock()).toBe(before - 2);
  });

  it('the same key with a different sale is refused', async () => {
    const dto = sale();
    await pos.createSale(T1, dto);
    await expect(pos.createSale(T1, { ...dto, payments: [{ method: 'CARD', amount: 1100 }] })).rejects.toBeInstanceOf(ConflictException);
  });

  it('keys are per tenant', async () => {
    const dto = sale({ lines: [{ description: 'خدمت', quantity: 1, unitPrice: 1000, vatRate: 0 }], payments: [{ method: 'CASH', amount: 1000 }] });
    const a = await pos.createSale(T1, dto);
    const b = await pos.createSale(T2, dto);
    expect(b.replayed).toBe(false);
    expect(b.invoice.id).not.toBe(a.invoice.id);
  });

  it('the receivable line has no text of its own, so the ledger shows the voucher description with the invoice number', async () => {
    const { invoice } = await pos.createSale(T1, sale({ customer: { phone: '09120000777' } }));
    const rows = await q<{ description: string | null; entry_description: string }>(
      `SELECT l.description, e.description AS entry_description FROM fin_journal_entry_lines l
         JOIN fin_journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
         JOIN fin_chart_of_accounts a ON a.id = l.account_id
        WHERE e.entry_number = $1 AND a.name LIKE '%دریافتنی%'`,
      ['INV-' + invoice.id + '-ISSUED'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBeNull();
    expect(rows[0].entry_description).toContain(invoice.taxInvoiceNumber);
  });

  it('splits payments: card goes to POS clearing, cash to the cash account', async () => {
    const clearingBefore = await balance('حساب واسط پوز');
    const cashBefore = await balance('موجودی نقد و بانک');
    await pos.createSale(T1, sale({ payments: [{ method: 'CARD', amount: 600 }, { method: 'CASH', amount: 500 }] }));
    expect((await balance('حساب واسط پوز')) - clearingBefore).toBe(600);
    expect((await balance('موجودی نقد و بانک')) - cashBefore).toBe(500);
  });

  it('refuses payments that do not equal the payable, unknown codes and missing stock', async () => {
    await expect(pos.createSale(T1, sale({ payments: [{ method: 'CASH', amount: 1000 }] }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pos.createSale(T1, sale({ lines: [{ code: 'NOPE', quantity: 1, unitPrice: 1 }] }))).rejects.toThrow(/یافت نشد/);
    await expect(
      pos.createSale(T1, sale({ lines: [{ code: 'P-1', quantity: 1e6, unitPrice: 1 }], payments: [{ method: 'CASH', amount: 1_100_000 }] })),
    ).rejects.toThrow(/کافی نیست/);
  });

  it('line and sale discounts: VAT on the discounted base, revenue posted net (E1.3)', async () => {
    const revenueBefore = await balance('درآمد فروش%');
    const vatBefore = await balance('مالیات بر ارزش افزوده پرداختنی');
    const cashBefore = await balance('موجودی نقد و بانک');
    // 2 × 500 = 1000, 10% line discount -> 900; service 1000 at 0% VAT; sale discount 190 spread
    // 90 / 100 -> taxable 810 and 900; VAT 81 + 0; payable 1791.
    const result = await pos.createSale(
      T1,
      sale({
        lines: [
          { code: 'P-1', quantity: 2, unitPrice: 500, discountPercent: 10, vatRate: 10 },
          { description: 'نصب', quantity: 1, unitPrice: 1000, vatRate: 0 },
        ],
        invoiceDiscount: 190,
        payments: [{ method: 'CASH', amount: 1791 }],
      }),
    );
    expect(result.invoice).toMatchObject({ totalDiscount: 290, invoiceDiscount: 190, totalTax: 81, finalPayable: 1791 });
    expect(result.invoice.items.map((i) => i.discount)).toEqual([100, 0]);
    expect((await balance('درآمد فروش%')) - revenueBefore).toBe(-1710);
    expect((await balance('مالیات بر ارزش افزوده پرداختنی')) - vatBefore).toBe(-81);
    expect((await balance('موجودی نقد و بانک')) - cashBefore).toBe(1791);
    // Paying the undiscounted amount is refused.
    await expect(
      pos.createSale(T1, sale({ invoiceDiscount: 100, payments: [{ method: 'CASH', amount: 1100 }] })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  const returnOf = (invoiceId: string, refund: 'ORIGINAL' | 'CREDIT', quantity = 1): CreatePosSaleDto => ({
    idempotencyKey: `pos-ret-${++n}-${Date.now()}`,
    lines: [{ originalLine: 0, quantity }],
    returnOf: { invoiceId, refund },
  });

  it('a return refunds by the sale methods, restocks at the sale cost and is linked to the sale (E-04)', async () => {
    const sold = (await pos.createSale(T1, sale({ payments: [{ method: 'CARD', amount: 1100 }] }))).invoice;
    const stockBefore = await stock();
    const clearingBefore = await balance('حساب واسط پوز');
    const cogsBefore = await balance('بهای تمام%');
    const receivableBefore = await balance('%دریافتنی%');

    const ret = (await pos.createSale(T1, returnOf(sold.id, 'ORIGINAL'))).invoice;
    expect(ret).toMatchObject({ subject: InvoiceSubject.RETURN, relatedInvoiceId: sold.id, status: 'PAID', finalPayable: 550 });
    const row = (await q<{ related_invoice_id: string; posting_error: string | null }>(
      'SELECT related_invoice_id, posting_error FROM invoices WHERE id=$1',
      [ret.id],
    ))[0];
    expect(row).toEqual({ related_invoice_id: sold.id, posting_error: null });
    expect(await stock()).toBe(stockBefore + 1);
    expect((await balance('بهای تمام%')) - cogsBefore).toBe(-60); // back at the 60 the sale recorded
    expect((await balance('حساب واسط پوز')) - clearingBefore).toBe(-550); // refunded on the card
    expect(await balance('%دریافتنی%')).toBe(receivableBefore);

    // One unit left to return; a second return of two is refused, of one accepted.
    await expect(pos.createSale(T1, returnOf(sold.id, 'ORIGINAL', 2))).rejects.toThrow(/باقی‌ماندهٔ قابل برگشت/);
    await pos.createSale(T1, returnOf(sold.id, 'ORIGINAL', 1));
    await expect(pos.createSale(T1, returnOf(sold.id, 'ORIGINAL', 1))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('two concurrent returns of a one-unit sale: one wins, the other is refused, stock and ledger move once', async () => {
    const sold = (
      await pos.createSale(T1, sale({ lines: [{ code: 'P-1', quantity: 1, unitPrice: 500 }], payments: [{ method: 'CASH', amount: 550 }] }))
    ).invoice;
    const stockBefore = await stock();
    const cashBefore = await balance('موجودی نقد و بانک');

    const results = await Promise.allSettled([
      pos.createSale(T1, returnOf(sold.id, 'ORIGINAL', 1)),
      pos.createSale(T1, returnOf(sold.id, 'ORIGINAL', 1)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(BadRequestException);
    expect(String(refused.reason.message)).toMatch(/باقی‌ماندهٔ قابل برگشت/);

    const returns = await q<{ posting_error: string | null; journal_entry_id: string | null }>(
      'SELECT posting_error, journal_entry_id FROM invoices WHERE related_invoice_id=$1',
      [sold.id],
    );
    expect(returns).toHaveLength(1);
    expect(returns[0].posting_error).toBeNull();
    expect(await stock()).toBe(stockBefore + 1);
    expect((await balance('موجودی نقد و بانک')) - cashBefore).toBe(-550);
  });

  it('a return of a discounted sale refunds what was paid, VAT from the original line, also under the lock', async () => {
    // 2 × 500 = 1000, sale discount 100 -> taxable 900, VAT 10% = 90, paid 990.
    const sold = (
      await pos.createSale(T1, sale({ invoiceDiscount: 100, payments: [{ method: 'CASH', amount: 990 }] }))
    ).invoice;
    expect(sold).toMatchObject({ invoiceDiscount: 100, totalTax: 90, finalPayable: 990 });
    const cashBefore = await balance('موجودی نقد و بانک');

    // One unit back: half the discount (50) -> taxable 450, VAT 45, refund 495 exactly.
    const first = (await pos.createSale(T1, returnOf(sold.id, 'ORIGINAL', 1))).invoice;
    expect(first).toMatchObject({ totalAmount: 500, totalDiscount: 50, totalTax: 45, finalPayable: 495 });
    expect((await balance('موجودی نقد و بانک')) - cashBefore).toBe(-495);

    // The last unit takes the rest of the discount (50): another 495, 990 in all. Two concurrent
    // returns of that last unit: one refunds 495, the other is refused; the ledger moves once.
    const results = await Promise.allSettled([
      pos.createSale(T1, returnOf(sold.id, 'ORIGINAL', 1)),
      pos.createSale(T1, returnOf(sold.id, 'ORIGINAL', 1)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const won = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ invoice: { finalPayable: number } }>).value;
    expect(won.invoice.finalPayable).toBe(495);
    expect((await balance('موجودی نقد و بانک')) - cashBefore).toBe(-990);
  });

  it('a return on credit leaves the amount on the known customer; refused for the walk-in customer', async () => {
    const known = (await pos.createSale(T1, sale({ customer: { phone: '09120000123' } }))).invoice;
    const receivableBefore = await balance('%دریافتنی%');
    const cashBefore = await balance('موجودی نقد و بانک');
    const ret = (await pos.createSale(T1, returnOf(known.id, 'CREDIT'))).invoice;
    expect(ret).toMatchObject({ status: 'ISSUED', customerId: known.customerId, relatedInvoiceId: known.id });
    expect((await balance('%دریافتنی%')) - receivableBefore).toBe(-550);
    expect(await balance('موجودی نقد و بانک')).toBe(cashBefore);

    const walkIn = (await pos.createSale(T1, sale())).invoice;
    await expect(pos.createSale(T1, returnOf(walkIn.id, 'CREDIT'))).rejects.toThrow(/مشتری گذری/);
    await expect(pos.createSale(T2, returnOf(walkIn.id, 'ORIGINAL'))).rejects.toThrow(/یافت نشد/);
  });

  it('every voucher balances', async () => {
    expect(await q(`SELECT journal_entry_id FROM fin_journal_entry_lines GROUP BY journal_entry_id HAVING SUM(debit) <> SUM(credit)`)).toEqual([]);
  });
});
