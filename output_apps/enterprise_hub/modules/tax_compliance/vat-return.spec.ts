import 'reflect-metadata';
import { AccountResponseDto } from '../accounting/dto/account-response.dto';
import { AccountType } from '../accounting/enums/accounting.enum';
import { parseMinor } from '../accounting/money';
import { Currency } from '../currency/enums/currency.enum';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { InvoiceJurisdiction } from '../invoicing/enums/invoice-jurisdiction.enum';
import { EInvoiceType, InvoiceDirection, InvoiceSubject } from '../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../invoicing/enums/invoice-status.enum';
import { InvoicePostingService } from '../invoicing/services/invoice-posting.service';
import { buildVoucher } from '../invoice_capture/domain/voucher';
import { vatReturnTable } from './reports/vat-return-export';
import { SeasonalReportRepository } from './reports/seasonal-report.repository';
import { SeasonalReportService } from './reports/seasonal-report.service';
import { VatReturnRepository } from './reports/vat-return.repository';
import { pickVatAccount, VatReturnService } from './reports/vat-return.service';
import { VAT_ACCOUNT, VAT_RECEIVABLE_ACCOUNT } from '../invoicing/constants/suite-events.constants';

const TENANT = 'tenant-a';
const acct = (id: number, code: string, name: string, accountType: AccountType): AccountResponseDto =>
  ({ id, code, name, accountType, currency: Currency.IRR, balance: 0 }) as AccountResponseDto;

/** A minimal ledger: posts through the REAL InvoicePostingService and records every journal line. */
function ledger() {
  const accounts = [
    acct(1, '1010', 'موجودی نقد و بانک', AccountType.ASSET),
    acct(2, '1020', 'حساب‌های دریافتنی تجاری', AccountType.ASSET),
    acct(3, '2020', 'مالیات بر ارزش افزوده پرداختنی', AccountType.LIABILITY),
    acct(4, '4010', 'درآمد فروش خدمات', AccountType.REVENUE),
  ];
  const lines: Array<{ accountCode: string; debit?: string; credit?: string }> = [];
  let seq = 100;
  const accounting = {
    listAccounts: async () => accounts,
    createAccount: async (_t: string, dto: { code: string; name: string; accountType: AccountType }) => {
      const created = acct(++seq, dto.code, dto.name, dto.accountType);
      accounts.push(created);
      return created;
    },
    createJournalEntry: async (_t: string, dto: { lines: typeof lines }) => {
      lines.push(...dto.lines);
      return { id: ++seq };
    },
  };
  const rows: InvoiceEntity[] = [];
  const repo = {
    findById: async (_t: string, id: string) => rows.find((r) => r.id === id) ?? null,
    findByIdForPosting: async (_t: string, id: string) => rows.find((r) => r.id === id) ?? null,
    transaction: async <T>(work: (m: unknown) => Promise<T>) => work({}),
    updatePosting: async (_t: string, id: string, data: Partial<InvoiceEntity>) => {
      Object.assign(rows.find((r) => r.id === id) ?? {}, data);
    },
  };
  const posting = new InvoicePostingService(repo as never, {} as never, accounting as never);
  const post = async (invoice: InvoiceEntity) => {
    rows.push(invoice);
    await posting.handle({ tenantId: TENANT, invoiceId: invoice.id, status: InvoiceStatus.ISSUED });
  };
  const turnover = (code: string) => {
    let debit = 0n;
    let credit = 0n;
    for (const l of lines) {
      if (l.accountCode !== code) continue;
      debit += parseMinor(l.debit ?? '0');
      credit += parseMinor(l.credit ?? '0');
    }
    return { debitMinor: debit, creditMinor: credit };
  };
  return { accounts, lines, post, turnover };
}

const item = (quantity: number, unitPrice: number, vatRate: number, tax: number) => ({
  itemId: null,
  sku: null,
  description: 'x',
  quantity,
  unitPrice,
  discount: 0,
  vatRate,
  tax,
  total: quantity * unitPrice + tax,
});

const invoice = (over: Partial<InvoiceEntity>): InvoiceEntity =>
  ({
    id: 'i',
    tenantId: TENANT,
    taxInvoiceNumber: 'N',
    direction: InvoiceDirection.SALE,
    einvoiceType: EInvoiceType.WITH_BUYER,
    subject: InvoiceSubject.ORIGINAL,
    relatedInvoiceId: null,
    warehouseId: null,
    postingMeta: null,
    payments: null,
    jurisdiction: InvoiceJurisdiction.IR,
    customerId: null,
    sellerInfo: { name: 'S' },
    buyerInfo: { name: 'B' },
    currency: Currency.IRR,
    exchangeRate: 1,
    fxRate: 1,
    amountFx: null,
    totalDiscount: 0,
    status: InvoiceStatus.ISSUED,
    issuedAt: new Date('2026-05-01T08:00:00Z'),
    paidAt: null,
    journalEntryId: null,
    paidJournalEntryId: null,
    reversalJournalEntryId: null,
    postingError: null,
    createdAt: new Date('2026-05-01T08:00:00Z'),
    ...over,
  }) as unknown as InvoiceEntity;

