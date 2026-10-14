import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, FindOptionsWhere, Repository } from 'typeorm';
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
  ) {}

  async create(
    tenantId: string,
    data: Partial<DamageCalculationEntity>,
  ): Promise<DamageCalculationEntity> {
    const entity = this.repository.create({ ...data, tenantId });
    return this.repository.save(entity);
  }

  async createMany(
    tenantId: string,
    data: Partial<DamageCalculationEntity>[],
  ): Promise<DamageCalculationEntity[]> {
    const entities = this.repository.create(
      data.map((row) => ({ ...row, tenantId })),
    );
    return this.repository.save(entities);
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<DamageCalculationEntity | null> {
    return this.repository.findOne({ where: { id, tenantId } });
  }

  async findAndCount(
    tenantId: string,
    options: FindManyOptions<DamageCalculationEntity>,
  ): Promise<[DamageCalculationEntity[], number]> {
    const where = (options.where ?? {}) as FindOptionsWhere<DamageCalculationEntity>;
    return this.repository.findAndCount({
      ...options,
      where: { ...where, tenantId },
    });
  }
}
