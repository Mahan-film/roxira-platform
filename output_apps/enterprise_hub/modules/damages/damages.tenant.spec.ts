import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { FindManyOptions } from 'typeorm';
import { AddDamagesTenantIsolation1789180000000 } from '../../migrations/1789180000000-AddDamagesTenantIsolation';
import { UserRole } from '../auth/enums/user-role.enum';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { TenantRole } from '../tenants/enums/tenant-role.enum';
import { DAMAGES_BULK_JOB_NAME } from './constants/damages.constants';
import { DamagesController } from './controllers/damages.controller';
import { CreateDamageCalculationDto } from './dto/create-damage-calculation.dto';
import { DamageCalculationEntity } from './entities/damage-calculation.entity';
import { DamageCalculationMethod } from './enums/calculation-method.enum';
import { DamagesQueueProcessor } from './processors/damages-queue.processor';
import { DamagesRepository } from './repositories/damages.repository';
import { DamagesService } from './services/damages.service';

const requestWith = (user: unknown): AuthenticatedRequest =>
  ({ user }) as unknown as AuthenticatedRequest;

/**
 * Repository درون‌حافظه‌ای که دقیقاً مثل نسخه واقعی هر خواندن/نوشتن را به
 * `tenantId` محدود می‌کند تا رفتار جداسازی مستأجر در سطح سرویس/کنترلر سنجیده شود.
 */
class InMemoryDamagesRepository {
  public rows: DamageCalculationEntity[] = [];
  private sequence = 0;

  async create(
    tenantId: string,
    data: Partial<DamageCalculationEntity>,
  ): Promise<DamageCalculationEntity> {
    const entity = {
      ...data,
      id: `damage-${++this.sequence}`,
      tenantId,
      createdAt: new Date(),
    } as DamageCalculationEntity;
    this.rows.push(entity);
    return entity;
  }

  async createMany(
    tenantId: string,
    data: Partial<DamageCalculationEntity>[],
  ): Promise<DamageCalculationEntity[]> {
    const entities = data.map(
      (row) =>
        ({
          ...row,
          id: `damage-${++this.sequence}`,
          tenantId,
          createdAt: new Date(),
        }) as DamageCalculationEntity,
    );
    this.rows.push(...entities);
    return entities;
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<DamageCalculationEntity | null> {
    return (
      this.rows.find((row) => row.id === id && row.tenantId === tenantId) ?? null
    );
  }

  async findAndCount(
    tenantId: string,
    _options: FindManyOptions<DamageCalculationEntity>,
  ): Promise<[DamageCalculationEntity[], number]> {
    const rows = this.rows.filter((row) => row.tenantId === tenantId);
    return [rows, rows.length];
  }
}

const buildDto = (
  contractReferenceNumber: string,
): CreateDamageCalculationDto => ({
  principalAmount: 1_000_000,
  dueDate: '2024-01-01',
  paymentDate: '2024-06-01',
  calculationMethod: DamageCalculationMethod.ANNUAL_RATE,
  annualInterestRate: 18,
  contractReferenceNumber,
});

const buildService = () => {
  const repository = new InMemoryDamagesRepository();
  const queue = {
    add: jest.fn(async (_name: string, payload: unknown) => ({
      id: 'job-1',
      data: payload,
    })),
  } as unknown as Queue;
  const service = new DamagesService(
    repository as unknown as DamagesRepository,
    queue,
  );
  return { repository, queue, service };
};

describe('DamagesRepository — tenant scoping', () => {
  it('scopes findById by tenantId', async () => {
    const typeormRepository = { findOne: jest.fn(async () => null) };
    const repository = new DamagesRepository(typeormRepository as never);

    await repository.findById('tenant-a', 'damage-1');

    expect(typeormRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'damage-1', tenantId: 'tenant-a' },
    });
  });

  it('stamps tenantId on create', async () => {
    const typeormRepository = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => data),
    };
    const repository = new DamagesRepository(typeormRepository as never);

    await repository.create('tenant-a', { principalAmount: 1000 });

    expect(typeormRepository.create).toHaveBeenCalledWith({
      principalAmount: 1000,
      tenantId: 'tenant-a',
    });
  });

  it('stamps tenantId on every row of createMany', async () => {
    const typeormRepository = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => data),
    };
    const repository = new DamagesRepository(typeormRepository as never);

    await repository.createMany('tenant-a', [
      { principalAmount: 1000 },
      { principalAmount: 2000 },
    ]);

    expect(typeormRepository.create).toHaveBeenCalledWith([
      { principalAmount: 1000, tenantId: 'tenant-a' },
      { principalAmount: 2000, tenantId: 'tenant-a' },
    ]);
  });

  it('injects tenantId into findAndCount where', async () => {
    const typeormRepository = {
      findAndCount: jest.fn(async () => [[], 0]),
    };
    const repository = new DamagesRepository(typeormRepository as never);

    await repository.findAndCount('tenant-a', {
      where: { contractReferenceNumber: 'C-1' },
    });

    expect(typeormRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contractReferenceNumber: 'C-1', tenantId: 'tenant-a' },
      }),
    );
  });
});

