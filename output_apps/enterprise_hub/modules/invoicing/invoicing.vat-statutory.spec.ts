import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Currency } from '../currency/enums/currency.enum';
import { CurrencyService } from '../currency/services/currency.service';
import { seededRows } from '../hr/statutory/__fixtures__/seeded-rates';
import { StatutoryParameterEntity, StatutorySourceKind } from '../hr/statutory/statutory-parameter.entity';
import { StatutoryRepository } from '../hr/statutory/statutory.repository';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoiceJurisdiction } from './enums/invoice-jurisdiction.enum';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicingService } from './services/invoicing.service';
import { VatRateResolver } from './services/vat-rate.resolver';

/*
 * VAT-01: the general VAT rate comes from the statutory store by invoice date. The rates below
 * ('0.05', '0.08', '0.03') are made-up test values chosen to differ from each other; they are not
 * legal figures. The one test on the real seed asserts whatever the seed holds.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

let nextId = 1;
const param = (over: Partial<StatutoryParameterEntity>): StatutoryParameterEntity => ({
  id: String(nextId++),
  tenantId: null,
  country: 'IR',
  fiscalYear: 1405,
  paramKey: 'vat_general_rate',
  effectiveFrom: '2026-03-21',
  version: 1,
  value: '0.05',
  source: 'test',
  sourceKind: StatutorySourceKind.REPORT,
  verified: false,
  createdBy: 'test',
  createdAt: new Date(0),
  ...over,
});

/** Same filter as StatutoryRepository.findForYear: platform rows and this tenant's own. */
const statutoryStore = (rows: StatutoryParameterEntity[]) => {
  const findForYear = jest.fn(async (tenantId: string, country: string, year: number) =>
    rows.filter(
      (r) =>
        (r.tenantId === null || r.tenantId === tenantId) &&
        r.country === country &&
        r.fiscalYear === year,
    ),
  );
  return { findForYear } as unknown as StatutoryRepository & { findForYear: jest.Mock };
};

const currencyService = {
  getRate: jest.fn(() => 1),
  round: jest.fn((value: number) => value),
} as unknown as CurrencyService;

class InMemoryInvoices {
  rows: InvoiceEntity[] = [];
  async create(tenantId: string, data: Partial<InvoiceEntity>): Promise<InvoiceEntity> {
    const entity = { ...data, id: `inv-${this.rows.length + 1}`, tenantId, createdAt: new Date() } as InvoiceEntity;
    this.rows.push(entity);
    return entity;
  }
  async save(_tenantId: string, entity: InvoiceEntity): Promise<InvoiceEntity> {
    return entity;
  }
  async findById(tenantId: string, id: string): Promise<InvoiceEntity | null> {
    return this.rows.find((r) => r.id === id && r.tenantId === tenantId) ?? null;
  }
  async findByTaxInvoiceNumber(tenantId: string, n: string): Promise<InvoiceEntity | null> {
    return this.rows.find((r) => r.taxInvoiceNumber === n && r.tenantId === tenantId) ?? null;
  }
}

const build = (rows: StatutoryParameterEntity[]) => {
  const store = statutoryStore(rows);
  // Like the real tenants row: `default_vat_rate` is NOT NULL with default 0.1. It must never be
  // used as the VAT rate (#126).
  const tenants = {
    findById: jest.fn(async (id: string) => ({ id, countryCode: 'IR', defaultVatRate: 0.1 })),
  } as unknown as TenantsRepository;
  const repository = new InMemoryInvoices();
  const service = new InvoicingService(
    repository as unknown as InvoicingRepository,
    currencyService,
    undefined,
    undefined,
    tenants,
    undefined,
    undefined,
    new VatRateResolver(store),
  );
  return { service, store, repository };
};

let seq = 0;
const dto = (over: Partial<CreateInvoiceDto> = {}): CreateInvoiceDto => ({
  taxInvoiceNumber: `TI-${++seq}`,
  sellerInfo: { name: 'فروشنده' },
  buyerInfo: { name: 'خریدار' },
  currency: Currency.IRR,
  items: [{ description: 'خدمت', quantity: 1, unitPrice: 1000, discount: 0 }],
  ...over,
});

const at = (iso: string) => jest.setSystemTime(new Date(iso));

