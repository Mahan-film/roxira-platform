import 'reflect-metadata';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FindManyOptions } from 'typeorm';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { Currency } from '../currency/enums/currency.enum';
import { CurrencyService } from '../currency/services/currency.service';
import { InvoicingController } from './controllers/invoicing.controller';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicingService } from './services/invoicing.service';
import { TenantRole } from '../tenants/enums/tenant-role.enum';

const requestWith = (user: unknown): AuthenticatedRequest =>
  ({ user }) as unknown as AuthenticatedRequest;

/** سرویس ارز ساختگی (بدون ConfigService) برای تست‌های واحد. */
const currencyService = {
  getRate: jest.fn(() => 1),
  round: jest.fn((value: number) => value),
} as unknown as CurrencyService;

/**
 * Repository درون‌حافظه‌ای که دقیقاً مثل نسخه واقعی هر خواندن/نوشتن را به
 * `tenantId` محدود می‌کند تا رفتار جداسازی مستأجر در سطح سرویس/کنترلر سنجیده شود.
 */
class InMemoryInvoicingRepository {
  private rows: InvoiceEntity[] = [];
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
    if (index === -1) {
      return entity;
    }
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
}

const buildDto = (taxInvoiceNumber: string): CreateInvoiceDto => ({
  taxInvoiceNumber,
  sellerInfo: { name: 'فروشنده' },
  buyerInfo: { name: 'خریدار' },
  currency: Currency.IRR,
  items: [{ description: 'خدمت', quantity: 1, unitPrice: 1000, discount: 0 }],
});

const buildService = () => {
  const repository =
    new InMemoryInvoicingRepository() as unknown as InvoicingRepository;
  return { repository, service: new InvoicingService(repository, currencyService) };
};

describe('InvoicingRepository — tenant scoping', () => {
  it('scopes findById by tenantId', async () => {
    const typeormRepository = { findOne: jest.fn(async () => null) };
    const repository = new InvoicingRepository(typeormRepository as never);

    await repository.findById('tenant-a', 'invoice-1');

    expect(typeormRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'invoice-1', tenantId: 'tenant-a' },
    });
  });

  it('scopes findByTaxInvoiceNumber by tenantId', async () => {
    const typeormRepository = { findOne: jest.fn(async () => null) };
    const repository = new InvoicingRepository(typeormRepository as never);

    await repository.findByTaxInvoiceNumber('tenant-a', 'TI-1');

    expect(typeormRepository.findOne).toHaveBeenCalledWith({
      where: { taxInvoiceNumber: 'TI-1', tenantId: 'tenant-a' },
    });
  });

  it('stamps tenantId on create', async () => {
    const typeormRepository = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => data),
    };
    const repository = new InvoicingRepository(typeormRepository as never);

    await repository.create('tenant-a', { taxInvoiceNumber: 'TI-1' });

    expect(typeormRepository.create).toHaveBeenCalledWith({
      taxInvoiceNumber: 'TI-1',
      tenantId: 'tenant-a',
    });
  });

  it('updates by (id, tenantId) so a foreign id affects zero rows', async () => {
    const typeormRepository = { update: jest.fn(async () => undefined) };
    const repository = new InvoicingRepository(typeormRepository as never);

    await repository.save('tenant-a', {
      id: 'invoice-1',
      tenantId: 'tenant-b',
    } as InvoiceEntity);

    expect(typeormRepository.update).toHaveBeenCalledWith(
      { id: 'invoice-1', tenantId: 'tenant-a' },
      expect.any(Object),
    );
  });

  it('injects tenantId into findAndCount where', async () => {
    const typeormRepository = {
      findAndCount: jest.fn(async () => [[], 0]),
    };
    const repository = new InvoicingRepository(typeormRepository as never);

    await repository.findAndCount('tenant-a', {
      where: { status: InvoiceStatus.DRAFT },
    });

    expect(typeormRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: InvoiceStatus.DRAFT, tenantId: 'tenant-a' },
      }),
    );
  });
});

describe('InvoicingService — cross-tenant isolation', () => {
  it('does not read another tenant invoice (404)', async () => {
    const { service } = buildService();
    const created = await service.create('tenant-a', buildDto('TI-A'));

    await expect(service.findOne('tenant-b', created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not cancel another tenant invoice (404) and leaves it unchanged', async () => {
    const { service } = buildService();
    const created = await service.create('tenant-a', buildDto('TI-A'));

    await expect(service.cancel('tenant-b', created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const stillDraft = await service.findOne('tenant-a', created.id);
    expect(stillDraft.status).toBe(InvoiceStatus.DRAFT);
  });

  it('lists only the current tenant rows', async () => {
    const { service } = buildService();
    await service.create('tenant-a', buildDto('TI-A'));
    await service.create('tenant-b', buildDto('TI-B'));

    const tenantAList = await service.findAll('tenant-a', { page: 1, limit: 20 });
    expect(tenantAList.total).toBe(1);
    expect(tenantAList.data[0].taxInvoiceNumber).toBe('TI-A');
  });

  it('allows the same taxInvoiceNumber in two tenants but not twice in one', async () => {
    const { service } = buildService();

    await expect(
      service.create('tenant-a', buildDto('TI-SHARED')),
    ).resolves.toBeDefined();
    await expect(
      service.create('tenant-b', buildDto('TI-SHARED')),
    ).resolves.toBeDefined();
    await expect(
      service.create('tenant-a', buildDto('TI-SHARED')),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('InvoicingController — tenant access rules', () => {
  const setup = async () => {
    const { service } = buildService();
    const controller = new InvoicingController(service);
    const created = await service.create('tenant-a', buildDto('TI-A'));
    return { controller, invoiceId: created.id };
  };

  it('denies a user with a null tenant (403)', async () => {
    const { controller, invoiceId } = await setup();

    await expect(
      controller.findOne(
        requestWith({ tenantId: null, role: UserRole.ADMIN }),
        invoiceId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a plain MEMBER (403)', async () => {
    const { controller, invoiceId } = await setup();

    await expect(
      controller.findOne(
        requestWith({
          tenantId: 'tenant-a',
          role: UserRole.USER,
          tenantRole: TenantRole.MEMBER,
        }),
        invoiceId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows the platform ADMIN of the owning tenant', async () => {
    const { controller, invoiceId } = await setup();

    const result = await controller.findOne(
      requestWith({ tenantId: 'tenant-a', role: UserRole.ADMIN }),
      invoiceId,
    );

    expect(result.id).toBe(invoiceId);
  });

  it('allows the tenant OWNER', async () => {
    const { controller, invoiceId } = await setup();

    const result = await controller.findOne(
      requestWith({
        tenantId: 'tenant-a',
        role: UserRole.USER,
        tenantRole: TenantRole.OWNER,
      }),
      invoiceId,
    );

    expect(result.id).toBe(invoiceId);
  });

  it('does not let the OWNER of another tenant read tenant A invoices (404)', async () => {
    const { controller, invoiceId } = await setup();

    await expect(
      controller.findOne(
        requestWith({
          tenantId: 'tenant-b',
          role: UserRole.USER,
          tenantRole: TenantRole.OWNER,
        }),
        invoiceId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
