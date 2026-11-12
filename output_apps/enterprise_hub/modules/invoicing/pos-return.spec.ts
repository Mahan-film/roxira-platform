import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { fixtureVatRates } from './__fixtures__/vat-rate.fixture';
import { fakePostingRules } from './__fixtures__/fake-posting-rules';
import { AccountResponseDto } from '../accounting/dto/account-response.dto';
import { AccountType } from '../accounting/enums/accounting.enum';
import { AccountingService } from '../accounting/services/accounting.service';
import { CustomerIdentityService } from '../crm/services/customer-identity.service';
import { Currency } from '../currency/enums/currency.enum';
import { CurrencyService } from '../currency/services/currency.service';
import { InventoryRepository } from '../inventory/repositories/inventory.repository';
import { InventoryService } from '../inventory/services/inventory.service';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { CreatePosSaleDto } from './dto/pos-sale.dto';
import { InvoiceEntity, InvoiceItem } from './entities/invoice.entity';
import { InvoiceSubject } from './enums/invoice-kind.enum';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicePostingService } from './services/invoice-posting.service';
import { InvoicingService } from './services/invoicing.service';
import { PosSaleService } from './services/pos-sale.service';
import { planReturnLines, splitRefund } from './services/pos-return.plan';

const TENANT = 'tenant-a';
const OTHER = 'tenant-b';
const WALK_IN_ID = 1;
const KNOWN_ID = 7;

/** In-memory invoice repository shared by invoicing, posting and the POS service. */
class Repo {
  rows: InvoiceEntity[] = [];
  private n = 0;
  async lockForReturn() {
    return null;
  }

  async transaction<T>(work: (m: unknown) => Promise<T>) {
    return work({});
  }
  async create(tenantId: string, data: Partial<InvoiceEntity>) {
    const row = { ...data, id: `00000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`, tenantId, createdAt: new Date(2026, 0, 1, 0, 0, this.n) } as InvoiceEntity;
    Object.assign(row, { journalEntryId: null, paidJournalEntryId: null, reversalJournalEntryId: null, postingMeta: null });
    this.rows.push(row);
    return row;
  }
  async findById(tenantId: string, id: string) {
    return this.rows.find((r) => r.id === id && r.tenantId === tenantId) ?? null;
  }
  findByIdForPosting = this.findById;
  async findByTaxInvoiceNumber() {
    return null;
  }
  async findByIdempotencyKey(tenantId: string, key: string) {
    return this.rows.find((r) => r.idempotencyKey === key && r.tenantId === tenantId) ?? null;
  }
  async findByRelated(tenantId: string, id: string) {
    return this.rows.filter((r) => r.tenantId === tenantId && r.relatedInvoiceId === id);
  }
  async updatePosting(tenantId: string, id: string, data: Partial<InvoiceEntity>) {
    Object.assign(this.rows.find((r) => r.id === id && r.tenantId === tenantId)!, data);
  }
  async findMoadianSubmissionsForInvoices() {
    return new Map();
  }
}

type Line = { accountCode: string; debit?: string; credit?: string };

function setup() {
  const repo = new Repo();
  const accounts: AccountResponseDto[] = [];
  const journals: Array<{ entryNumber: string; lines: Line[] }> = [];
  const accounting = {
    listAccounts: jest.fn(async () => accounts),
    createAccount: jest.fn(async (_t: string, dto: { code: string; name: string; accountType: AccountType }) => {
      const created = { id: accounts.length + 1, ...dto, currency: Currency.IRR, balance: 0 } as AccountResponseDto;
      accounts.push(created);
      return created;
    }),
    createJournalEntry: jest.fn(async (_t: string, dto: never) => {
      journals.push(dto);
      return { id: 500 + journals.length };
    }),
  };
  const inventory = {
    issueStock: jest.fn(async (_t: string, dto: { quantity: number }) => ({ totalCost: dto.quantity * 300 })),
    receiveStock: jest.fn(async (_t: string, dto: { quantity: number; unitPurchaseCost: number }) => ({
      totalCost: dto.quantity * dto.unitPurchaseCost,
    })),
  };
  const item = { id: 1, sku: 'SKU-1', name: 'کالا' };
  const inventoryRepo = {
    findStockItemByCode: jest.fn(async () => item),
    findStockItemBySku: jest.fn(async () => item),
    findStockItemById: jest.fn(async () => item),
    availableQuantity: jest.fn(async () => 100),
  };
  const identity = {
    walkIn: jest.fn(async () => ({ id: WALK_IN_ID, fullName: 'مشتری گذری' })),
    resolve: jest.fn(async (_t: string, customer?: { phone?: string }) =>
      customer?.phone
        ? { lead: { id: KNOWN_ID }, level: 'phone', created: false }
        : { lead: { id: WALK_IN_ID }, level: 'anonymous', created: false },
    ),
  };
  const posting = new InvoicePostingService(
    repo as unknown as InvoicingRepository,
    inventory as unknown as InventoryService,
    accounting as unknown as AccountingService,
    fakePostingRules(accounting as unknown as AccountingService),
  );
  const queue = { add: jest.fn(async (_job: string, event: never) => posting.handle(event)) };
  const invoicing = new InvoicingService(
    repo as unknown as InvoicingRepository,
    { getRate: () => 1, round: (v: number) => v } as unknown as CurrencyService,
    undefined,
    inventoryRepo as unknown as InventoryRepository,
    undefined,
    queue as never,
    identity as unknown as CustomerIdentityService,
    fixtureVatRates(),
  );
  const pos = new PosSaleService(
    invoicing,
    repo as unknown as InvoicingRepository,
    inventoryRepo as unknown as InventoryRepository,
    identity as unknown as CustomerIdentityService,
    { findById: async () => ({ name: 'فروشگاه', countryCode: 'IR' }) } as unknown as TenantsRepository,
  );
  return { repo, pos, journals, inventory };
}

