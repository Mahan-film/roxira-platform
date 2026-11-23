import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { DimensionEntity } from '../entities/dimension.entity';
import { DimensionRuleEntity } from '../entities/dimension-rule.entity';
import { DimensionLabelHistoryEntity } from '../entities/dimension-label-history.entity';
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

  list(tenantId: string, kind?: DimensionKind | string): Promise<DimensionEntity[]> {
    return this.scoped(tenantId, (m) =>
      m.find(DimensionEntity, {
        where: kind ? { tenantId, kind: kind as DimensionKind } : { tenantId },
        order: { kind: 'ASC', code: 'ASC' },
      }),
    );
  }

  findById(tenantId: string, id: number): Promise<DimensionEntity | null> {
    return this.scoped(tenantId, (m) => m.findOne(DimensionEntity, { where: { tenantId, id } }));
  }

  /** Inserts one dimension; resolves null when (tenant, kind, code) already exists. */
  create(
    tenantId: string,
    data: { kind: DimensionKind | string; code: string; name: string; parentId?: number | null },
  ): Promise<DimensionEntity | null> {
    return this.scoped(tenantId, async (m) => {
      const rows: Array<{ id: number }> = (
        await m
          .createQueryBuilder()
          .insert()
          .into(DimensionEntity)
          .values({ tenantId, ...data, kind: data.kind as DimensionKind })
          .orIgnore()
          .returning('id')
          .execute()
      ).raw;
      return rows.length === 0 ? null : m.findOneOrFail(DimensionEntity, { where: { tenantId, id: rows[0].id } });
    });
  }

  findByCode(tenantId: string, kind: DimensionKind | string, code: string): Promise<DimensionEntity | null> {
    return this.scoped(tenantId, (m) =>
      m.findOne(DimensionEntity, { where: { tenantId, kind: kind as DimensionKind, code } }),
    );
  }

  updateDimension(
    tenantId: string,
    id: number,
    data: { code?: string; name?: string },
  ): Promise<DimensionEntity> {
    return this.scoped(tenantId, async (m) => {
      await m.update(DimensionEntity, { id, tenantId }, data);
      return m.findOneOrFail(DimensionEntity, { where: { id, tenantId } });
    });
  }

  // ------------------ Dimension Rules (T181) ------------------

  createRule(
    tenantId: string,
    data: {
      name: string;
      accountType?: string | null;
      accountCode?: string | null;
      whenDimensionKind?: string | null;
      whenDimensionCode?: string | null;
      requiresDimensionKind: string;
    },
  ): Promise<DimensionRuleEntity> {
    return this.scoped(tenantId, async (m) => {
      const rule = m.create(DimensionRuleEntity, { tenantId, ...data, active: true });
      return m.save(DimensionRuleEntity, rule);
    });
  }

  listRules(tenantId: string): Promise<DimensionRuleEntity[]> {
    return this.scoped(tenantId, (m) =>
      m.find(DimensionRuleEntity, { where: { tenantId, active: true }, order: { id: 'ASC' } }),
    );
  }

  // ------------------ Label History (T181) ------------------

  addLabelHistory(
    tenantId: string,
    data: {
      dimensionId: number;
      code: string;
      name: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
  ): Promise<DimensionLabelHistoryEntity> {
    return this.scoped(tenantId, async (m) => {
      const history = m.create(DimensionLabelHistoryEntity, { tenantId, ...data });
      return m.save(DimensionLabelHistoryEntity, history);
    });
  }

  closePreviousLabelHistory(
    tenantId: string,
    dimensionId: number,
    effectiveTo: string,
  ): Promise<void> {
    return this.scoped(tenantId, async (m) => {
      await m.query(
        `UPDATE fin_dimension_label_history
            SET effective_to = $3::date
          WHERE tenant_id = $1 AND dimension_id = $2 AND effective_to IS NULL`,
        [tenantId, dimensionId, effectiveTo],
      );
    });
  }

  async getEffectiveLabel(
    tenantId: string,
    dimensionId: number,
    asOfDate: string,
  ): Promise<{ code: string; name: string } | null> {
    return this.scoped(tenantId, async (m) => {
      const rows: Array<{ code: string; name: string }> = await m.query(
        `SELECT code, name
           FROM fin_dimension_label_history
          WHERE tenant_id = $1 AND dimension_id = $2
            AND effective_from <= $3::date
            AND (effective_to IS NULL OR effective_to >= $3::date)
          ORDER BY effective_from DESC
          LIMIT 1`,
        [tenantId, dimensionId, asOfDate],
      );
      return rows.length > 0 ? rows[0] : null;
    });
  }

  async getEffectiveLabelsForKind(
    tenantId: string,
    kind: DimensionKind | string,
    asOfDate: string,
  ): Promise<Map<number, { code: string; name: string }>> {
    return this.scoped(tenantId, async (m) => {
      const rows: Array<{ dimension_id: number; code: string; name: string }> = await m.query(
        `SELECT h.dimension_id, h.code, h.name
           FROM fin_dimension_label_history h
           JOIN fin_dimensions d ON d.id = h.dimension_id AND d.tenant_id = h.tenant_id
          WHERE h.tenant_id = $1 AND d.kind = $2
            AND h.effective_from <= $3::date
            AND (h.effective_to IS NULL OR h.effective_to >= $3::date)
          ORDER BY h.effective_from ASC`,
        [tenantId, kind, asOfDate],
      );
      const map = new Map<number, { code: string; name: string }>();
      for (const r of rows) {
        map.set(r.dimension_id, { code: r.code, name: r.name });
      }
      return map;
    });
  }

  /** Debit, credit and balance per dimension over POSTED normal and opening lines in the range. */
  async balances(tenantId: string, kind: DimensionKind | string, from: string, to: string): Promise<DimensionBalanceRow[]> {
    const columnMap: Record<string, string> = {
      DETAIL: 'detail_id',
      COST_CENTER: 'cost_center_id',
      PROJECT: 'project_id',
    };
    const column = columnMap[kind as string];

    const joinClause = column
      ? `LEFT JOIN fin_journal_entry_lines l ON l.${column} = d.id AND l.tenant_id = d.tenant_id`
      : `LEFT JOIN fin_journal_entry_lines l ON (
           (l.dimensions->>'${kind}' = d.code OR l.dimensions->>'${(kind as string).toLowerCase()}' = d.code)
           AND l.tenant_id = d.tenant_id
         )`;

    const effectiveLabels = await this.getEffectiveLabelsForKind(tenantId, kind, to);

    const rows: Array<{ id: number; code: string; name: string; debit: string; credit: string; balance: string }> =
      await this.scoped(tenantId, (m) =>
        m.query(
          `SELECT d.id AS "id", d.code AS "code", d.name AS "name",
                  COALESCE(SUM(l.debit), 0)::numeric(18,2) AS "debit", COALESCE(SUM(l.credit), 0)::numeric(18,2) AS "credit",
                  COALESCE(SUM(l.debit - l.credit), 0)::numeric(18,2) AS "balance"
             FROM fin_dimensions d
             ${joinClause}
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

    return rows.map((r) => {
      const historical = effectiveLabels.get(r.id);
      return {
        code: historical ? historical.code : r.code,
        name: historical ? historical.name : r.name,
        debit: r.debit,
        credit: r.credit,
        balance: r.balance,
      };
    });
  }
}