describe('DamagesService — cross-tenant isolation', () => {
  it('does not read another tenant record (404)', async () => {
    const { service } = buildService();
    const created = await service.calculateAndPersist(
      'tenant-a',
      buildDto('C-A'),
    );

    await expect(service.findOne('tenant-b', created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists only the current tenant rows', async () => {
    const { service } = buildService();
    await service.calculateAndPersist('tenant-a', buildDto('C-A'));
    await service.calculateAndPersist('tenant-b', buildDto('C-B'));

    const tenantAList = await service.findAll('tenant-a', {
      page: 1,
      limit: 20,
    });
    expect(tenantAList.total).toBe(1);
    expect(tenantAList.data[0].contractReferenceNumber).toBe('C-A');
  });

  it('carries the trusted tenantId in the bulk job payload', async () => {
    const { service, queue } = buildService();

    await service.enqueueBulkCalculation('tenant-a', [buildDto('C-A')]);

    expect(queue.add).toHaveBeenCalledWith(
      DAMAGES_BULK_JOB_NAME,
      expect.objectContaining({
        tenantId: 'tenant-a',
        items: [expect.objectContaining({ contractReferenceNumber: 'C-A' })],
      }),
    );
  });
});

describe('DamagesQueueProcessor — fail-closed tenant handling', () => {
  const buildJob = (data: unknown): Job =>
    ({
      name: DAMAGES_BULK_JOB_NAME,
      data,
      updateProgress: jest.fn(),
    }) as unknown as Job;

  it('persists bulk rows stamped with the payload tenantId', async () => {
    const { service, repository } = buildService();
    const processor = new DamagesQueueProcessor(service);

    const result = await processor.process(
      buildJob({ tenantId: 'tenant-a', items: [buildDto('C-A')] }),
    );

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0].tenantId).toBe('tenant-a');
  });

  it('rejects a job without tenantId and persists nothing', async () => {
    const { service, repository } = buildService();
    const processor = new DamagesQueueProcessor(service);

    const result = await processor.process(
      buildJob({ items: [buildDto('C-A')] }),
    );

    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(repository.rows).toHaveLength(0);
  });

  it('rejects a job with a null tenantId and persists nothing', async () => {
    const { service, repository } = buildService();
    const processor = new DamagesQueueProcessor(service);

    const result = await processor.process(
      buildJob({ tenantId: null, items: [buildDto('C-A')] }),
    );

    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(repository.rows).toHaveLength(0);
  });
});

describe('DamagesController — tenant access rules', () => {
  const setup = async () => {
    const { service } = buildService();
    const controller = new DamagesController(service);
    const created = await service.calculateAndPersist(
      'tenant-a',
      buildDto('C-A'),
    );
    return { controller, damageId: created.id };
  };

  it('denies a user with a null tenant (403)', async () => {
    const { controller, damageId } = await setup();

    await expect(
      controller.findOne(
        requestWith({ tenantId: null, role: UserRole.ADMIN }),
        damageId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a plain MEMBER (403)', async () => {
    const { controller, damageId } = await setup();

    await expect(
      controller.findOne(
        requestWith({
          tenantId: 'tenant-a',
          role: UserRole.USER,
          tenantRole: TenantRole.MEMBER,
        }),
        damageId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows the platform ADMIN of the owning tenant', async () => {
    const { controller, damageId } = await setup();

    const result = await controller.findOne(
      requestWith({ tenantId: 'tenant-a', role: UserRole.ADMIN }),
      damageId,
    );

    expect(result.id).toBe(damageId);
  });

  it('allows the tenant OWNER', async () => {
    const { controller, damageId } = await setup();

    const result = await controller.findOne(
      requestWith({
        tenantId: 'tenant-a',
        role: UserRole.USER,
        tenantRole: TenantRole.OWNER,
      }),
      damageId,
    );

    expect(result.id).toBe(damageId);
  });

  it('does not let the OWNER of another tenant read tenant A records (404)', async () => {
    const { controller, damageId } = await setup();

    await expect(
      controller.findOne(
        requestWith({
          tenantId: 'tenant-b',
          role: UserRole.USER,
          tenantRole: TenantRole.OWNER,
        }),
        damageId,
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

describe('AddDamagesTenantIsolation migration', () => {
  it('exports a class exposing up() and down()', () => {
    const migration = new AddDamagesTenantIsolation1789180000000();
    expect(migration.name).toBe('AddDamagesTenantIsolation1789180000000');
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });

  it('adds tenant_id, backfills and enforces NOT NULL', async () => {
    const { runner, queries, params } = createRunner();
    await new AddDamagesTenantIsolation1789180000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      '"damage_calculations" ADD COLUMN IF NOT EXISTS "tenant_id" uuid',
    );
    expect(sql).toContain(
      'UPDATE "damage_calculations" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL',
    );
    expect(sql).toContain(
      '"damage_calculations" ALTER COLUMN "tenant_id" SET NOT NULL',
    );
    expect(params.flat()).toContain('00000000-0000-0000-0000-000000000001');
  });

  it('creates the tenant query indexes including (tenant_id, createdAt)', async () => {
    const { runner, queries } = createRunner();
    await new AddDamagesTenantIsolation1789180000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('IDX_damage_calculations_tenant_createdAt');
    expect(sql).toContain('("tenant_id", "createdAt")');
  });

  it('replaces the single-column contract index with the tenant composite', async () => {
    const { runner, queries } = createRunner();
    await new AddDamagesTenantIsolation1789180000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "IDX_damage_calculations_contractReferenceNumber"',
    );
    expect(sql).toContain(
      'IDX_damage_calculations_tenant_contractReferenceNumber',
    );
    expect(sql).toContain('("tenant_id", "contractReferenceNumber")');
  });

  it('down() restores the original index and drops tenant artifacts', async () => {
    const { runner, queries } = createRunner();
    await new AddDamagesTenantIsolation1789180000000().down(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "IDX_damage_calculations_tenant_contractReferenceNumber"',
    );
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS "IDX_damage_calculations_contractReferenceNumber"',
    );
    expect(sql).toContain(
      'ALTER TABLE "damage_calculations" DROP COLUMN IF EXISTS "tenant_id"',
    );
  });
});
