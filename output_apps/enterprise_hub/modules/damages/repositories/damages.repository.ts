import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { DamageCalculationEntity } from '../entities/damage-calculation.entity';

/**
 * لایه Repository - تنها نقطه دسترسی به پایگاه‌داده برای این ماژول.
 * Controller/Service هرگز نباید مستقیماً به TypeORM Repository دسترسی داشته باشند
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Injectable()
export class DamagesRepository {
  constructor(
    @InjectRepository(DamageCalculationEntity)
    private readonly repository: Repository<DamageCalculationEntity>,
  ) {}

  async create(
    data: Partial<DamageCalculationEntity>,
  ): Promise<DamageCalculationEntity> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async createMany(
    data: Partial<DamageCalculationEntity>[],
  ): Promise<DamageCalculationEntity[]> {
    const entities = this.repository.create(data);
    return this.repository.save(entities);
  }

  async findById(id: string): Promise<DamageCalculationEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findAndCount(
    options: FindManyOptions<DamageCalculationEntity>,
  ): Promise<[DamageCalculationEntity[], number]> {
    return this.repository.findAndCount(options);
  }
}