const sale1 = invoice({
  id: 's1',
  items: [item(2, 500, 0.1, 100)],
  totalAmount: 1000,
  totalTax: 100,
  finalPayable: 1100,
});
// Foreign currency, several lines: per-line conversions do not add up to the invoice total.
const sale2 = invoice({
  id: 's2',
  currency: Currency.USD,
  fxRate: 0.333333,
  items: [item(1, 100.01, 0.1, 10), item(1, 100.02, 0.1, 10), item(1, 50.03, 0, 0)],
  totalAmount: 250.06,
  totalTax: 20,
  finalPayable: 270.06,
});
const purchase1 = invoice({
  id: 'p1',
  taxInvoiceNumber: 'P-1',
  direction: InvoiceDirection.PURCHASE,
  items: [item(1, 4000, 0.1, 400)],
  totalAmount: 4000,
  totalTax: 400,
  finalPayable: 4400,
});
// A sale return books the exact opposite of its own amounts (documented in the posting service).
const saleReturn = invoice({
  id: 'r1',
  taxInvoiceNumber: 'R-1',
  subject: InvoiceSubject.RETURN,
  items: [item(1, 500, 0.1, 50)],
  totalAmount: 500,
  totalTax: 50,
  finalPayable: 550,
});
const captureDraft = {
  kind: 'purchase' as const,
  sellerName: 'Cap Seller',
  sellerTaxId: '111',
  buyerName: 'Own',
  buyerTaxId: '',
  invoiceNumber: 'K-1',
  date: '2026-05-12',
  currency: 'IRR',
  fxRate: null,
  items: [{ description: 'y', quantity: '1', unitPrice: '700.00', total: '700.00', accountCode: null }],
  subtotal: '700.00',
  tax: '70.00',
  total: '770.00',
  paid: false,
  notes: '',
};

async function build(opts: { manualVatVoucher?: boolean; withReturn?: boolean } = {}) {
  const l = ledger();
  // Posting links the entity to its journal entry, so every build works on fresh copies.
  const [s1, s2, p1] = [sale1, sale2, purchase1].map((i) => ({ ...i }) as InvoiceEntity);
  await l.post(s1);
  await l.post(s2);
  await l.post(p1);
  const returns = opts.withReturn ? [{ ...saleReturn } as InvoiceEntity] : [];
  for (const r of returns) await l.post(r);
  // The posted capture voucher books its input VAT on 2020, exactly as `buildVoucher` does.
  l.lines.push(...buildVoucher(captureDraft, '5030').lines);
  if (opts.manualVatVoucher) l.lines.push({ accountCode: '2020', credit: '5.00' });

  const seasonalRepo = {
    findIssuedBetween: async () => [s1, s2],
    findAdjustmentsBetween: async () => returns,
    findPurchaseInvoicesBetween: async () => [p1],
    findPostedCapturePurchasesBetween: async () => [
      { id: 'c1', status: 'posted', extracted: { draft: captureDraft }, edited: null },
    ],
  } as unknown as SeasonalReportRepository;
  const ledgerRepo = {
    chartAccounts: async () => l.accounts.map((a) => ({ code: a.code, name: a.name, accountType: a.accountType })),
    turnover: async (_t: string, code: string) => l.turnover(code),
  } as unknown as VatReturnRepository;
  return new VatReturnService(new SeasonalReportService(seasonalRepo), ledgerRepo);
}

describe('VAT return draft (RET-01)', () => {
  it('reconciles exactly to the ledger VAT accounts posted by the real posting service and capture voucher', async () => {
    const report = await (await build()).vatReturn(TENANT, 1405, 1);
    expect(report.status).toBe('draft');
    // Output: 100 + (FX 20 x 0.333333 rounded once = 6.67), input: 400 + 70.
    expect(report.output.vat).toBe(106.67);
    expect(report.input.vat).toBe(470);
    expect(report.netVat).toBe(106.67 - 470);
    expect(report.ledger).toMatchObject({ outputAccount: '2020', inputAccount: '1401', difference: 0, reconciled: true });
    expect(report.payable).toBe(0);
    expect(report.creditCarriedForward).toBe(470 - 106.67);
  });

  it('nets a sale return so the return still reconciles exactly (ledger books the opposite amounts)', async () => {
    const report = await (await build({ withReturn: true })).vatReturn(TENANT, 1405, 1);
    expect(report.adjustments).toEqual({ returnCount: 1, correctiveCount: 0 });
    expect(report.output.vat).toBe(56.67);
    expect(report.ledger).toMatchObject({ difference: 0, reconciled: true });
  });

  it('shows a non-zero difference when a manual voucher touches the VAT account', async () => {
    const report = await (await build({ manualVatVoucher: true })).vatReturn(TENANT, 1405, 1);
    expect(report.ledger.reconciled).toBe(false);
    expect(report.ledger.difference).toBe(-5);
  });

  it('carries credit from earlier seasons inside the year', async () => {
    const report = await (await build()).vatReturn(TENANT, 1405, 2);
    // The stub returns the same documents for every season: season 2 starts with season 1's credit.
    expect(report.carriedCreditIn).toBe(470 - 106.67);
    expect(report.levies.status).toBe('unclear');
  });

  it('export table carries the exact minor units and the unclear markers', async () => {
    const report = await (await build()).vatReturn(TENANT, 1405, 1);
    const table = vatReturnTable(report);
    expect(table.rows[0].cells[2]).toBe(10_667n);
    expect(table.rows[1].cells[2]).toBe(47_000n);
    expect(table.rows.some((r) => String(r.cells[0]).includes('unclear'))).toBe(true);
  });

  it('picks VAT accounts like the posting does: by type and name, else by default code', () => {
    const accounts = [
      { code: '2999', name: 'مالیات حقوق', accountType: AccountType.EXPENSE },
      { code: '2020', name: 'مالیات بر ارزش افزوده پرداختنی', accountType: AccountType.LIABILITY },
    ];
    expect(pickVatAccount(accounts, VAT_ACCOUNT)).toBe('2020');
    expect(pickVatAccount([], VAT_RECEIVABLE_ACCOUNT)).toBeNull();
    expect(pickVatAccount([{ code: '1401', name: 'x', accountType: AccountType.ASSET }], VAT_RECEIVABLE_ACCOUNT)).toBe('1401');
  });
});
