import { AccountType } from '../accounting/enums/accounting.enum';
import { minorToDecimal, toMinor } from '../accounting/money';
import { AccountingService } from '../accounting/services/accounting.service';
import { Currency } from '../currency/enums/currency.enum';
import { InventoryService } from '../inventory/services/inventory.service';
import { fakePostingRules } from './__fixtures__/fake-posting-rules';
import {
  LegacyAccounts,
  LegacyInvoice,
  LegacyLine,
  legacyDocumentLines,
  legacySettleLines,
} from './__fixtures__/legacy-invoice-posting';
import { InvoiceEntity } from './entities/invoice.entity';
import { EInvoiceType, InvoiceDirection, InvoiceSubject } from './enums/invoice-kind.enum';
import { InvoiceJurisdiction } from './enums/invoice-jurisdiction.enum';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicePostingService } from './services/invoice-posting.service';

/**
 * Old vs new (#378): the posting rules engine, with the template defaults (no tenant mapping), must give
 * the same invoice vouchers as the line building it replaced (frozen in
 * __fixtures__/legacy-invoice-posting.ts): accounts, sides, amounts, order, entry numbers, dates and
 * entry descriptions. The only intended difference is in the "known differences" test.
 */
const T = 'tenant-a';
const LEGACY: LegacyAccounts = {
  receivable: '1201', sales: '4101', vat: '2301', cash: '1010', inventory: '1301',
  cogs: '5101', purchases: '5201', payable: '2101', vatReceivable: '1401', posClearing: '1015',
};

class Repo {
  rows: InvoiceEntity[] = [];
  async findById(t: string, id: string) { return this.rows.find((r) => r.id === id && r.tenantId === t) ?? null; }
  async findByIdForPosting(t: string, id: string) { return this.findById(t, id); }
  async transaction<R>(work: (m: unknown) => Promise<R>) { return work({}); }
  async findCorrectives() { return []; }
  async updatePosting(t: string, id: string, data: Partial<InvoiceEntity>) {
    Object.assign(this.rows.find((r) => r.id === id && r.tenantId === t) ?? {}, data);
  }
}

const invoice = (o: Partial<InvoiceEntity> = {}): InvoiceEntity => ({
  id: 'inv-1', tenantId: T, taxInvoiceNumber: 'TI-1', direction: InvoiceDirection.SALE, einvoiceType: EInvoiceType.WITH_BUYER,
  subject: InvoiceSubject.ORIGINAL, relatedInvoiceId: null, warehouseId: null, postingMeta: null, idempotencyKey: null, requestHash: null,
  payments: null, jurisdiction: InvoiceJurisdiction.IR, customerId: null, sellerInfo: { name: 'فروشنده' }, buyerInfo: { name: 'خریدار' },
  items: [{ itemId: 3, sku: 'SKU-3', description: 'کالا', quantity: 2, unitPrice: 500, discount: 0, vatRate: 0.1, tax: 100, total: 1100 }],
  currency: Currency.IRR, exchangeRate: 1, fxRate: 1, amountFx: null, baseCurrency: Currency.USD, totalAmount: 1000, totalDiscount: 0,
  totalTax: 100, finalPayable: 1100, baseTotalAmount: 0, baseTotalTax: 0, baseFinalPayable: 0, status: InvoiceStatus.ISSUED,
  issuedAt: new Date('2026-01-01T00:00:00.000Z'), paidAt: new Date('2026-01-02T00:00:00.000Z'), journalEntryId: null, paidJournalEntryId: null,
  reversalJournalEntryId: null, postingError: null, createdAt: new Date('2026-01-01T00:00:00.000Z'), ...o,
}) as InvoiceEntity;

