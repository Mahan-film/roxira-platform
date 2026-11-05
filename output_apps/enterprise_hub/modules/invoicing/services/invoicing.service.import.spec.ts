import 'reflect-metadata';
import { fixtureVatRates } from '../__fixtures__/vat-rate.fixture';
import { Currency } from '../../currency/enums/currency.enum';
import { CurrencyService } from '../../currency/services/currency.service';
import { InventoryRepository } from '../../inventory/repositories/inventory.repository';
import { PartiesService } from '../../parties/services/parties.service';
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';
import { InvoiceEntity } from '../entities/invoice.entity';
import { InvoiceDirection } from '../enums/invoice-kind.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';
import { InvoicingRepository } from '../repositories/invoicing.repository';
import { InvoicingImportInput, InvoicingService } from './invoicing.service';

const TENANT = 'tenant-a';

class Repo {
  rows: InvoiceEntity[] = [];
  private n = 0;
  async create(tenantId: string, data: Partial<InvoiceEntity>) {
    const row = { ...data, id: `inv-${++this.n}`, tenantId } as InvoiceEntity;
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
  async findByTaxInvoiceNumber(tenantId: string, n: string) {
    return this.rows.find((r) => r.taxInvoiceNumber === n && r.tenantId === tenantId) ?? null;
  }
  async findByRelated() {
    return [];
  }
  async findCorrectives() {
    return [];
  }
  async deleteByIds(tenantId: string, ids: string[]) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.tenantId !== tenantId || !ids.includes(r.id));
    return before - this.rows.length;
  }
}

function setup(options: { existingNumbers?: string[] } = {}) {
  const repo = new Repo();
  for (const number of options.existingNumbers ?? []) {
    repo.rows.push({
      id: `existing-${number}`,
      tenantId: TENANT,
      taxInvoiceNumber: number,
      status: InvoiceStatus.ISSUED,
    } as InvoiceEntity);
  }
  const stockItems = new Map([
    ['ITM-1', { id: 11, sku: 'ITM-1', name: 'کالای یک' }],
    ['ITM-2', { id: 12, sku: 'ITM-2', name: 'کالای دو' }],
  ]);
  const inventoryRepo = {
    findStockItemBySku: jest.fn(async (_t: string, sku: string) => stockItems.get(sku) ?? null),
    findStockItemSkus: jest.fn(async (_t: string, skus: string[]) => skus.filter((s) => stockItems.has(s))),
  };
  const parties = new Map([
    ['CUST-1', { id: 1, code: 'CUST-1', name: 'آرش آذرخش نمونه', nationalId: '1000000001', economicCode: '411000000001', role: 'customer', active: true }],
    ['SUPP-1', { id: 2, code: 'SUPP-1', name: 'شهاب خرمی آزمایشی', nationalId: null, economicCode: '411000000002', role: 'supplier', active: true }],
  ]);
  const partiesService = {
    findExistingCodes: jest.fn(async (_t: string, codes: string[]) => codes.filter((c) => parties.has(c))),
    getByCode: jest.fn(async (_t: string, code: string) => parties.get(code) ?? null),
  };
  const tenantsRepository = {
    findById: jest.fn(async () => ({ countryCode: 'IR', name: 'شرکت ما' })),
  };
  const customerIdentity = {
    walkIn: jest.fn(async () => ({ id: 7, fullName: 'مشتری گذری' })),
  };
  const queue = { add: jest.fn(async () => undefined) };
  const currency = { getRate: () => 1, round: (v: number) => v } as unknown as CurrencyService;
  const service = new InvoicingService(
    repo as unknown as InvoicingRepository,
    currency,
    undefined,
    inventoryRepo as unknown as InventoryRepository,
    tenantsRepository as unknown as TenantsRepository,
    queue as never,
    customerIdentity as never,
    fixtureVatRates(),
    partiesService as unknown as PartiesService,
  );
  return { repo, service, queue, inventoryRepo, partiesService };
}

const input = (over: Partial<InvoicingImportInput>): InvoicingImportInput => ({
  rowNumber: 2,
  number: 'INV-S-1403-0001',
  type: 'فروش',
  date: '2024-04-01',
  partyCode: 'CUST-1',
  itemCode: 'ITM-1',
  quantity: 2,
  unitPrice: 18625000,
  amount: 37250000,
  vat: 3725000,
  totalRial: 40975000,
  currency: 'IRR',
  fxRate: 1,
  ...over,
});

