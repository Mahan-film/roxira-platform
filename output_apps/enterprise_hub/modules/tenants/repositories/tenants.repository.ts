import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantEntity } from '../entities/tenant.entity';

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
  ) {}

  async create(data: Partial<TenantEntity>): Promise<TenantEntity> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async findById(id: string): Promise<TenantEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findBySlug(slug: string): Promise<TenantEntity | null> {
    return this.repository.findOne({ where: { slug } });
  }
}
