import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { FindManyOptions } from 'typeorm';
import { CrmLeadEntity } from '../crm/entities/crm-lead.entity';
import { CrmRepository } from '../crm/repositories/crm.repository';
import { Currency } from '../currency/enums/currency.enum';
import { CurrencyService } from '../currency/services/currency.service';
import { StockItemEntity } from '../inventory/entities/stock-item.entity';
import { InventoryRepository } from '../inventory/repositories/inventory.repository';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicingService } from './services/invoicing.service';
import { fixtureVatRates } from './__fixtures__/vat-rate.fixture';

const currencyService = {
  getRate: jest.fn(() => 1),
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
    currency: Currency.IRR,
    items: [{ description: 'خدمت', quantity: 1, unitPrice: 1000, discount: 0 }],
    ...overrides,
  };
}

const buildService = (options?: {
  defaultVatRate?: number;
  leads?: CrmLeadEntity[];
  stockItems?: StockItemEntity[];
}) => {
  const repository = new InMemoryInvoicingRepository();
  const crmRepository = {
    findLeadById: jest.fn(
      async (tenantId: string, id: number) =>
        options?.leads?.find(
          (lead) => lead.id === id && lead.tenantId === tenantId,
        ) ?? null,
    ),
  } as unknown as CrmRepository;
  const inventoryRepository = {
    findStockItemById: jest.fn(
      async (tenantId: string, id: number) =>
        options?.stockItems?.find(
          (item) => item.id === id && item.tenantId === tenantId,
        ) ?? null,
    ),
    findStockItemBySku: jest.fn(
      async (tenantId: string, sku: string) =>
        options?.stockItems?.find(
          (item) => item.sku === sku && item.tenantId === tenantId,
        ) ?? null,
    ),
  } as unknown as InventoryRepository;
  const tenantsRepository = {} as unknown as TenantsRepository;

  const service = new InvoicingService(
    repository as unknown as InvoicingRepository,
    currencyService,
    crmRepository,
    inventoryRepository,
    tenantsRepository,
    undefined,
    undefined,
    fixtureVatRates(options?.defaultVatRate),
  );

  return { service, repository };
};

describe('InvoicingService — VAT per line', () => {
  it('applies the tenant default VAT rate (10%) and stores it on each line', async () => {
    const { service } = buildService({ defaultVatRate: 0.1 });
    const created = await service.create('tenant-a', buildDto());

    expect(created.items[0].vatRate).toBe(0.1);
    expect(created.items[0].tax).toBe(100);
    expect(created.totalTax).toBe(100);
    expect(created.finalPayable).toBe(1100);
  });

  it('uses a per-line rate and accepts percentage input (10 => 0.1)', async () => {
    const { service } = buildService({ defaultVatRate: 0.1 });
    const created = await service.create(
      'tenant-a',
      buildDto({
        items: [
          {
            description: 'خدمت الف',
            quantity: 1,
            unitPrice: 1000,
            discount: 0,
            vatRate: 0.05,
          },
          {
            description: 'خدمت ب',
            quantity: 1,
            unitPrice: 1000,
            discount: 0,
            vatRate: 10,
          },
        ],
      }),
    );

    expect(created.items[0].vatRate).toBe(0.05);
    expect(created.items[0].tax).toBe(50);
    expect(created.items[1].vatRate).toBe(0.1);
    expect(created.items[1].tax).toBe(100);
    expect(created.totalTax).toBe(150);
    expect(created.finalPayable).toBe(2150);
  });

  it('computes discount before VAT server-side', async () => {
    const { service } = buildService({ defaultVatRate: 0.1 });
    const created = await service.create(
      'tenant-a',
      buildDto({
        items: [
          {
            description: 'خدمت',
            quantity: 2,
            unitPrice: 1000,
            discount: 500,
          },
        ],
      }),
    );

    expect(created.totalAmount).toBe(2000);
    expect(created.totalDiscount).toBe(500);
    expect(created.totalTax).toBe(150);
    expect(created.finalPayable).toBe(1650);
  });
});

describe('InvoicingService — customer and inventory links', () => {
  const lead = {
    id: 7,
    tenantId: 'tenant-a',
    fullName: 'سارا محمدی',
    company: 'شرکت الف',
    email: 'sara@example.com',
    phone: '09120000000',
  } as CrmLeadEntity;

  it('fills buyer info from the tenant-scoped CRM lead', async () => {
    const { service } = buildService({ leads: [lead] });
    const created = await service.create(
      'tenant-a',
      buildDto({ customerId: 7, buyerInfo: undefined }),
    );

    expect(created.customerId).toBe(7);
    expect(created.buyerInfo.name).toBe('شرکت الف');
    expect(created.buyerInfo.email).toBe('sara@example.com');
  });

  it('rejects a customer from another tenant', async () => {
    const { service } = buildService({ leads: [lead] });

    await expect(
      service.create(
        'tenant-b',
        buildDto({ customerId: 7, buyerInfo: undefined }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('links a line to an inventory item and derives its description', async () => {
    const stockItem = {
      id: 3,
      tenantId: 'tenant-a',
      sku: 'SKU-3',
      name: 'روتر سازمانی',
    } as StockItemEntity;
    const { service } = buildService({ stockItems: [stockItem] });

    const created = await service.create(
      'tenant-a',
      buildDto({
        items: [{ itemId: 3, quantity: 1, unitPrice: 2000 }],
      }),
    );

    expect(created.items[0].itemId).toBe(3);
    expect(created.items[0].sku).toBe('SKU-3');
    expect(created.items[0].description).toBe('روتر سازمانی');
  });
});

describe('InvoicingService — status lifecycle', () => {
  it('marks an issued invoice paid and stamps issuedAt/paidAt', async () => {
    const { service } = buildService();
    const created = await service.create(
      'tenant-a',
      buildDto({ status: InvoiceStatus.ISSUED }),
    );
    expect(created.issuedAt).toBeTruthy();

    const paid = await service.pay('tenant-a', created.id);
    expect(paid.status).toBe(InvoiceStatus.PAID);
    expect(paid.paidAt).toBeTruthy();
  });

  it('does not pay a cancelled invoice', async () => {
    const { service } = buildService();
    const created = await service.create('tenant-a', buildDto());
    await service.cancel('tenant-a', created.id);

    await expect(service.pay('tenant-a', created.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('recalculates totals when items are updated', async () => {
    const { service } = buildService();
    const created = await service.create('tenant-a', buildDto());

    const updated = await service.update('tenant-a', created.id, {
      items: [{ description: 'خدمت جدید', quantity: 1, unitPrice: 2000, vatRate: 10 }],
    });

    expect(updated.totalAmount).toBe(2000);
    expect(updated.totalTax).toBe(200);
    expect(updated.finalPayable).toBe(2200);
    expect(updated.items[0].vatRate).toBe(0.1);
  });
});
