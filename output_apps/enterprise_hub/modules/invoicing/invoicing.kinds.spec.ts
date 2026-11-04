import 'reflect-metadata';
import { fixtureVatRates } from './__fixtures__/vat-rate.fixture';
import { BadRequestException } from '@nestjs/common';
import { AccountResponseDto } from '../accounting/dto/account-response.dto';
import { AccountType } from '../accounting/enums/accounting.enum';
import { AccountingService } from '../accounting/services/accounting.service';
import { Currency } from '../currency/enums/currency.enum';
import { CurrencyService } from '../currency/services/currency.service';
import { InventoryRepository } from '../inventory/repositories/inventory.repository';
import { InventoryService } from '../inventory/services/inventory.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoiceDirection, InvoiceSubject } from './enums/invoice-kind.enum';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicePostingService } from './services/invoice-posting.service';
import { InvoicingService } from './services/invoicing.service';

const TENANT = 'tenant-a';

/** One in-memory repository shared by the invoicing service and the posting service. */
class Repo {
  rows: InvoiceEntity[] = [];
  private n = 0;
  async transaction<T>(work: (m: unknown) => Promise<T>) {
    return work({});
  }
  async create(tenantId: string, data: Partial<InvoiceEntity>) {
    const row = { ...data, id: `inv-${++this.n}`, tenantId, createdAt: new Date(2026, 0, 1, 0, 0, this.n) } as InvoiceEntity;
    row.journalEntryId = null;
    row.paidJournalEntryId = null;
    row.reversalJournalEntryId = null;
    row.postingMeta = null;
    this.rows.push(row);
    return row;
  }
  async save(tenantId: string, entity: InvoiceEntity) {
    const i = this.rows.findIndex((r) => r.id === entity.id && r.tenantId === tenantId);
    if (i >= 0) this.rows[i] = { ...this.rows[i], ...entity };
    return this.rows[i];
  }
  async findById(tenantId: string, id: string) {
    return this.rows.find((r) => r.id === id && r.tenantId === tenantId) ?? null;
  }
  findByIdForPosting = this.findById;
  async findByTaxInvoiceNumber(tenantId: string, n: string) {
    return this.rows.find((r) => r.taxInvoiceNumber === n && r.tenantId === tenantId) ?? null;
  }
  async findByRelated(tenantId: string, id: string) {
    return this.rows.filter((r) => r.tenantId === tenantId && r.relatedInvoiceId === id);
  }
  async findCorrectives(tenantId: string, id: string) {
    return (await this.findByRelated(tenantId, id)).filter((r) => r.subject === InvoiceSubject.CORRECTIVE);
  }
  async updatePosting(tenantId: string, id: string, data: Partial<InvoiceEntity>) {
    Object.assign(this.rows.find((r) => r.id === id && r.tenantId === tenantId)!, data);
  }
}

const account = (id: number, code: string, name: string, accountType: AccountType): AccountResponseDto => ({
  id,
  code,
  name,
  accountType,
  currency: Currency.IRR,
  balance: 0,
});