describe('InvoicingService.importInvoices', () => {
  it('creates one multi-line DRAFT invoice per number, without any posting event', async () => {
    const t = setup();
    const results = await t.service.importInvoices(TENANT, [
      input({ rowNumber: 2 }),
      input({ rowNumber: 3, itemCode: 'ITM-2', quantity: 1, unitPrice: 5000, amount: 5000, vat: 500, totalRial: 5500 }),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].invoiceId).toBe(results[1].invoiceId);
    expect(results[0].error).toBeNull();
    expect(results[0].duplicate).toBe(false);
    expect(results[0].existingDuplicate).toBe(false);
    expect(t.repo.rows).toHaveLength(1);

    const invoice = t.repo.rows[0];
    expect(invoice.status).toBe(InvoiceStatus.DRAFT);
    expect(invoice.direction).toBe(InvoiceDirection.SALE);
    expect(invoice.taxInvoiceNumber).toBe('INV-S-1403-0001');
    expect(invoice.items).toHaveLength(2);
    expect(invoice.items[0]).toMatchObject({
      itemId: 11,
      sku: 'ITM-1',
      quantity: 2,
      unitPrice: 18625000,
      vatRate: 0.1,
      tax: 3725000,
      total: 40975000,
    });
    expect(invoice.totalAmount).toBe(37250000 + 5000);
    expect(invoice.totalTax).toBe(3725000 + 500);
    expect(invoice.finalPayable).toBe(40975000 + 5500);
    expect(invoice.currency).toBe(Currency.IRR);
    expect(invoice.customerId).toBeNull();
    expect(invoice.buyerInfo).toMatchObject({ name: 'آرش آذرخش نمونه', nationalId: '1000000001' });
    expect(invoice.sellerInfo).toMatchObject({ name: 'شرکت ما' });
    expect(invoice.issuedAt).toEqual(new Date(Date.UTC(2024, 3, 1)));
    expect(t.queue.add).not.toHaveBeenCalled();
  });

  it('names a blank-party sale through the shared walk-in path', async () => {
    const t = setup();
    const results = await t.service.importInvoices(TENANT, [input({ partyCode: '' })]);

    expect(results[0].error).toBeNull();
    const invoice = t.repo.rows[0];
    expect(invoice.customerId).toBe(7);
    expect(invoice.buyerInfo).toMatchObject({ name: 'مشتری گذری' });
    expect(invoice.einvoiceType).toBe(2);
  });

  it('imports purchases as real PURCHASE invoices with the supplier as seller', async () => {
    const t = setup();
    const results = await t.service.importInvoices(TENANT, [
      input({ number: 'INV-P-1403-0001', type: 'خرید', partyCode: 'SUPP-1', itemCode: 'ITM-2', quantity: 2, unitPrice: 12100000, amount: 24200000, vat: 2420000, totalRial: 26620000 }),
    ]);

    expect(results[0].error).toBeNull();
    const invoice = t.repo.rows[0];
    expect(invoice.direction).toBe(InvoiceDirection.PURCHASE);
    expect(invoice.sellerInfo).toMatchObject({ name: 'شهاب خرمی آزمایشی', economicCode: '411000000002' });
    expect(invoice.buyerInfo).toMatchObject({ name: 'شرکت ما' });
    expect(invoice.customerId).toBeNull();
    expect(invoice.einvoiceType).toBe(2);
  });

  it('skips invoices whose number already exists for the tenant and reports them as existing duplicates', async () => {
    const t = setup({ existingNumbers: ['INV-S-1403-0001'] });
    const results = await t.service.importInvoices(TENANT, [
      input({ rowNumber: 2 }),
      input({ rowNumber: 3, itemCode: 'ITM-2', quantity: 1, unitPrice: 5000, amount: 5000, vat: 500, totalRial: 5500 }),
    ]);

    expect(results.every((result) => result.existingDuplicate)).toBe(true);
    expect(results.every((result) => result.invoiceId === null && result.error === null)).toBe(true);
    expect(t.repo.rows).toHaveLength(1);
    expect(t.repo.rows[0].id).toBe('existing-INV-S-1403-0001');
  });

  it('reports an exact repeat as a duplicate that adds no line', async () => {
    const t = setup();
    const results = await t.service.importInvoices(TENANT, [
      input({ rowNumber: 2 }),
      input({ rowNumber: 3, itemCode: 'ITM-2', quantity: 1, unitPrice: 5000, amount: 5000, vat: 500, totalRial: 5500 }),
      input({ rowNumber: 9 }),
    ]);

    expect(results[2].duplicate).toBe(true);
    expect(results[2].invoiceId).toBeNull();
    expect(results[2].error).toBeNull();
    const invoice = t.repo.rows[0];
    expect(invoice.items).toHaveLength(2);
    expect(results[0].invoiceId).toBe(results[1].invoiceId);
  });

  it('fails the whole invoice with every row and keeps other invoices importing', async () => {
    const t = setup();
    const results = await t.service.importInvoices(TENANT, [
      input({ rowNumber: 2 }),
      input({ rowNumber: 3, number: 'INV-S-1403-0002', itemCode: 'ITM-2', quantity: 1, unitPrice: 5000, amount: 5000, vat: 500, totalRial: 5600 }),
      input({ rowNumber: 4, number: 'INV-S-1403-0002' }),
    ]);

    expect(results[0].invoiceId).not.toBeNull();
    expect(results[1].error).toContain('5000 + 500 = 5500');
    expect(results[1].error).toContain('«5600»');
    expect(results[2].error).toContain('سطر 3');
    expect(t.repo.rows).toHaveLength(1);
    expect(t.repo.rows[0].taxInvoiceNumber).toBe('INV-S-1403-0001');
  });

  it('fails rows with unknown parties or items and never writes a placeholder name', async () => {
    const t = setup();
    const results = await t.service.importInvoices(TENANT, [
      input({ rowNumber: 2, partyCode: 'CUST-404' }),
      input({ rowNumber: 3, number: 'INV-S-1403-0002', itemCode: 'ITM-404' }),
    ]);

    expect(results[0].error).toContain('طرف حساب با کد «CUST-404»');
    expect(results[1].error).toContain('کالای انبار با کد «ITM-404»');
    expect(t.repo.rows).toHaveLength(0);
  });

  it('leaves issuedAt empty when the row carries no valid date', async () => {
    const t = setup();
    const results = await t.service.importInvoices(TENANT, [input({ date: '1403/01/01' })]);

    expect(results[0].error).toContain('تاریخ');
    expect(t.repo.rows).toHaveLength(0);
  });
});
