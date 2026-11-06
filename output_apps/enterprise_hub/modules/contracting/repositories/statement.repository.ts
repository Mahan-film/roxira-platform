import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { fromDb } from '../../accounting/money';
import { TenantScope } from '../../access/services/tenant-scope';
import { ProgressStatementEntity } from '../entities/progress-statement.entity';
import { StatementStatus } from '../enums/contracting.enum';

export interface StatementInput {
  contractId: number;
  number: number;
  statementDate: string;
  cumulativeAmount: string;
  previousAmount: string;
  periodAmount: string;
}

/** The only access point to `erp_progress_statements` (FORCE RLS, every call in a TenantScope transaction). */
@Injectable()
export class StatementRepository {
  constructor(private readonly scope: TenantScope) {}

  runInTransaction<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  private within<T>(tenantId: string, manager: EntityManager | undefined, work: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.within(tenantId, manager, work);
  }

  listByContract(tenantId: string, contractId: number, manager?: EntityManager): Promise<ProgressStatementEntity[]> {
    return this.within(tenantId, manager, (m) =>
      m.getRepository(ProgressStatementEntity).find({ where: { tenantId, contractId }, order: { number: 'ASC' } }),
    );
  }

  findById(tenantId: string, id: number, manager?: EntityManager): Promise<ProgressStatementEntity | null> {
    return this.within(tenantId, manager, (m) => m.getRepository(ProgressStatementEntity).findOne({ where: { tenantId, id } }));
  }

  findLast(tenantId: string, contractId: number, manager?: EntityManager): Promise<ProgressStatementEntity | null> {
    return this.within(tenantId, manager, (m) =>
      m.getRepository(ProgressStatementEntity).findOne({ where: { tenantId, contractId }, order: { number: 'DESC' } }),
    );
  }

  /** Serialises numbering per contract: concurrent creates queue on this row lock. */
  async lockContract(tenantId: string, contractId: number, manager: EntityManager): Promise<void> {
    await this.within(tenantId, manager, (m) => m.query(`SELECT "id" FROM "erp_contracts" WHERE "tenant_id" = $1 AND "id" = $2 FOR UPDATE`, [tenantId, contractId]));
  }

  insert(tenantId: string, input: StatementInput, manager?: EntityManager): Promise<ProgressStatementEntity> {
    return this.within(tenantId, manager, (m) => {
      const repo = m.getRepository(ProgressStatementEntity);
      return repo.save(repo.create({ ...input, tenantId, status: StatementStatus.DRAFT }));
    });
  }

  private async transition(tenantId: string, id: number, from: StatementStatus, set: Record<string, unknown>, manager?: EntityManager): Promise<ProgressStatementEntity | null> {
    return this.within(tenantId, manager, async (m) => {
      const repo = m.getRepository(ProgressStatementEntity);
      const res = await repo.update({ tenantId, id, status: from }, set);
      return res.affected ? repo.findOne({ where: { tenantId, id } }) : null;
    });
  }

  /** draft -> approved, storing the deductions computed at approval and the figures they came from. */
  approveWith(
    tenantId: string,
    id: number,
    d: { retentionAmount: string; insuranceAmount: string; advanceRecoveryAmount: string; termsSnapshot: unknown },
    manager?: EntityManager,
  ) {
    return this.transition(tenantId, id, StatementStatus.DRAFT, { status: StatementStatus.APPROVED, approvedAt: () => 'now()', ...d }, manager);
  }

  /** Advance recovered by the statements before this number, in minor units. */
  recoveredBefore(tenantId: string, contractId: number, number: number, manager?: EntityManager): Promise<bigint> {
    return this.within(tenantId, manager, async (m) => {
      const [row] = await m.query(
        `SELECT COALESCE(SUM("advance_recovery_amount"), 0)::text AS total FROM "erp_progress_statements" WHERE "tenant_id" = $1 AND "contract_id" = $2 AND "number" < $3`,
        [tenantId, contractId, number],
      );
      return fromDb(row.total);
    });
  }

  markPosted(tenantId: string, id: number, entry: { journalEntryId: number; journalEntryNumber: string }, manager?: EntityManager) {
    return this.transition(tenantId, id, StatementStatus.APPROVED, { status: StatementStatus.POSTED, postedAt: () => 'now()', ...entry }, manager);
  }

  deleteDraft(tenantId: string, id: number, manager?: EntityManager): Promise<boolean> {
    return this.within(tenantId, manager, async (m) => {
      const res = await m.getRepository(ProgressStatementEntity).delete({ tenantId, id, status: StatementStatus.DRAFT });
      return (res.affected ?? 0) > 0;
    });
  }

  /** Posted statements per project: contractor side = billed, employer side = subcontracts (minor units). */
  postedTotalsByProject(tenantId: string, range: { from?: string; to?: string }): Promise<Map<number, { billed: bigint; subcontracts: bigint }>> {
    return this.within(tenantId, undefined, async (m) => {
      const rows: Array<{ project_id: number; side: string; total: string }> = await m.query(
        `SELECT c."project_id", c."side", COALESCE(SUM(s."period_amount"), 0)::text AS total
           FROM "erp_progress_statements" s
           JOIN "erp_contracts" c ON c."tenant_id" = s."tenant_id" AND c."id" = s."contract_id"
          WHERE s."tenant_id" = $1 AND s."status" = 'posted' AND c."project_id" IS NOT NULL
            AND ($2::date IS NULL OR s."statement_date" >= $2::date) AND ($3::date IS NULL OR s."statement_date" <= $3::date)
          GROUP BY c."project_id", c."side"`,
        [tenantId, range.from ?? null, range.to ?? null],
      );
      const out = new Map<number, { billed: bigint; subcontracts: bigint }>();
      for (const r of rows) {
        const entry = out.get(r.project_id) ?? { billed: 0n, subcontracts: 0n };
        if (r.side === 'contractor') entry.billed += fromDb(r.total);
        else entry.subcontracts += fromDb(r.total);
        out.set(r.project_id, entry);
      }
      return out;
    });
  }
}