function harness(rows: InvoiceEntity[], stockCost = 600) {
  const repo = new Repo();
  repo.rows.push(...rows);
  let id = 100;
  const accounts: Array<Record<string, unknown>> = [];
  const journal = jest.fn(async (_t: string, dto: object) => ({ id: ++id, entryNumber: (dto as { entryNumber: string }).entryNumber, ...dto }));
  const accounting = {
    listAccounts: jest.fn(async () => accounts),
    createAccount: jest.fn(async (_t: string, dto: { code: string; name: string; accountType: AccountType }) => {
      const created = { id: ++id, ...dto, currency: Currency.IRR, balance: 0 };
      accounts.push(created);
      return created;
    }),
    createJournalEntry: journal,
  } as unknown as AccountingService;
  const inventory = {
    issueStock: jest.fn(async () => ({ totalCost: stockCost })),
    receiveStock: jest.fn(async () => ({ totalCost: stockCost })),
  } as unknown as InventoryService;
  const posting = new InvoicePostingService(repo as unknown as InvoicingRepository, inventory, accounting, fakePostingRules(accounting));
  const dto = (i: number) => journal.mock.calls[i][1] as { entryNumber: string; date: string; description: string; lines: Array<{ accountCode: string; debit?: string; credit?: string; description?: string }> };
  return { repo, posting, journal, dto };
}

const ev = (status: InvoiceStatus) => ({ tenantId: T, invoiceId: 'inv-1', status });
const shape = (lines: Array<{ accountCode: string; debit?: string | number; credit?: string | number }>) =>
  lines.map((l) => ({ accountCode: l.accountCode, debit: toMinor(l.debit ?? 0), credit: toMinor(l.credit ?? 0) }));
const legacyShape = (lines: LegacyLine[]) => shape(lines);
const plain = (i: InvoiceEntity): LegacyInvoice => ({ sale: i.direction === InvoiceDirection.SALE, taxInvoiceNumber: i.taxInvoiceNumber, fxRate: i.fxRate, payments: i.payments });

