import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { DepreciationLineEntity, FixedAssetEntity } from '../entities/fixed-asset.entity';

/** The asset tables have forced tenant RLS: every call runs in a transaction that sets `app.tenant_id`. */
@Injectable()
export class FixedAssetRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  scoped<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return work(manager);
    });
  }

  list(tenantId: string): Promise<FixedAssetEntity[]> {
    return this.scoped(tenantId, (m) => m.find(FixedAssetEntity, { where: { tenantId }, order: { code: 'ASC' } }));
  }

  findByCode(tenantId: string, code: string, manager: EntityManager): Promise<FixedAssetEntity | null> {
    return manager.findOne(FixedAssetEntity, { where: { tenantId, code } });
  }

  save(tenantId: string, data: Partial<FixedAssetEntity>, manager: EntityManager): Promise<FixedAssetEntity> {
    return manager.save(manager.create(FixedAssetEntity, { ...data, tenantId }));
  }

  /** Active assets, row-locked so two runs of the same month cannot both charge them. */
  lockActive(tenantId: string, manager: EntityManager): Promise<FixedAssetEntity[]> {
    return manager.find(FixedAssetEntity, {
      where: { tenantId, status: 'ACTIVE' },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async entriesInPeriod(tenantId: string, year: number, month: number, manager: EntityManager): Promise<number> {
    const rows: Array<{ n: string }> = await manager.query(
      `SELECT count(DISTINCT journal_entry_id) AS n FROM fin_depreciation_lines
        WHERE tenant_id = $1 AND period_year = $2 AND period_month = $3`,
      [tenantId, year, month],
    );
    return Number(rows[0].n);
  }

  async applyCharge(
    tenantId: string,
    asset: FixedAssetEntity,
    line: { year: number; month: number; amount: string; journalEntryId: number },
    update: { accumulatedDepreciation: string; status: FixedAssetEntity['status'] },
    manager: EntityManager,
  ): Promise<void> {
    await manager.insert(DepreciationLineEntity, {
      tenantId,
      assetId: asset.id,
      periodYear: line.year,
      periodMonth: line.month,
      amount: line.amount,
      journalEntryId: line.journalEntryId,
    });
    await manager.update(
      FixedAssetEntity,
      { id: asset.id, tenantId },
      {
        accumulatedDepreciation: update.accumulatedDepreciation,
        monthsDepreciated: asset.monthsDepreciated + 1,
        nextPeriodIndex: asset.nextPeriodIndex + 1,
        status: update.status,
      },
    );
  }

  /** Marks the asset's next month done when its charge rounds to zero (no depreciation line). */
  async advanceWithoutCharge(tenantId: string, asset: FixedAssetEntity, manager: EntityManager): Promise<void> {
    await manager.update(
      FixedAssetEntity,
      { id: asset.id, tenantId },
      { monthsDepreciated: asset.monthsDepreciated + 1, nextPeriodIndex: asset.nextPeriodIndex + 1 },
    );
  }
}