let key = 0;
const nextKey = () => `pos-ret-${++key}-abcdef`;

/** 3 x 1000 with a 300 discount and 10% VAT: 2700 net, 270 VAT, 2970 paid (1970 cash, 1000 card). */
const saleDto = (over: Partial<CreatePosSaleDto> = {}): CreatePosSaleDto => ({
  idempotencyKey: nextKey(),
  lines: [
    { code: 'SKU-1', quantity: 3, unitPrice: 1000, discount: 300, vatRate: 10 },
    { description: 'بسته‌بندی', quantity: 1, unitPrice: 30, vatRate: 0 },
  ],
  payments: [
    { method: 'CASH', amount: 2000 },
    { method: 'CARD', amount: 1000 },
  ],
  ...over,
});

const returnDto = (invoiceId: string, lines: Array<[number, number]>, refund: 'ORIGINAL' | 'CREDIT' = 'ORIGINAL'): CreatePosSaleDto => ({
  idempotencyKey: nextKey(),
  returnOf: { invoiceId, refund },
  lines: lines.map(([originalLine, quantity]) => ({ originalLine, quantity })),
});

const net = (lines: Line[], code: string) =>
  lines.filter((l) => l.accountCode === code).reduce((a, l) => a + Number(l.debit ?? 0) - Number(l.credit ?? 0), 0);
const balanced = (lines: Line[]) => Math.abs(lines.reduce((a, l) => a + Number(l.debit ?? 0) - Number(l.credit ?? 0), 0)) < 1e-9;

