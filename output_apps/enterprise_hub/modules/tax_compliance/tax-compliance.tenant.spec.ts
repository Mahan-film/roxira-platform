import 'reflect-metadata';
import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FindManyOptions } from 'typeorm';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { InvoiceResponseDto } from '../invoicing/dto/invoice-response.dto';
import { InvoicingService } from '../invoicing/services/invoicing.service';
import { TenantRole } from '../tenants/enums/tenant-role.enum';
import { AddTaxComplianceTenantIsolation1789190000000 } from '../../migrations/1789190000000-AddTaxComplianceTenantIsolation';
import { TaxComplianceController } from './controllers/tax-compliance.controller';
import { QueryTaxSignatureDto } from './dto/query-tax-signature.dto';
import { TaxInvoiceSignatureEntity } from './entities/tax-invoice-signature.entity';
import { TaxSigningKeyEntity } from './entities/tax-signing-key.entity';
import { TaxSubmissionStatus } from './enums/tax-compliance.enum';
import { TaxComplianceRepository } from './repositories/tax-compliance.repository';
import { TaxComplianceService } from './services/tax-compliance.service';

const requestWith = (user: unknown): AuthenticatedRequest =>
  ({ user }) as unknown as AuthenticatedRequest;

/** سرویس صورتحساب ساختگی؛ فقط شناسه‌های مربوط به مستأجر A قابل مشاهده‌اند. */
const invoicingService = {
  findOne: jest.fn(async (tenantId: string, id: string) => {
    if (tenantId === 'tenant-a' && id === 'inv-a') {
      return { id, taxInvoiceNumber: 'TI-A' } as InvoiceResponseDto;
    }
    throw new NotFoundException('invoice not found');
  }),
} as unknown as InvoicingService;

/**
 * Repository درون‌حافظه‌ای که دقیقاً مثل نسخه واقعی هر خواندن/نوشتن را به
 * `tenantId` محدود می‌کند تا رفتار جداسازی مستأجر در سطح سرویس/کنترلر سنجیده شود.
 */
class InMemoryTaxComplianceRepository {
  private keys: TaxSigningKeyEntity[] = [];
  private signatures: TaxInvoiceSignatureEntity[] = [];
  private keySequence = 0;
  private signatureSequence = 0;

  async createKey(
    tenantId: string,
    data: Partial<TaxSigningKeyEntity>,
  ): Promise<TaxSigningKeyEntity> {
    const entity = {
      ...data,
      id: `key-${++this.keySequence}`,
      tenantId,
      createdAt: new Date(),
    } as TaxSigningKeyEntity;
    this.keys.push(entity);
    return entity;
  }

  async saveKey(
    tenantId: string,
    entity: TaxSigningKeyEntity,
  ): Promise<TaxSigningKeyEntity> {
    const index = this.keys.findIndex(
      (row) => row.id === entity.id && row.tenantId === tenantId,
    );
    if (index === -1) {
      return entity;
    }
    this.keys[index] = { ...this.keys[index], ...entity, tenantId };
    return this.keys[index];
  }