describe('VAT-01 — general VAT rate from the statutory store by invoice date', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });
  afterEach(() => jest.useRealTimers());

  // Two platform versions inside 1405: one from the year start, one from 1405-07-01.
  const twoRates = () => [
    param({ effectiveFrom: '2026-03-21', value: '0.05' }),
    param({ effectiveFrom: '2026-09-23', value: '0.08' }),
  ];

  it('invoices posted on dates with different rates use the rate in force on each date', async () => {
    const { service, store } = build(twoRates());

    at('2026-05-01T08:00:00Z');
    const before = await service.create(TENANT, dto({ status: InvoiceStatus.ISSUED }));
    at('2026-10-01T08:00:00Z');
    const after = await service.create(TENANT, dto({ status: InvoiceStatus.ISSUED }));

    expect(before.items[0].vatRate).toBe(0.05);
    expect(before.totalTax).toBe(50);
    expect(before.finalPayable).toBe(1050);
    expect(after.items[0].vatRate).toBe(0.08);
    expect(after.totalTax).toBe(80);
    expect(after.finalPayable).toBe(1080);
    // Both dates are in Jalali 1405.
    expect(store.findForYear).toHaveBeenCalledWith(TENANT, 'IR', 1405);
  });

  it('the new rate starts exactly on its effective date', async () => {
    const { service } = build(twoRates());
    at('2026-09-22T12:00:00Z');
    expect((await service.create(TENANT, dto())).items[0].vatRate).toBe(0.05);
    at('2026-09-23T12:00:00Z');
    expect((await service.create(TENANT, dto())).items[0].vatRate).toBe(0.08);
  });

  // #125: the effective date is the Iran calendar day (Asia/Tehran, UTC+03:30), not the UTC day.
  it('an invoice at 00:30 Tehran on the effective day takes the new rate (UTC is still the day before)', async () => {
    const { service } = build(twoRates());
    at('2026-09-22T21:00:00Z'); // 2026-09-23 00:30 Tehran = Jalali 1405/07/01
    const created = await service.create(TENANT, dto({ status: InvoiceStatus.ISSUED }));
    expect(created.items[0].vatRate).toBe(0.08);
    expect(created.totalTax).toBe(80);
  });

  it('an invoice at 23:30 Tehran the day before the effective day keeps the old rate', async () => {
    const { service } = build(twoRates());
    at('2026-09-22T20:00:00Z'); // 2026-09-22 23:30 Tehran
    expect((await service.create(TENANT, dto())).items[0].vatRate).toBe(0.05);
  });

  it('POS quotes at 00:30 Tehran on the effective day take the new rate', async () => {
    const { service } = build(twoRates());
    at('2026-09-22T21:00:00Z');
    const quoted = await service.quote(TENANT, {
      items: [{ description: 'کالا', quantity: 1, unitPrice: 1000, discount: 0 }],
      currency: Currency.IRR,
    });
    expect(quoted.items[0].vatRate).toBe(0.08);
  });

  it('editing an invoice issued at 00:30 Tehran on the effective day keeps the new rate', async () => {
    const { service } = build(twoRates());
    at('2026-09-22T21:00:00Z');
    const issued = await service.create(TENANT, dto({ status: InvoiceStatus.ISSUED }));
    at('2026-10-01T08:00:00Z');
    const updated = await service.update(TENANT, issued.id, {
      items: [{ description: 'خدمت', quantity: 2, unitPrice: 1000, discount: 0 }],
    });
    expect(updated.items[0].vatRate).toBe(0.08);
  });

  it('just after Nowruz midnight Tehran the lookup uses the new Jalali year', async () => {
    const { service, store } = build([
      param({ fiscalYear: 1405, effectiveFrom: '2026-03-21', value: '0.05' }),
      param({ fiscalYear: 1404, effectiveFrom: '2025-03-21', value: '0.08' }),
    ]);
    at('2026-03-20T21:00:00Z'); // 2026-03-21 00:30 Tehran = Jalali 1405/01/01
    const created = await service.create(TENANT, dto());
    expect(store.findForYear).toHaveBeenCalledWith(TENANT, 'IR', 1405);
    expect(created.items[0].vatRate).toBe(0.05);
  });

  it("an organisation's own row in the store beats the platform default, for that tenant only", async () => {
    const rows = [
      ...twoRates(),
      param({ tenantId: TENANT, effectiveFrom: '2026-09-23', value: '0.03', sourceKind: StatutorySourceKind.TENANT }),
    ];
    const { service } = build(rows);
    at('2026-10-01T08:00:00Z');
    expect((await service.create(TENANT, dto())).items[0].vatRate).toBe(0.03);
    expect((await service.create(OTHER, dto())).items[0].vatRate).toBe(0.08);
    // Before the tenant's row takes effect, the platform value applies.
    at('2026-05-01T08:00:00Z');
    expect((await service.create(TENANT, dto())).items[0].vatRate).toBe(0.05);
  });

  // #126: no silent fallback to tenants.default_vat_rate (always 0.1 in the real table).
  it('refuses an invoice dated in a year the store has no rate for (store seeded only for 1405)', async () => {
    const { service, store, repository } = build(seededRows(1405));
    at('2027-04-01T08:00:00Z'); // Jalali 1406
    const attempt = service.create(TENANT, dto());
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(/مالیات بر ارزش افزوده.*1406/);
    expect(store.findForYear).toHaveBeenCalledWith(TENANT, 'IR', 1406);
    expect(repository.rows).toHaveLength(0);
  });

  it('refuses a date before the first row of its year instead of using another value', async () => {
    const { service } = build([param({ effectiveFrom: '2026-09-23', value: '0.08' })]);
    at('2026-05-01T08:00:00Z'); // 1405, but no row in force yet
    await expect(service.create(TENANT, dto())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a POS quote when no rate covers the sale date', async () => {
    const { service } = build([]);
    at('2026-05-01T08:00:00Z');
    await expect(
      service.quote(TENANT, {
        items: [{ description: 'کالا', quantity: 1, unitPrice: 1000, discount: 0 }],
        currency: Currency.IRR,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an explicit line rate still works on a date with no store rate', async () => {
    const { service } = build([]);
    at('2027-04-01T08:00:00Z');
    const created = await service.create(
      TENANT,
      dto({ items: [{ description: 'x', quantity: 1, unitPrice: 1000, discount: 0, vatRate: 0.09 }] }),
    );
    expect(created.items[0].vatRate).toBe(0.09);
  });

  it('keeps the six decimals the store accepts for a rate', async () => {
    const { service } = build([param({ value: '0.123456' })]);
    at('2026-05-01T08:00:00Z');
    const created = await service.create(TENANT, dto({ items: [{ description: 'x', quantity: 1, unitPrice: 1_000_000, discount: 0 }] }));
    expect(created.items[0].vatRate).toBe(0.123456);
    expect(created.totalTax).toBe(123_456);
  });

  it('refuses a malformed rate in the store instead of guessing', async () => {
    const { service } = build([param({ value: 0.05 })]);
    at('2026-05-01T08:00:00Z');
    await expect(service.create(TENANT, dto())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps an explicit per-line rate', async () => {
    const { service } = build(twoRates());
    at('2026-10-01T08:00:00Z');
    const created = await service.create(
      TENANT,
      dto({ items: [{ description: 'x', quantity: 1, unitPrice: 1000, discount: 0, vatRate: 0.05 }] }),
    );
    expect(created.items[0].vatRate).toBe(0.05);
  });

  it('INTL invoices stay at zero and do not read the store', async () => {
    const { service, store } = build(twoRates());
    at('2026-10-01T08:00:00Z');
    const created = await service.create(
      TENANT,
      dto({ currency: Currency.USD, fxRate: 1_000_000, jurisdiction: InvoiceJurisdiction.INTL }),
    );
    expect(created.items[0].vatRate).toBe(0);
    expect(store.findForYear).not.toHaveBeenCalled();
  });

  it('editing the lines of an issued invoice uses the rate of its issue date', async () => {
    const { service } = build(twoRates());
    at('2026-05-01T08:00:00Z');
    const issued = await service.create(TENANT, dto({ status: InvoiceStatus.ISSUED }));
    at('2026-10-01T08:00:00Z');
    const updated = await service.update(TENANT, issued.id, {
      items: [{ description: 'خدمت', quantity: 2, unitPrice: 1000, discount: 0 }],
    });
    expect(updated.items[0].vatRate).toBe(0.05);
    expect(updated.totalTax).toBe(100);
  });

  it('POS quotes (PosSaleService.createSale) use the rate on the sale date', async () => {
    const { service } = build(twoRates());
    const lines = [{ description: 'کالا', quantity: 1, unitPrice: 1000, discount: 0 }];
    at('2026-05-01T08:00:00Z');
    const early = await service.quote(TENANT, { items: lines, currency: Currency.IRR });
    at('2026-10-01T08:00:00Z');
    const late = await service.quote(TENANT, { items: lines, currency: Currency.IRR });
    expect(early.items[0].vatRate).toBe(0.05);
    expect(early.totals.finalPayable).toBe(1050);
    expect(late.items[0].vatRate).toBe(0.08);
    expect(late.totals.finalPayable).toBe(1080);
  });

  it('with the real 1405 seed, a 1405 invoice uses exactly the value the seed holds', async () => {
    const seeded = seededRows(1405).find((r) => r.paramKey === 'vat_general_rate');
    expect(seeded).toBeDefined();
    const { service } = build(seededRows(1405));
    at('2026-06-01T08:00:00Z');
    const created = await service.create(TENANT, dto());
    expect(created.items[0].vatRate).toBe(Number(seeded!.value));
  });
});