describe('POS returns', () => {
  it('a partial return mirrors revenue and VAT pro rata, restocks at the sale cost and refunds by the sale methods', async () => {
    const t = setup();
    const sale = (await t.pos.createSale(TENANT, saleDto())).invoice;
    expect(sale.finalPayable).toBe(3000);

    const result = await t.pos.createSale(TENANT, returnDto(sale.id, [[0, 1]]));
    const ret = result.invoice;
    expect(ret).toMatchObject({ subject: InvoiceSubject.RETURN, relatedInvoiceId: sale.id, status: InvoiceStatus.PAID });
    expect(ret.items[0]).toMatchObject({ sku: 'SKU-1', quantity: 1, unitPrice: 1000, discount: 100, vatRate: 0.1, tax: 90, total: 990, originalLine: 0 });
    // 990 refunded as 2000:1000 of the sale's payments.
    expect(t.repo.rows.find((r) => r.id === ret.id)!.payments).toEqual([
      { method: 'CASH', amount: 660 },
      { method: 'CARD', amount: 330 },
    ]);
    expect(t.inventory.receiveStock).toHaveBeenCalledWith(TENANT, expect.objectContaining({ sku: 'SKU-1', quantity: 1, unitPurchaseCost: 300 }), expect.anything());

    const issued = t.journals.find((j) => j.entryNumber === `INV-${ret.id}-ISSUED`)!;
    const paid = t.journals.find((j) => j.entryNumber === `INV-${ret.id}-PAID`)!;
    expect(balanced(issued.lines) && balanced(paid.lines)).toBe(true);
    expect(net(issued.lines, '4101')).toBe(900); // revenue reversed
    expect(net(issued.lines, '2301')).toBe(90); // VAT reversed
    expect(net(issued.lines, '1201')).toBe(-990);
    expect(net([...issued.lines, ...paid.lines], '1201')).toBe(0);
    const credits = paid.lines.filter((l) => Number(l.credit) > 0).map((l) => Number(l.credit)).sort((a, b) => a - b);
    expect(credits).toEqual([330, 660]);
  });

  it('several returns never exceed what was sold, and the last one takes the rest of the discount', async () => {
    const t = setup();
    const sale = (await t.pos.createSale(TENANT, saleDto())).invoice;
    await t.pos.createSale(TENANT, returnDto(sale.id, [[0, 1]]));
    const second = await t.pos.createSale(TENANT, returnDto(sale.id, [[0, 2], [1, 1]]));
    expect(second.invoice.items.map((i) => i.discount)).toEqual([200, 0]);
    await expect(t.pos.createSale(TENANT, returnDto(sale.id, [[0, 1]]))).rejects.toThrow(/باقی‌ماندهٔ قابل برگشت/);
    await expect(t.pos.createSale(TENANT, returnDto(sale.id, [[1, 1]]))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a retry with the same key replays the return and posts nothing twice', async () => {
    const t = setup();
    const sale = (await t.pos.createSale(TENANT, saleDto())).invoice;
    const dto = returnDto(sale.id, [[0, 1]]);
    const first = await t.pos.createSale(TENANT, dto);
    const retry = await t.pos.createSale(TENANT, dto);
    expect(retry).toMatchObject({ replayed: true });
    expect(retry.invoice.id).toBe(first.invoice.id);
    expect(t.repo.rows.filter((r) => r.subject === InvoiceSubject.RETURN)).toHaveLength(1);
    expect(t.inventory.receiveStock).toHaveBeenCalledTimes(1);
  });

  it('credit refund leaves the amount on a known customer, and is refused for the walk-in customer', async () => {
    const t = setup();
    const known = (await t.pos.createSale(TENANT, saleDto({ customer: { phone: '09120000000' } }))).invoice;
    const credit = await t.pos.createSale(TENANT, returnDto(known.id, [[0, 1]], 'CREDIT'));
    expect(credit.invoice).toMatchObject({ status: InvoiceStatus.ISSUED, customerId: KNOWN_ID });
    expect(t.repo.rows.find((r) => r.id === credit.invoice.id)!.payments).toBeNull();
    expect(t.journals.some((j) => j.entryNumber === `INV-${credit.invoice.id}-PAID`)).toBe(false);

    const walkIn = (await t.pos.createSale(TENANT, saleDto())).invoice;
    await expect(t.pos.createSale(TENANT, returnDto(walkIn.id, [[0, 1]], 'CREDIT'))).rejects.toThrow(/مشتری گذری/);
  });

  it('refuses a missing or foreign sale, a return of a return, bad lines and sent payments', async () => {
    const t = setup();
    const sale = (await t.pos.createSale(TENANT, saleDto())).invoice;
    await expect(t.pos.createSale(OTHER, returnDto(sale.id, [[0, 1]]))).rejects.toBeInstanceOf(NotFoundException);
    const ret = (await t.pos.createSale(TENANT, returnDto(sale.id, [[0, 1]]))).invoice;
    await expect(t.pos.createSale(TENANT, returnDto(ret.id, [[0, 1]]))).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.pos.createSale(TENANT, returnDto(sale.id, [[5, 1]]))).rejects.toThrow(/وجود ندارد/);
    await expect(t.pos.createSale(TENANT, returnDto(sale.id, [[0, 1], [0, 1]]))).rejects.toThrow(/تکراری/);
    await expect(
      t.pos.createSale(TENANT, { ...returnDto(sale.id, [[0, 1]]), payments: [{ method: 'CASH', amount: 990 }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.pos.createSale(TENANT, { ...returnDto(sale.id, []), lines: [{ code: 'SKU-1', quantity: 1, unitPrice: 1 }] }),
    ).rejects.toThrow(/originalLine/);
  });

  it('a sale still needs prices and payments', async () => {
    const t = setup();
    await expect(t.pos.createSale(TENANT, saleDto({ payments: [] }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.pos.createSale(TENANT, saleDto({ lines: [{ code: 'SKU-1', quantity: 1 }] }))).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('return planning', () => {
  const sold: InvoiceItem[] = [
    { itemId: 1, sku: 'A', description: 'a', quantity: 3, unitPrice: 1000, discount: 100, vatRate: 0.1, tax: 290, total: 3190 },
  ];

  it('counts an older return without a line number against the line with its SKU', () => {
    const earlier = [[{ ...sold[0], quantity: 2, discount: 67 }]];
    expect(() => planReturnLines(sold, earlier, [{ originalLine: 0, quantity: 2 }], Currency.IRR)).toThrow(BadRequestException);
    expect(planReturnLines(sold, earlier, [{ originalLine: 0, quantity: 1 }], Currency.IRR)[0].discount).toBe(33);
  });

  it('rounds a proportional discount to whole rials, or cents for other currencies', () => {
    expect(planReturnLines(sold, [], [{ originalLine: 0, quantity: 1 }], Currency.IRR)[0].discount).toBe(33);
    expect(planReturnLines(sold, [], [{ originalLine: 0, quantity: 1 }], Currency.USD)[0].discount).toBe(33.33);
  });

  it('splits a refund over the sale methods; no recorded payment means cash', () => {
    expect(splitRefund(100, null, Currency.IRR)).toEqual([{ method: 'CASH', amount: 100 }]);
    expect(splitRefund(100, [{ method: 'CARD', amount: 1 }, { method: 'CASH', amount: 2 }], Currency.IRR)).toEqual([
      { method: 'CARD', amount: 33 },
      { method: 'CASH', amount: 67 },
    ]);
    expect(splitRefund(10, [{ method: 'CASH', amount: 5 }, { method: 'CASH', amount: 5 }], Currency.IRR)).toEqual([{ method: 'CASH', amount: 10 }]);
  });
});
