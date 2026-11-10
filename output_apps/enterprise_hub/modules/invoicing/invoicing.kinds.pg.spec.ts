import 'reflect-metadata';
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
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T,
} from '../../test/support/test-pg';

const SKU = 'KIND-1';

describePg('invoice kinds on PostgreSQL', () => {
  let testDb: TestDatabaseContext;
  let invoicing: InvoicingRepository;
  let posting: InvoicePostingService;
  let inventory: InventoryService;
  const q = <R = Record<string, string>>(sql: string, params: unknown[] = []) =>
    testDb.rawQuery<R>(sql, params);

  beforeAll(async () => {
    testDb = await createTestDatabase('kinds');
    const accounting = new AccountingService(
      new AccountingRepository(testDb.scope),
      { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService,
    );
    inventory = new InventoryService(
      new InventoryRepository(
        testDb.app.getRepository(WarehouseEntity),
        testDb.app.getRepository(StockItemEntity),
        testDb.app.getRepository(FifoBatchEntity),
        testDb.app,
      ),
    );
    invoicing = new InvoicingRepository(testDb.app.getRepository(InvoiceEntity), testDb.app);
    posting = new InvoicePostingService(
      invoicing,
      inventory,
      accounting,
      new PostingRulesService(new PostingRulesRepository(testDb.scope), accounting),
      new StockDocumentsRepository(testDb.app),
    );
    await inventory.createStockItem(T, { sku: SKU, barcode: SKU, name: 'kind item' } as never);
  }, 120_000);

  afterAll(async () => {
    await testDb?.cleanup();
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

  it('purchase -> sale -> return -> cancel keeps stock, FIFO value and ledger consistent', async () => {
    // Purchase of 10 at net 100 each (1000) + VAT 100.
    const purchase = await make({ direction: InvoiceDirection.PURCHASE });
    await issue(purchase.id);
    expect((await invoicing.findById(T, purchase.id))?.postingError).toBeNull();
    expect(await stock()).toBe(10);
    const layers = await q<{ quantity_remaining: string; unit_purchase_cost: string }>(
      'SELECT quantity_remaining, unit_purchase_cost FROM inventory_fifo_batches WHERE tenant_id=$1 AND sku=$2',
      [T, SKU],
    );
    expect(layers).toHaveLength(1);
    expect(Number(layers[0].unit_purchase_cost)).toBe(100);
    expect(await balance('1030')).toBe(1000);
    expect(await balance('1401')).toBe(100);
    expect(await balance('2010')).toBe(-1100);

    // Sale of 4 (revenue 400 + VAT 40): stock out at the layer cost 100 -> COGS 400.
    const sale = await make({
      totalAmount: 400, totalTax: 40, finalPayable: 440,
      items: [{ itemId: 1, sku: SKU, description: 'x', quantity: 4, unitPrice: 100, discount: 0, vatRate: 0.1, tax: 40, total: 440 }] as never,
    });
    await issue(sale.id);
    expect(await stock()).toBe(6);
    expect(await balance('5101')).toBe(400);
    expect(await balance('1030')).toBe(600);
    expect(await balance('1020')).toBe(440);

    // Return 1 unit: stock back at cost 100, revenue and AR reduced.
    const ret = await make({
      subject: InvoiceSubject.RETURN, relatedInvoiceId: sale.id,
      totalAmount: 100, totalTax: 10, finalPayable: 110,
      items: [{ itemId: 1, sku: SKU, description: 'x', quantity: 1, unitPrice: 100, discount: 0, vatRate: 0.1, tax: 10, total: 110 }] as never,
    });
    await issue(ret.id);
    expect(await stock()).toBe(7);
    expect(await balance('5101')).toBe(300);
    expect(await balance('1030')).toBe(700);
    expect(await balance('1020')).toBe(330);

    // Cancelling the sale mirrors its posting exactly and returns its 4 units.
    await posting.postCancelled({ tenantId: T, invoiceId: sale.id, status: InvoiceStatus.CANCELLED });
    expect(await stock()).toBe(11);
    expect(await balance('1020')).toBe(-110); // only the return's credit is left
    expect(await balance('5101')).toBe(-100);

    // The register shows what moved: a delivery for the sale, a receipt for the purchase, a signed
    // adjustment for the return, each tied to its invoice and (for stock) carrying the voucher id.
    const docs = await q<{ doc_type: string; source_invoice_id: string; journal_entry_id: number | null }>(
      `SELECT doc_type, source_invoice_id, journal_entry_id FROM erp_stock_documents WHERE tenant_id=$1 ORDER BY id`,
      [T],
    );
    expect(docs.map((d) => d.doc_type)).toEqual(['PURCHASE_RECEIPT', 'SALES_DELIVERY', 'ADJUSTMENT']);
    expect(docs.every((d) => d.journal_entry_id !== null)).toBe(true);
    expect(docs[1].source_invoice_id).toBe(sale.id);

    // Every voucher balances and the books net to zero.
    const unbalanced = await q(
      `SELECT journal_entry_id FROM fin_journal_entry_lines GROUP BY journal_entry_id HAVING SUM(debit) <> SUM(credit)`,
    );
    expect(unbalanced).toEqual([]);
    const total = (await q<{ t: string }>(`SELECT COALESCE(SUM(debit - credit), 0) AS t FROM fin_journal_entry_lines`))[0].t;
    expect(Number(total)).toBe(0);
  });
});
