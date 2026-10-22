import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { FindManyOptions } from 'typeorm';
import { Currency } from '../currency/enums/currency.enum';
import { CurrencyService } from '../currency/services/currency.service';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoiceJurisdiction } from './enums/invoice-jurisdiction.enum';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicingService } from './services/invoicing.service';

/** نرخ تبدیل ساختگی: هر واحد ارز فاکتور = ۰٫۵ واحد ارز پایه (USD). */
const currencyService = {
  getRate: jest.fn(() => 0.5),
  round: jest.fn((value: number) => value),
} as unknown as CurrencyService;

class InMemoryInvoicingRepository {
  rows: InvoiceEntity[] = [];
  private sequence = 0;

  async create(
    tenantId: string,
    data: Partial<InvoiceEntity>,
  ): Promise<InvoiceEntity> {
    const entity = {
      ...data,
      id: `invoice-${++this.sequence}`,
      tenantId,
      createdAt: new Date(),
    } as InvoiceEntity;
    this.rows.push(entity);
    return entity;
  }

  async save(tenantId: string, entity: InvoiceEntity): Promise<InvoiceEntity> {
    const index = this.rows.findIndex(
      (row) => row.id === entity.id && row.tenantId === tenantId,
    );
    if (index === -1) return entity;
    this.rows[index] = { ...this.rows[index], ...entity, tenantId };
    return this.rows[index];
  }

  async findById(tenantId: string, id: string): Promise<InvoiceEntity | null> {
    return (
      this.rows.find((row) => row.id === id && row.tenantId === tenantId) ??
      null
    );
  }

  async findByTaxInvoiceNumber(
    tenantId: string,
    taxInvoiceNumber: string,
  ): Promise<InvoiceEntity | null> {
    return (
      this.rows.find(
        (row) =>
          row.taxInvoiceNumber === taxInvoiceNumber && row.tenantId === tenantId,
      ) ?? null
    );
  }

  async findAndCount(
    tenantId: string,
    _options: FindManyOptions<InvoiceEntity>,
  ): Promise<[InvoiceEntity[], number]> {
    const rows = this.rows.filter((row) => row.tenantId === tenantId);
    return [rows, rows.length];
  }

  async searchAndCount(
    tenantId: string,
    _options: {
      search: string;
      status?: InvoiceEntity['status'];
      currency?: InvoiceEntity['currency'];
      skip: number;
      take: number;
    },
  ): Promise<[InvoiceEntity[], number]> {
    const rows = this.rows.filter((row) => row.tenantId === tenantId);
    return [rows, rows.length];
  }
}

function buildDto(overrides: Partial<CreateInvoiceDto> = {}): CreateInvoiceDto {
  return {
    taxInvoiceNumber: 'TI-1',
    sellerInfo: { name: 'فروشنده' },
    buyerInfo: { name: 'خریدار' },
    items: [{ description: 'خدمت', quantity: 1, unitPrice: 1000 }],
    ...overrides,
  };
}

const buildService = () => {
  const repository = new InMemoryInvoicingRepository();
  const tenantsRepository = {
    findDefaultVatRate: jest.fn(async () => 0.1),
  } as unknown as TenantsRepository;

  const service = new InvoicingService(
    repository as unknown as InvoicingRepository,
    currencyService,
    undefined,
    undefined,
    tenantsRepository,
  );

  return { service, repository };
};

describe('InvoicingService — jurisdiction and foreign currency', () => {
  it('creates a EUR invoice in EUR with INTL jurisdiction and zero VAT by default', async () => {
    const { service } = buildService();
    const created = await service.create(
      'tenant-a',
      buildDto({
        currency: Currency.EUR,
        fxRate: 900_000,
        items: [{ description: 'Consulting', quantity: 2, unitPrice: 100 }],
      }),
    );

    expect(created.currency).toBe(Currency.EUR);
    expect(created.jurisdiction).toBe(InvoiceJurisdiction.INTL);
    expect(created.fxRate).toBe(900_000);
    expect(created.amountFx).toBe(200);
    expect(created.totalAmount).toBe(200);
    expect(created.totalTax).toBe(0);
    expect(created.finalPayable).toBe(200);
    // نرخ ۰٫۵ در سرویس ساختگی: معادل ارز پایه.
    expect(created.baseTotalAmount).toBe(100);
  });

  it('applies an explicit VAT rate to a foreign invoice in the invoice currency', async () => {
    const { service } = buildService();
    const created = await service.create(
      'tenant-a',
      buildDto({
        currency: Currency.USD,
        fxRate: 920_000,
        items: [
          { description: 'License', quantity: 1, unitPrice: 100, vatRate: 0.2 },
        ],
      }),
    );

    expect(created.jurisdiction).toBe(InvoiceJurisdiction.INTL);
    expect(created.totalTax).toBe(20);
    expect(created.finalPayable).toBe(120);
    expect(created.amountFx).toBe(120);
  });

  it('requires an fxRate for a non-rial/toman currency', async () => {
    const { service } = buildService();

    await expect(
      service.create('tenant-a', buildDto({ currency: Currency.EUR })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps an IRR invoice domestic with the 10% VAT default and fx_rate 1', async () => {
    const { service } = buildService();
    const created = await service.create(
      'tenant-a',
      buildDto({ currency: Currency.IRR }),
    );

    expect(created.jurisdiction).toBe(InvoiceJurisdiction.IR);
    expect(created.fxRate).toBe(1);
    expect(created.amountFx).toBe(1100);
    expect(created.totalTax).toBe(100);
    expect(created.finalPayable).toBe(1100);
  });

  it('treats IRT as a domestic currency with a 10 toman→rial factor', async () => {
    const { service } = buildService();
    const created = await service.create(
      'tenant-a',
      buildDto({ currency: Currency.IRT }),
    );

    expect(created.jurisdiction).toBe(InvoiceJurisdiction.IR);
    expect(created.fxRate).toBe(10);
    expect(created.totalTax).toBe(100);
    expect(created.finalPayable).toBe(1100);
  });

  it('honours an explicit jurisdiction over the currency-derived default', async () => {
    const { service } = buildService();
    const created = await service.create(
      'tenant-a',
      buildDto({
        currency: Currency.EUR,
        fxRate: 900_000,
        jurisdiction: InvoiceJurisdiction.IR,
      }),
    );

    expect(created.jurisdiction).toBe(InvoiceJurisdiction.IR);
    expect(created.totalTax).toBe(100);
    expect(created.finalPayable).toBe(1100);
  });

  it('switches to INTL and recalculates when the currency changes on update', async () => {
    const { service } = buildService();
    const created = await service.create('tenant-a', buildDto());

    const updated = await service.update('tenant-a', created.id, {
      currency: Currency.EUR,
      fxRate: 900_000,
    });

    expect(updated.currency).toBe(Currency.EUR);
    expect(updated.jurisdiction).toBe(InvoiceJurisdiction.INTL);
    expect(updated.fxRate).toBe(900_000);
    expect(updated.amountFx).toBe(updated.finalPayable);
  });
});