  async findActiveKey(tenantId: string): Promise<TaxSigningKeyEntity | null> {
    return (
      this.keys
        .filter((row) => row.tenantId === tenantId && row.isActive)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }

  async findActiveKeyWithPrivate(
    tenantId: string,
  ): Promise<TaxSigningKeyEntity | null> {
    return this.findActiveKey(tenantId);
  }

  async findKeyById(
    tenantId: string,
    keyId: string,
  ): Promise<TaxSigningKeyEntity | null> {
    return (
      this.keys.find(
        (row) => row.tenantId === tenantId && row.keyId === keyId,
      ) ?? null
    );
  }

  async deactivateAllKeys(tenantId: string): Promise<void> {
    this.keys = this.keys.map((row) =>
      row.tenantId === tenantId ? { ...row, isActive: false } : row,
    );
  }

  async createSignature(
    tenantId: string,
    data: Partial<TaxInvoiceSignatureEntity>,
  ): Promise<TaxInvoiceSignatureEntity> {
    const entity = {
      ...data,
      id: `sig-${++this.signatureSequence}`,
      tenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as TaxInvoiceSignatureEntity;
    this.signatures.push(entity);
    return entity;
  }

  async saveSignature(
    tenantId: string,
    entity: TaxInvoiceSignatureEntity,
  ): Promise<TaxInvoiceSignatureEntity> {
    const index = this.signatures.findIndex(
      (row) => row.id === entity.id && row.tenantId === tenantId,
    );
    if (index === -1) {
      return entity;
    }
    this.signatures[index] = { ...this.signatures[index], ...entity, tenantId };
    return this.signatures[index];
  }

  async findSignatureById(
    tenantId: string,
    id: string,
  ): Promise<TaxInvoiceSignatureEntity | null> {
    return (
      this.signatures.find(
        (row) => row.id === id && row.tenantId === tenantId,
      ) ?? null
    );
  }

  async findSignatureByInvoiceId(
    tenantId: string,
    invoiceId: string,
  ): Promise<TaxInvoiceSignatureEntity | null> {
    return (
      this.signatures.find(
        (row) => row.tenantId === tenantId && row.invoiceId === invoiceId,
      ) ?? null
    );
  }

  async findSignaturesAndCount(
    tenantId: string,
    _options: FindManyOptions<TaxInvoiceSignatureEntity>,
  ): Promise<[TaxInvoiceSignatureEntity[], number]> {
    const rows = this.signatures.filter((row) => row.tenantId === tenantId);
    return [rows, rows.length];
  }
}

const buildSignatureData = (
  tenantId: string,
): Partial<TaxInvoiceSignatureEntity> => ({
  invoiceId: `inv-${tenantId}`,
  taxInvoiceNumber: `TI-${tenantId}`,
  taxId: `00000000000000000000${tenantId === 'tenant-a' ? '01' : '02'}`,
  hashAlgorithm: 'sha256',
  dataHash: 'deadbeef',
  signatureAlgorithm: 'RS256',
  jwsSignature: 'header.payload.signature',
  keyId: `KID-${tenantId}`,
  keyFingerprint: 'fingerprint',
  status: TaxSubmissionStatus.SIGNED,
  referenceNumber: null,
  errorMessage: null,
  signedPacket: { verification: { qrCodePayload: `qr-${tenantId}` } },
});

const buildService = () => {
  const repository =
    new InMemoryTaxComplianceRepository() as unknown as TaxComplianceRepository;
  return {
    repository,
    service: new TaxComplianceService(repository, invoicingService),
  };
};

describe('TaxComplianceRepository — tenant scoping', () => {
  it('stamps tenantId on createKey', async () => {
    const signingKeyRepository = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => data),
    };
    const repository = new TaxComplianceRepository(
      signingKeyRepository as never,
      {} as never,
    );

    await repository.createKey('tenant-a', { keyId: 'KID-1' });

    expect(signingKeyRepository.create).toHaveBeenCalledWith({
      keyId: 'KID-1',
      tenantId: 'tenant-a',
    });
  });

  it('scopes findActiveKey by tenantId', async () => {
    const signingKeyRepository = { findOne: jest.fn(async () => null) };
    const repository = new TaxComplianceRepository(
      signingKeyRepository as never,
      {} as never,
    );

    await repository.findActiveKey('tenant-a');

    expect(signingKeyRepository.findOne).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', isActive: true },
      order: { createdAt: 'DESC' },
    });
  });

  it('scopes findActiveKeyWithPrivate query builder by tenantId', async () => {
    const queryBuilder = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => null),
    };
    const signingKeyRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    const repository = new TaxComplianceRepository(
      signingKeyRepository as never,
      {} as never,
    );

    await repository.findActiveKeyWithPrivate('tenant-a');

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'key.tenantId = :tenantId',
      { tenantId: 'tenant-a' },
    );
  });

  it('scopes deactivateAllKeys by tenantId', async () => {
    const signingKeyRepository = { update: jest.fn(async () => undefined) };
    const repository = new TaxComplianceRepository(
      signingKeyRepository as never,
      {} as never,
    );

    await repository.deactivateAllKeys('tenant-a');

    expect(signingKeyRepository.update).toHaveBeenCalledWith(
      { tenantId: 'tenant-a', isActive: true },
      { isActive: false },
    );
  });

  it('scopes findKeyById by tenantId', async () => {
    const signingKeyRepository = { findOne: jest.fn(async () => null) };
    const repository = new TaxComplianceRepository(
      signingKeyRepository as never,
      {} as never,
    );

    await repository.findKeyById('tenant-a', 'KID-1');

    expect(signingKeyRepository.findOne).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', keyId: 'KID-1' },
    });
  });

  it('updates a key by (id, tenantId) so a foreign id affects zero rows', async () => {
    const signingKeyRepository = { update: jest.fn(async () => undefined) };
    const repository = new TaxComplianceRepository(
      signingKeyRepository as never,
      {} as never,
    );

    await repository.saveKey('tenant-a', {
      id: 'key-1',
      tenantId: 'tenant-b',
    } as TaxSigningKeyEntity);

    expect(signingKeyRepository.update).toHaveBeenCalledWith(
      { id: 'key-1', tenantId: 'tenant-a' },
      expect.any(Object),
    );
  });

  it('stamps tenantId on createSignature', async () => {
    const signatureRepository = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => data),
    };
    const repository = new TaxComplianceRepository({} as never, signatureRepository as never);

    await repository.createSignature('tenant-a', { invoiceId: 'inv-a' });

    expect(signatureRepository.create).toHaveBeenCalledWith({
      invoiceId: 'inv-a',
      tenantId: 'tenant-a',
    });
  });

  it('scopes findSignatureById by tenantId', async () => {
    const signatureRepository = { findOne: jest.fn(async () => null) };
    const repository = new TaxComplianceRepository({} as never, signatureRepository as never);

    await repository.findSignatureById('tenant-a', 'sig-1');

    expect(signatureRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'sig-1', tenantId: 'tenant-a' },
    });
  });

  it('scopes findSignatureByInvoiceId by tenantId', async () => {
    const signatureRepository = { findOne: jest.fn(async () => null) };
    const repository = new TaxComplianceRepository({} as never, signatureRepository as never);

    await repository.findSignatureByInvoiceId('tenant-a', 'inv-a');

    expect(signatureRepository.findOne).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', invoiceId: 'inv-a' },
    });
  });

  it('injects tenantId into findSignaturesAndCount where', async () => {
    const signatureRepository = {
      findAndCount: jest.fn(async () => [[], 0]),
    };
    const repository = new TaxComplianceRepository({} as never, signatureRepository as never);

    await repository.findSignaturesAndCount('tenant-a', {
      where: { status: TaxSubmissionStatus.SIGNED },
    });

    expect(signatureRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: TaxSubmissionStatus.SIGNED, tenantId: 'tenant-a' },
      }),
    );
  });

  it('updates a signature by (id, tenantId) so a foreign id affects zero rows', async () => {
    const signatureRepository = { update: jest.fn(async () => undefined) };
    const repository = new TaxComplianceRepository({} as never, signatureRepository as never);

    await repository.saveSignature('tenant-a', {
      id: 'sig-1',
      tenantId: 'tenant-b',
    } as TaxInvoiceSignatureEntity);

    expect(signatureRepository.update).toHaveBeenCalledWith(
      { id: 'sig-1', tenantId: 'tenant-a' },
      expect.any(Object),
    );
  });
});

