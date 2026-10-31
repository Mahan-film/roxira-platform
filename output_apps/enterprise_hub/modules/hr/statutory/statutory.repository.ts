import { Injectable } from '@nestjs/common';
import { TenantScope } from '../../access/services/tenant-scope';
import { StatutoryParameterEntity } from './statutory-parameter.entity';

/**
 * The table has row-level security: every call sets `app.tenant_id` on its transaction, and every
 * query also filters by tenant itself, so a tenant sees only platform defaults and its own rows.
 */
@Injectable()
export class StatutoryRepository {
  constructor(private readonly scope: TenantScope) {}

  /** Platform and tenant rows of a year, every version, newest effective date first. */
  findForYear(
    tenantId: string,
    country: string,
    fiscalYear: number,
  ): Promise<StatutoryParameterEntity[]> {
    return this.scope.run(tenantId, (manager) =>
      manager
        .getRepository(StatutoryParameterEntity)
        .createQueryBuilder('p')
        .where('(p.tenantId IS NULL OR p.tenantId = :tenantId)', { tenantId })
        .andWhere('p.country = :country AND p.fiscalYear = :fiscalYear', {
          country,
          fiscalYear,
        })
        .orderBy('p.effectiveFrom', 'DESC')
        .addOrderBy('p.version', 'DESC')
        .getMany(),
    );
  }

  /** Fiscal years with at least one row, ascending. */
  configuredYears(tenantId: string, country: string): Promise<number[]> {
    return this.scope.run(tenantId, async (manager) => {
      const rows = await manager
        .getRepository(StatutoryParameterEntity)
        .createQueryBuilder('p')
        .select('DISTINCT p.fiscalYear', 'year')
        .where('(p.tenantId IS NULL OR p.tenantId = :tenantId)', { tenantId })
        .andWhere('p.country = :country', { country })
        .orderBy('year', 'ASC')
        .getRawMany<{ year: number }>();
      return rows.map((row) => Number(row.year));
    });
  }

  /** Insert the next version of a tenant's value; the version is taken under an advisory lock. */
  insertVersion(
    tenantId: string,
    row: Pick<
      StatutoryParameterEntity,
      | 'country'
      | 'fiscalYear'
      | 'paramKey'
      | 'effectiveFrom'
      | 'value'
      | 'source'
      | 'sourceKind'
      | 'verified'
      | 'createdBy'
    >,
  ): Promise<StatutoryParameterEntity> {
    return this.scope.run(tenantId, async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `statutory:${tenantId}:${row.country}:${row.fiscalYear}:${row.paramKey}`,
      ]);
      const repo = manager.getRepository(StatutoryParameterEntity);
      const latest = await repo.findOne({
        where: {
          tenantId,
          country: row.country,
          fiscalYear: row.fiscalYear,
          paramKey: row.paramKey,
          effectiveFrom: row.effectiveFrom,
        },
        order: { version: 'DESC' },
      });
      return repo.save(
        repo.create({ ...row, tenantId, version: (latest?.version ?? 0) + 1 }),
      );
    });
  }
}
