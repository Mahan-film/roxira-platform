import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, FindOptionsWhere, Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { DamageCalculationEntity } from '../entities/damage-calculation.entity';

/**
 * لایه Repository - تنها نقطه دسترسی به پایگاه‌داده برای این ماژول.
 * Controller/Service هرگز نباید مستقیماً به TypeORM Repository دسترسی داشته باشند
 * (Rule #3 - AGENTS.md: Repository Pattern).
 *
 * همه متدها `tenantId` را به‌عنوان پارامتر اول می‌گیرند و هر خواندن/نوشتن را به
 * همان مستأجر محدود می‌کنند تا هیچ داده‌ای از سازمان دیگر خوانده یا تغییر نکند
 * (Rule #4 - AGENTS.md: جداسازی مستأجر در لایه Repository).
 */
@Injectable()
export class DamagesRepository {
  constructor(
    @InjectRepository(DamageCalculationEntity)
    private readonly repository: Repository<DamageCalculationEntity>,
    @Optional()
    private readonly scope?: TenantScope,
  ) {}

  private get tenantScope(): TenantScope | undefined {
    if (this.scope) {
      return this.scope;
    }
    const ds = this.repository?.manager?.connection;
    if (typeof (ds as { transaction?: unknown } | undefined)?.transaction === 'function') {
      return new TenantScope(ds);
    }
    return undefined;
  }

  private withRepo<T>(
    tenantId: string,
    work: (repo: Repository<DamageCalculationEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.tenantScope;
    if (scope) {
      return scope.run(tenantId, (m) => work(m.getRepository(DamageCalculationEntity)));
    }
    return work(this.repository);
  }

  async create(
    tenantId: string,
    data: Partial<DamageCalculationEntity>,
  ): Promise<DamageCalculationEntity> {
    return this.withRepo(tenantId, (repo) => {
      const entity = repo.create({ ...data, tenantId });
      return repo.save(entity);
    });
  }

  async createMany(
    tenantId: string,
    data: Partial<DamageCalculationEntity>[],
  ): Promise<DamageCalculationEntity[]> {
    return this.withRepo(tenantId, (repo) => {
      const entities = repo.create(
        data.map((row) => ({ ...row, tenantId })),
      );
      return repo.save(entities);
    });
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<DamageCalculationEntity | null> {
    return this.withRepo(tenantId, (repo) => repo.findOne({ where: { id, tenantId } }));
  }

  async findAndCount(
    tenantId: string,
    options: FindManyOptions<DamageCalculationEntity>,
  ): Promise<[DamageCalculationEntity[], number]> {
    const where = (options.where ?? {}) as FindOptionsWhere<DamageCalculationEntity>;
    return this.withRepo(tenantId, (repo) =>
      repo.findAndCount({
        ...options,
        where: { ...where, tenantId },
      }),
    );
  }
}