describe('TaxComplianceService — cross-tenant isolation', () => {
  it('does not read another tenant signature (404)', async () => {
    const { repository, service } = buildService();
    const created = await repository.createSignature(
      'tenant-a',
      buildSignatureData('tenant-a'),
    );

    await expect(service.findOne('tenant-b', created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not submit/update another tenant signature (404)', async () => {
    const { repository, service } = buildService();
    const created = await repository.createSignature(
      'tenant-a',
      buildSignatureData('tenant-a'),
    );

    await expect(
      service.submitSignature('tenant-b', created.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not expose another tenant signed packet (404)', async () => {
    const { repository, service } = buildService();
    const created = await repository.createSignature(
      'tenant-a',
      buildSignatureData('tenant-a'),
    );

    await expect(
      service.getSignedPacket('tenant-b', created.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not verify another tenant signature (404)', async () => {
    const { repository, service } = buildService();
    const created = await repository.createSignature(
      'tenant-a',
      buildSignatureData('tenant-a'),
    );

    await expect(
      service.verifySignature('tenant-b', created.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists only the current tenant signatures', async () => {
    const { repository, service } = buildService();
    await repository.createSignature('tenant-a', buildSignatureData('tenant-a'));
    await repository.createSignature('tenant-b', buildSignatureData('tenant-b'));

    const result = await service.findAll('tenant-a', {
      page: 1,
      limit: 20,
    } as QueryTaxSignatureDto);

    expect(result.total).toBe(1);
    expect(result.data[0].invoiceId).toBe('inv-tenant-a');
  });

  it('signInvoice with another tenant invoiceId -> 404 (invoice not visible)', async () => {
    const { service } = buildService();

    await expect(
      service.signInvoice('tenant-b', { invoiceId: 'inv-a' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TaxComplianceController — tenant access rules', () => {
  const setup = async () => {
    const { repository, service } = buildService();
    const controller = new TaxComplianceController(service);
    const created = await repository.createSignature(
      'tenant-a',
      buildSignatureData('tenant-a'),
    );
    return { controller, signatureId: created.id };
  };

  it('denies a user with a null tenant (403)', async () => {
    const { controller, signatureId } = await setup();

    await expect(
      controller.findOne(
        requestWith({ tenantId: null, role: UserRole.ADMIN }),
        signatureId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });


  it('allows the platform ADMIN of the owning tenant', async () => {
    const { controller, signatureId } = await setup();

    const result = await controller.findOne(
      requestWith({ tenantId: 'tenant-a', role: UserRole.ADMIN }),
      signatureId,
    );

    expect(result.id).toBe(signatureId);
  });

  it('allows the tenant OWNER', async () => {
    const { controller, signatureId } = await setup();

    const result = await controller.findOne(
      requestWith({
        tenantId: 'tenant-a',
        role: UserRole.USER,
        tenantRole: TenantRole.OWNER,
      }),
      signatureId,
    );

    expect(result.id).toBe(signatureId);
  });

  it('does not let the OWNER of another tenant read tenant A signature (404)', async () => {
    const { controller, signatureId } = await setup();

    await expect(
      controller.findOne(
        requestWith({
          tenantId: 'tenant-b',
          role: UserRole.USER,
          tenantRole: TenantRole.OWNER,
        }),
        signatureId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/** Runner ساختگی TypeORM که SQL اجراشده را ثبت می‌کند (بدون پایگاه‌داده). */
const createRunner = () => {
  const queries: string[] = [];
  const params: unknown[][] = [];
  const runner = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      queries.push(sql);
      params.push(values ?? []);
      return undefined;
    }),
  };
  return { runner, queries, params };
};

describe('AddTaxComplianceTenantIsolation migration', () => {
  it('exports a class exposing up() and down()', () => {
    const migration = new AddTaxComplianceTenantIsolation1789190000000();
    expect(migration.name).toBe('AddTaxComplianceTenantIsolation1789190000000');
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });

  it('adds tenant_id, backfills and enforces NOT NULL on both tables', async () => {
    const { runner, queries, params } = createRunner();
    await new AddTaxComplianceTenantIsolation1789190000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      '"tax_signing_keys" ADD COLUMN IF NOT EXISTS "tenant_id" uuid',
    );
    expect(sql).toContain(
      'UPDATE "tax_signing_keys" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL',
    );
    expect(sql).toContain(
      '"tax_signing_keys" ALTER COLUMN "tenant_id" SET NOT NULL',
    );
    expect(sql).toContain(
      '"tax_invoice_signatures" ADD COLUMN IF NOT EXISTS "tenant_id" uuid',
    );
    expect(sql).toContain(
      'UPDATE "tax_invoice_signatures" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL',
    );
    expect(sql).toContain(
      '"tax_invoice_signatures" ALTER COLUMN "tenant_id" SET NOT NULL',
    );
    expect(params.flat()).toContain('00000000-0000-0000-0000-000000000001');
  });

  it('converts the real global unique indexes into composite uniques', async () => {
    const { runner, queries } = createRunner();
    await new AddTaxComplianceTenantIsolation1789190000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_tax_signing_keys_key_id"');
    expect(sql).toContain('IDX_tax_signing_keys_tenant_key_id');
    expect(sql).toContain('("tenant_id", "key_id")');
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "IDX_tax_invoice_signatures_invoice_id"',
    );
    expect(sql).toContain('IDX_tax_invoice_signatures_tenant_invoice_id');
    expect(sql).toContain('("tenant_id", "invoice_id")');
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "IDX_tax_invoice_signatures_tax_id"',
    );
    expect(sql).toContain('IDX_tax_invoice_signatures_tenant_tax_id');
    expect(sql).toContain('("tenant_id", "tax_id")');
  });

  it('creates the partial unique (tenant_id) WHERE is_active index', async () => {
    const { runner, queries } = createRunner();
    await new AddTaxComplianceTenantIsolation1789190000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('IDX_tax_signing_keys_tenant_active');
    expect(sql).toContain('("tenant_id") WHERE "is_active"');
  });

  it('down() restores the global uniques and drops tenant artifacts', async () => {
    const { runner, queries } = createRunner();
    await new AddTaxComplianceTenantIsolation1789190000000().down(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tax_signing_keys_key_id"',
    );
    expect(sql).toContain('("key_id")');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tax_invoice_signatures_invoice_id"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tax_invoice_signatures_tax_id"',
    );
    expect(sql).toContain(
      'ALTER TABLE "tax_signing_keys" DROP COLUMN IF EXISTS "tenant_id"',
    );
    expect(sql).toContain(
      'ALTER TABLE "tax_invoice_signatures" DROP COLUMN IF EXISTS "tenant_id"',
    );
  });
});
