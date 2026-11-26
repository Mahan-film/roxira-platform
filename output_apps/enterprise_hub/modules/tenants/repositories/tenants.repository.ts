import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { TenantEntity } from '../entities/tenant.entity';
import { TenantStatus } from '../enums/tenant-status.enum';

/**
 * لایه Repository ماژول Tenants — تنها نقطه دسترسی به جدول `tenants`.
 * Service و Controller هرگز مستقیماً به TypeORM دسترسی ندارند
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Injectable()
export class TenantsRepository {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly repository: Repository<TenantEntity>,
    @Optional() private readonly scope?: TenantScope,
  ) {}

  async create(data: Partial<TenantEntity>): Promise<TenantEntity> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async findById(id: string): Promise<TenantEntity | null> {
    if (this.scope) {
      return this.scope.run(id, (manager) =>
        manager.getRepository(TenantEntity).findOne({ where: { id } }),
      );
    }
    return this.repository.findOne({ where: { id } });
  }

  async findBySlug(slug: string): Promise<TenantEntity | null> {
    return this.repository.findOne({ where: { slug } });
  }

  async updateDefaultVatRate(
    id: string,
    defaultVatRate: number,
  ): Promise<TenantEntity | null> {
    await this.repository.update({ id }, { defaultVatRate });
    return this.findById(id);
  }

  async updateName(id: string, name: string): Promise<TenantEntity | null> {
    await this.repository.update({ id }, { name });
    return this.findById(id);
  }

  async updateSettings(
    id: string,
    fields: Partial<TenantEntity>,
  ): Promise<TenantEntity | null> {
    await this.repository.update({ id }, fields);
    return this.findById(id);
  }

  async updateRequire2fa(id: string, require2fa: boolean): Promise<void> {
    await this.repository.update({ id }, { require2fa });
  }

  async updateCancellation(
    id: string,
    status: TenantStatus,
    deleteAfter: Date | null,
    cancelledAt: Date | null,
    reason: string | null = null,
  ): Promise<TenantEntity | null> {
    await this.repository.update(
      { id },
      {
        status,
        deleteAfter,
        cancelledAt,
        cancellationReason: reason,
      },
    );
    return this.findById(id);
  }

  async findExpiredCancelledTenants(now = new Date()): Promise<TenantEntity[]> {
    return this.repository.find({
      where: {
        status: TenantStatus.CANCELLED_READONLY,
        deleteAfter: LessThanOrEqual(now),
      },
    });
  }

  async markPurged(id: string): Promise<void> {
    await this.repository.update(
      { id },
      {
        status: TenantStatus.PURGED,
        purgedAt: new Date(),
        isActive: false,
      },
    );
  }

  /** Platform-operator listing (entitlements screen only; never exposed to tenants). */
  listAll(): Promise<TenantEntity[]> {
    return this.repository.find({ order: { name: 'ASC' }, take: 500 });
  }
}
