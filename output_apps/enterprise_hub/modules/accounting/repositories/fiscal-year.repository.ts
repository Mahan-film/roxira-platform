import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { FiscalYearEntity } from '../entities/fiscal-year.entity';

/**
 * Fiscal years. The table has tenant RLS, so every call sets `app.tenant_id` on its transaction
 * (or on the caller's), and filters by tenant as well.
 */
@Injectable()
export class FiscalYearRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private scoped<T>(
    tenantId: string,
    work: (manager: EntityManager) => Promise<T>,
    outer?: EntityManager,
  ): Promise<T> {
    const run = async (manager: EntityManager) => {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return work(manager);
    };
    return outer ? run(outer) : this.dataSource.transaction(run);
  }

  list(tenantId: string, manager?: EntityManager): Promise<FiscalYearEntity[]> {
    return this.scoped(
      tenantId,
      (m) => m.find(FiscalYearEntity, { where: { tenantId }, order: { startDate: 'ASC' } }),
      manager,
    );
  }

  find(tenantId: string, id: number, manager?: EntityManager): Promise<FiscalYearEntity | null> {
    return this.scoped(
      tenantId,
      (m) => m.findOne(FiscalYearEntity, { where: { tenantId, id } }),
      manager,
    );
  }

  /** The year containing `day`, or null. */
  findContaining(tenantId: string, day: string): Promise<FiscalYearEntity | null> {
    return this.scoped(tenantId, (m) =>
      m
        .createQueryBuilder(FiscalYearEntity, 'fy')
        .where('fy.tenantId = :tenantId', { tenantId })
        .andWhere('CAST(:day AS date) BETWEEN fy.startDate AND fy.endDate', { day })
        .getOne(),
    );
  }

  save(
    tenantId: string,
    entity: Partial<FiscalYearEntity>,
    manager: EntityManager,
  ): Promise<FiscalYearEntity> {
    return this.scoped(
      tenantId,
      (m) => m.save(m.create(FiscalYearEntity, { ...entity, tenantId })),
      manager,
    );
  }
}