function setup() {
  const repo = new Repo();
  const accounts: AccountResponseDto[] = [];
  let seq = 0;
  const journals: Array<{ entryNumber: string; lines: Array<{ accountCode: string; debit?: string; credit?: string }> }> = [];
  const accounting = {
    listAccounts: jest.fn(async () => accounts),
    createAccount: jest.fn(async (_t: string, dto: { code: string; name: string; accountType: AccountType }) => {
      const created = account(++seq, dto.code, dto.name, dto.accountType);
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
  const stockItems = new Map([['SKU-1', { id: 1, sku: 'SKU-1', name: 'کالا' }]]);
  const inventoryRepo = {
    findStockItemBySku: jest.fn(async (_t: string, sku: string) => stockItems.get(sku) ?? null),
    findStockItemById: jest.fn(async () => stockItems.get('SKU-1')),
  };
  const queue = { add: jest.fn(async () => undefined) };
  const currency = { getRate: () => 1, round: (v: number) => v } as unknown as CurrencyService;
  const service = new InvoicingService(
    repo as unknown as InvoicingRepository,
    currency,
    undefined,
    inventoryRepo as unknown as InventoryRepository,
    undefined,
    queue as never,
    undefined,
    fixtureVatRates(),
  );
  const posting = new InvoicePostingService(
    repo as unknown as InvoicingRepository,
    inventory as unknown as InventoryService,
    accounting as unknown as AccountingService,
  );
  return { repo, service, posting, journals, inventory, queue };
}

const dto = (over: Partial<CreateInvoiceDto> = {}): CreateInvoiceDto => ({
  sellerInfo: { name: 'ما' },
  buyerInfo: { name: 'مشتری' },
  items: [{ sku: 'SKU-1', quantity: 2, unitPrice: 500, vatRate: 0.1 }],
  currency: Currency.IRR,
  status: InvoiceStatus.ISSUED,
  ...over,
});

const sum = (lines: Array<{ debit?: string; credit?: string }>) =>
  lines.reduce((a, l) => a + Number(l.debit ?? 0) - Number(l.credit ?? 0), 0);

const issue = (t: ReturnType<typeof setup>, id: string) =>
  t.posting.handle({ tenantId: TENANT, invoiceId: id, status: InvoiceStatus.ISSUED });

describe('invoice kinds', () => {
  it('creates a sale with a generated number and whole-rial figures', async () => {
    const t = setup();
    const created = await t.service.create(TENANT, dto({ items: [{ description: 'خدمت', quantity: 3, unitPrice: 333.33, vatRate: 0.1 }] }));
    expect(created.taxInvoiceNumber).toMatch(/^TI-\d{8}-\d{6}$/);
    expect(created.direction).toBe(InvoiceDirection.SALE);
    expect(created.items[0].unitPrice).toBe(333);
    expect(Number.isInteger(created.finalPayable)).toBe(true);
    expect(Number.isInteger(created.totalTax)).toBe(true);
  });

  it('keeps two decimals for foreign currencies', async () => {
    const t = setup();
    const created = await t.service.create(
      TENANT,
      dto({ currency: Currency.USD, fxRate: 900000, items: [{ description: 'x', quantity: 1, unitPrice: 10.555, vatRate: 0 }] }),
    );
    expect(created.items[0].unitPrice).toBe(10.56);
  });

  it('posts a purchase: stock layer at net cost, VAT credit, payable', async () => {
    const t = setup();
    const created = await t.service.create(
      TENANT,
      dto({ direction: InvoiceDirection.PURCHASE, sellerInfo: { name: 'تأمین‌کننده' }, buyerInfo: undefined, warehouseId: 4 }),
    );
    expect(created.buyerInfo.name).toBe('سازمان من');
    await issue(t, created.id);
    expect(t.inventory.receiveStock).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ sku: 'SKU-1', quantity: 2, unitPurchaseCost: 500, warehouseId: 4 }),
      expect.anything(),
    );
    const lines = t.journals[0].lines;
    expect(sum(lines)).toBe(0);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: '1301', debit: '1000.00' }),
        expect.objectContaining({ accountCode: '1401', debit: '100.00' }),
        expect.objectContaining({ accountCode: '2101', credit: '1100.00' }),
      ]),
    );
    expect(lines.some((l) => l.accountCode === '5201')).toBe(false);
  });

  it('a sale return takes the goods back at the sale cost and mirrors the amounts', async () => {
    const t = setup();
    const sale = await t.service.create(TENANT, dto());
    await issue(t, sale.id);
    const ret = await t.service.create(
      TENANT,
      dto({ subject: InvoiceSubject.RETURN, relatedInvoiceId: sale.id, items: [{ sku: 'SKU-1', quantity: 1, unitPrice: 500, vatRate: 0.1 }] }),
    );
    await issue(t, ret.id);
    expect(t.inventory.receiveStock).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ sku: 'SKU-1', quantity: 1, unitPurchaseCost: 300 }),
      expect.anything(),
    );
    const lines = t.journals[1].lines;
    expect(sum(lines)).toBe(0);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: '4101', debit: '500.00' }),
        expect.objectContaining({ accountCode: '1201', credit: '550.00' }),
        expect.objectContaining({ accountCode: '1301', debit: '300.00' }),
        expect.objectContaining({ accountCode: '5101', credit: '300.00' }),
      ]),
    );
  });

  it('refuses a return larger than what was sold, counting earlier returns', async () => {
    const t = setup();
    const sale = await t.service.create(TENANT, dto());
    await issue(t, sale.id);
    const first = await t.service.create(
      TENANT,
      dto({ subject: InvoiceSubject.RETURN, relatedInvoiceId: sale.id, items: [{ sku: 'SKU-1', quantity: 1.5, unitPrice: 500, vatRate: 0.1 }] }),
    );
    expect(first.subject).toBe(InvoiceSubject.RETURN);
    await expect(
      t.service.create(
        TENANT,
        dto({ subject: InvoiceSubject.RETURN, relatedInvoiceId: sale.id, items: [{ sku: 'SKU-1', quantity: 1, unitPrice: 500, vatRate: 0.1 }] }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a corrective posts only the difference to the original', async () => {
    const t = setup();
    const sale = await t.service.create(TENANT, dto());
    await issue(t, sale.id);
    const fix = await t.service.create(
      TENANT,
      dto({ subject: InvoiceSubject.CORRECTIVE, relatedInvoiceId: sale.id, items: [{ sku: 'SKU-1', quantity: 2, unitPrice: 450, vatRate: 0.1 }] }),
    );
    await issue(t, fix.id);
    expect(t.inventory.issueStock).toHaveBeenCalledTimes(1);
    const lines = t.journals[1].lines;
    expect(sum(lines)).toBe(0);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: '4101', debit: '100.00' }),
        expect.objectContaining({ accountCode: '2301', debit: '10.00' }),
        expect.objectContaining({ accountCode: '1201', credit: '110.00' }),
      ]),
    );
  });

  it('a cancel document cancels the related invoice and the cancellation mirrors the posting', async () => {
    const t = setup();
    const sale = await t.service.create(TENANT, dto());
    await issue(t, sale.id);
    const cancelDoc = await t.service.create(
      TENANT,
      dto({ subject: InvoiceSubject.CANCEL, relatedInvoiceId: sale.id, items: [{ description: 'ignored', quantity: 1, unitPrice: 1 }] }),
    );
    expect(cancelDoc.items[0].sku).toBe('SKU-1');
    expect(cancelDoc.finalPayable).toBe(1100);
    expect((await t.repo.findById(TENANT, sale.id))!.status).toBe(InvoiceStatus.CANCELLED);
    await t.posting.handle({ tenantId: TENANT, invoiceId: sale.id, status: InvoiceStatus.CANCELLED });
    expect(t.inventory.receiveStock).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ quantity: 2, unitPurchaseCost: 300 }),
      expect.anything(),
    );
    const [issued, reversed] = t.journals;
    expect(sum(reversed.lines)).toBe(0);
    expect(reversed.lines.map((l) => [l.accountCode, l.credit ?? l.debit])).toEqual(
      expect.arrayContaining(issued.lines.map((l) => [l.accountCode, l.credit ?? l.debit])),
    );
    // The cancel document itself books nothing.
    await issue(t, cancelDoc.id);
    expect(t.journals).toHaveLength(2);
  });

  it('rejects non-original subjects without a related invoice', async () => {
    const t = setup();
    await expect(t.service.create(TENANT, dto({ subject: InvoiceSubject.RETURN }))).rejects.toBeInstanceOf(BadRequestException);
  });
});