describe('invoice vouchers: engine vs the frozen old line building', () => {
  it('sale: AR 1100 / sales 1000 + VAT 100, stock out at 600 (hand: 110000, 100000, 10000, -60000 minor)', async () => {
    const { posting, dto } = harness([invoice()]);
    await posting.handle(ev(InvoiceStatus.ISSUED));
    const inv = invoice();
    const old = legacyDocumentLines(plain(inv), { receivable: 110000n, vat: 10000n, net: 100000n, stock: -60000n }, LEGACY, false);
    expect(shape(dto(0).lines)).toEqual(legacyShape(old));
    expect(shape(dto(0).lines).map((l) => l.accountCode)).toEqual(['1201', '5101', '4101', '2301', '1301']);
    expect(dto(0)).toMatchObject({ entryNumber: 'INV-inv-1-ISSUED', description: 'صدور صورتحساب TI-1', date: '2026-01-01T00:00:00.000Z' });
  });

  it('sale with VAT 10% and a discount (hand: 1000 - 100 discount = 900, VAT 90, payable 990; no stock line)', async () => {
    const i = invoice({ items: [{ itemId: null, sku: null, description: 'خدمت', quantity: 1, unitPrice: 1000, discount: 100, vatRate: 0.1, tax: 90, total: 990 }] as never, totalDiscount: 100, totalTax: 90, finalPayable: 990 });
    const { posting, dto } = harness([i]);
    await posting.handle(ev(InvoiceStatus.ISSUED));
    const old = legacyDocumentLines(plain(i), { receivable: 99000n, vat: 9000n, net: 90000n, stock: 0n }, LEGACY, false);
    expect(shape(dto(0).lines)).toEqual(legacyShape(old));
    expect(dto(0).lines).toHaveLength(3);
  });

  it('foreign-currency sale at rate 920000 (hand: 1100 USD x 920000 = 1,012,000,000 rial; VAT 92,000,000)', async () => {
    const i = invoice({ currency: Currency.USD, fxRate: 920000 });
    const { posting, dto } = harness([i]);
    await posting.handle(ev(InvoiceStatus.ISSUED));
    const old = legacyDocumentLines(plain(i), { receivable: toMinor(1012000000), vat: toMinor(92000000), net: toMinor(920000000), stock: -60000n }, LEGACY, false);
    expect(shape(dto(0).lines)).toEqual(legacyShape(old));
    expect(dto(0).lines[0]).toMatchObject({ accountCode: '1201', debit: '1012000000.00' });
  });

  it('purchase with a stock line (hand: stock 600 of net 1000, purchases 400, VAT 100, AP 1100)', async () => {
    const i = invoice({ direction: InvoiceDirection.PURCHASE, status: InvoiceStatus.ISSUED });
    const { posting, dto } = harness([i]);
    await posting.handle(ev(InvoiceStatus.ISSUED));
    const old = legacyDocumentLines(plain(i), { receivable: 110000n, vat: 10000n, net: 100000n, stock: 60000n }, LEGACY, false);
    expect(shape(dto(0).lines)).toEqual(legacyShape(old));
    expect(shape(dto(0).lines).map((l) => l.accountCode)).toEqual(['1301', '5201', '1401', '2101']);
  });

  it('POS cash sale: issue voucher then Dr cash 1100 / Cr AR 1100', async () => {
    const i = invoice({ status: InvoiceStatus.PAID, payments: [{ method: 'CASH', amount: 1100 }] as never });
    const { posting, dto } = harness([i]);
    await posting.handle(ev(InvoiceStatus.PAID));
    expect(dto(0).entryNumber).toBe('INV-inv-1-ISSUED');
    expect(shape(dto(0).lines)).toEqual(legacyShape(legacyDocumentLines(plain(i), { receivable: 110000n, vat: 10000n, net: 100000n, stock: -60000n }, LEGACY, false)));
    expect(shape(dto(1).lines)).toEqual(legacyShape(legacySettleLines(plain(i), 110000n, LEGACY)));
    expect(dto(1)).toMatchObject({ entryNumber: 'INV-inv-1-PAID', description: 'تسویه صورتحساب TI-1', date: '2026-01-02T00:00:00.000Z' });
  });

  it('POS card sale: Dr clearing 1015 1100 / Cr AR', async () => {
    const i = invoice({ status: InvoiceStatus.PAID, payments: [{ method: 'CARD', amount: 1100 }] as never });
    const { posting, dto } = harness([i]);
    await posting.handle(ev(InvoiceStatus.PAID));
    const old = legacySettleLines(plain(i), 110000n, LEGACY);
    expect(shape(dto(1).lines)).toEqual(legacyShape(old));
    expect(dto(1).lines[0]).toMatchObject({ accountCode: '1015', debit: '1100.00' });
  });

  it.each([
    ['card first', [{ method: 'CARD', amount: 400 }, { method: 'CASH', amount: 700 }]],
    ['cash first', [{ method: 'CASH', amount: 700 }, { method: 'CARD', amount: 400 }]],
  ])('mixed payment, %s: same lines in the same order', async (_name, payments) => {
    const i = invoice({ status: InvoiceStatus.PAID, payments: payments as never });
    const { posting, dto } = harness([i]);
    await posting.handle(ev(InvoiceStatus.PAID));
    expect(shape(dto(1).lines)).toEqual(legacyShape(legacySettleLines(plain(i), 110000n, LEGACY)));
  });

  it('purchase settlement: Dr AP / Cr cash', async () => {
    const i = invoice({ direction: InvoiceDirection.PURCHASE, status: InvoiceStatus.PAID });
    const { posting, dto } = harness([i]);
    await posting.handle(ev(InvoiceStatus.PAID));
    expect(shape(dto(1).lines)).toEqual(legacyShape(legacySettleLines(plain(i), 110000n, LEGACY)));
    expect(shape(dto(1).lines).map((l) => l.accountCode)).toEqual(['2101', '1010']);
  });

  it('sale return: the mirror of the sale, stock back at the sale cost (hand: AR -1100 / sales +1000 / VAT +100 / stock +600 / COGS -600)', async () => {
    const sale = invoice({ id: 'sale-1', postingMeta: { stockValue: 600, lines: [{ sku: 'SKU-3', quantity: 2, unitCost: 300, value: 600, moved: 'OUT', warehouseId: null }], posted: { receivable: '110000', vat: '10000', net: '100000', stock: '-60000' } } as never, journalEntryId: 1 });
    const ret = invoice({ id: 'inv-1', subject: InvoiceSubject.RETURN, relatedInvoiceId: 'sale-1', taxInvoiceNumber: 'TI-R' });
    const { posting, dto } = harness([sale, ret]);
    await posting.handle(ev(InvoiceStatus.ISSUED));
    const old = legacyDocumentLines(plain(ret), { receivable: -110000n, vat: -10000n, net: -100000n, stock: 60000n }, LEGACY, false);
    expect(shape(dto(0).lines)).toEqual(legacyShape(old));
    expect(shape(dto(0).lines).map((l) => l.accountCode)).toEqual(['4101', '2301', '1301', '1201', '5101']);
  });

  it('cancel of an issued sale is the exact mirror, posted although the issue voucher exists', async () => {
    const i = invoice();
    const { posting, dto, repo } = harness([i]);
    await posting.handle(ev(InvoiceStatus.ISSUED));
    await posting.handle(ev(InvoiceStatus.CANCELLED));
    const old = legacyDocumentLines(plain(i), { receivable: 110000n, vat: 10000n, net: 100000n, stock: -60000n }, LEGACY, true);
    expect(shape(dto(1).lines)).toEqual(legacyShape(old));
    expect(dto(1)).toMatchObject({ entryNumber: 'INV-inv-1-CANCEL', description: 'ابطال صورتحساب TI-1' });
    expect(repo.rows[0].reversalJournalEntryId).not.toBeNull();
  });

  it('cancel of a purchase', async () => {
    const i = invoice({ direction: InvoiceDirection.PURCHASE });
    const { posting, dto } = harness([i]);
    await posting.handle(ev(InvoiceStatus.ISSUED));
    await posting.handle(ev(InvoiceStatus.CANCELLED));
    const old = legacyDocumentLines(plain(i), { receivable: 110000n, vat: 10000n, net: 100000n, stock: 60000n }, LEGACY, true);
    expect(shape(dto(1).lines)).toEqual(legacyShape(old));
  });

  it('posting the same invoice again returns the first voucher instead of a second one', async () => {
    const { posting, journal, repo } = harness([invoice()]);
    await posting.handle(ev(InvoiceStatus.ISSUED));
    const first = repo.rows[0].journalEntryId;
    Object.assign(repo.rows[0], { journalEntryId: null, postingMeta: null });
    await posting.handle(ev(InvoiceStatus.ISSUED));
    expect(journal).toHaveBeenCalledTimes(1);
    expect(repo.rows[0].journalEntryId).toBe(first);
  });

  it('known differences: receivable/payable line texts lose the invoice number', async () => {
    const sale = harness([invoice()]);
    await sale.posting.handle(ev(InvoiceStatus.ISSUED));
    expect(sale.dto(0).lines[0].description).toBe('صدور صورتحساب');
    const purchase = harness([invoice({ direction: InvoiceDirection.PURCHASE })]);
    await purchase.posting.handle(ev(InvoiceStatus.ISSUED));
    expect(purchase.dto(0).lines.at(-1)?.description).toBe('بدهی بابت صورتحساب');
  });

  it('known differences: payments of one method merge into one line', async () => {
    const i = invoice({ status: InvoiceStatus.PAID, payments: [{ method: 'CASH', amount: 500 }, { method: 'CASH', amount: 600 }] as never });
    const { posting, dto } = harness([i]);
    await posting.handle(ev(InvoiceStatus.PAID));
    expect(legacySettleLines(plain(i), 110000n, LEGACY)).toHaveLength(3);
    expect(dto(1).lines).toHaveLength(2);
    expect(minorToDecimal(toMinor(dto(1).lines[0].debit ?? 0))).toBe('1100.00');
  });
});
