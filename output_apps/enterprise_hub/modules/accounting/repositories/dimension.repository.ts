import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { DimensionEntity } from '../entities/dimension.entity';
import { DimensionKind } from '../enums/accounting.enum';

export interface DimensionBalanceRow {
  code: string;
  name: string;
  debit: string;
  credit: string;
  balance: string;
}

/** fin_dimensions has forced tenant RLS: every call sets `app.tenant_id` and filters by tenant too. */
@Injectable()
export class DimensionRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private scoped<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return work(manager);
    });
  }

  list(tenantId: string, kind?: DimensionKind): Promise<DimensionEntity[]> {
    return this.scoped(tenantId, (m) =>
      m.find(DimensionEntity, { where: kind ? { tenantId, kind } : { tenantId }, order: { kind: 'ASC', code: 'ASC' } }),
    );
  }

  /** Inserts one dimension; resolves null when (tenant, kind, code) already exists. */
  create(tenantId: string, data: { kind: DimensionKind; code: string; name: string }): Promise<DimensionEntity | null> {
    return this.scoped(tenantId, async (m) => {
      const rows: Array<{ id: number }> = (
        await m
          .createQueryBuilder()
          .insert()
          .into(DimensionEntity)
          .values({ tenantId, ...data })
          .orIgnore()
          .returning('id')
          .execute()
      ).raw;
      return rows.length === 0 ? null : m.findOneOrFail(DimensionEntity, { where: { tenantId, id: rows[0].id } });
    });
  }

  /** Debit, credit and balance per dimension over POSTED normal and opening lines in the range. */
  balances(tenantId: string, kind: DimensionKind, from: string, to: string): Promise<DimensionBalanceRow[]> {
    const column = { DETAIL: 'detail_id', COST_CENTER: 'cost_center_id', PROJECT: 'project_id' }[kind];
    return this.scoped(tenantId, (m) =>
      m.query(
        `SELECT d.code AS "code", d.name AS "name",
                COALESCE(SUM(l.debit), 0)::numeric(18,2) AS "debit", COALESCE(SUM(l.credit), 0)::numeric(18,2) AS "credit",
                COALESCE(SUM(l.debit - l.credit), 0)::numeric(18,2) AS "balance"
           FROM fin_dimensions d
           LEFT JOIN fin_journal_entry_lines l ON l.${column} = d.id AND l.tenant_id = d.tenant_id
             AND EXISTS (
               SELECT 1 FROM fin_journal_entries e
                WHERE e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id AND e.status = 'POSTED'
                  AND e.entry_type NOT IN ('CLOSING_PERM', 'CLOSING_TEMP', 'OPENING_AUTO')
                  AND CAST(e.date AS date) BETWEEN $3 AND $4)
          WHERE d.tenant_id = $1 AND d.kind = $2
          GROUP BY d.id, d.code, d.name
          ORDER BY d.code`,
        [tenantId, kind, from, to],
      ),
    );
  }
}
