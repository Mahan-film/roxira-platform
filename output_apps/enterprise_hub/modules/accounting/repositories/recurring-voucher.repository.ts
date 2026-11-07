import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { RecurringVoucherFrequency } from '../constants/recurring-voucher.constants';
import {
  RecurringVoucherEntity,
  RecurringVoucherLine,
} from '../entities/recurring-voucher.entity';

/** A run row waiting for its automatic reversal. */
export interface DueReversalRow {
  id: number;
  recurringId: number;
  journalEntryId: number;
  reversalDate: string;
}

/**
 * Persistence for recurring voucher templates and runs.
 *
 * Both tables carry forced tenant RLS: every call enters TenantScope (`app.tenant_id`) and also
 * filters by `tenant_id`, so a missing scope returns nothing rather than another tenant's rows.
 * `tenantIds` is the one exception: the `tenants` table itself has no row-level security, so the
 * daily job can enumerate tenants and then work tenant by tenant.
 */
@Injectable()
export class RecurringVoucherRepository {
  constructor(
    private readonly scope: TenantScope,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Runs `work` inside a tenant-scoped transaction (the caller's, when a manager is passed). */
  transaction<T>(
    tenantId: string,
    work: (manager: EntityManager) => Promise<T>,
    outerManager?: EntityManager,
  ): Promise<T> {
    return this.scope.within(tenantId, outerManager, work);
  }

  list(tenantId: string): Promise<RecurringVoucherEntity[]> {
    return this.scope.within(tenantId, undefined, (m) =>
      m.find(RecurringVoucherEntity, { where: { tenantId }, order: { id: 'ASC' } }),
    );
  }

  findById(tenantId: string, id: number): Promise<RecurringVoucherEntity | null> {
    return this.scope.within(tenantId, undefined, (m) =>
      m.findOne(RecurringVoucherEntity, { where: { tenantId, id } }),
    );
  }

  /** Active templates whose next run date has arrived, oldest first. */
  findActiveDue(tenantId: string, today: string): Promise<RecurringVoucherEntity[]> {
    return this.scope.within(tenantId, undefined, (m) =>
      m
        .createQueryBuilder(RecurringVoucherEntity, 'v')
        .where('v.tenantId = :tenantId', { tenantId })
        .andWhere('v.active = true')
        .andWhere('v.nextRunDate <= :today', { today })
        .orderBy('v.nextRunDate', 'ASC')
        .addOrderBy('v.id', 'ASC')
        .getMany(),
    );
  }

  create(
    tenantId: string,
    data: {
      name: string;
      description: string;
      lines: RecurringVoucherLine[];
      frequency: RecurringVoucherFrequency;
      nextRunDate: string;
      endDate: string | null;
      autoReverse: boolean;
      active: boolean;
      createdBy: string;
    },
    manager?: EntityManager,
  ): Promise<RecurringVoucherEntity> {
    return this.scope.within(tenantId, manager, (m) =>
      m.save(m.create(RecurringVoucherEntity, { ...data, tenantId })),
    );
  }

  async update(
    tenantId: string,
    id: number,
    data: {
      name: string;
      description: string;
      lines: RecurringVoucherLine[];
      frequency: RecurringVoucherFrequency;
      nextRunDate: string;
      endDate: string | null;
      autoReverse: boolean;
      active: boolean;
    },
  ): Promise<RecurringVoucherEntity | null> {
    return this.scope.within(tenantId, undefined, async (m) => {
      await m.update(RecurringVoucherEntity, { id, tenantId }, data);
      return m.findOne(RecurringVoucherEntity, { where: { id, tenantId } });
    });
  }

  async remove(tenantId: string, id: number): Promise<boolean> {
    return this.scope.within(tenantId, undefined, async (m) => {
      const result = await m.delete(RecurringVoucherEntity, { id, tenantId });
      return (result.affected ?? 0) > 0;
    });
  }

  /**
   * Claims the (tenant, recurring, run_date) slot. Returns the new run id, or null when another
   * runner already claimed it — the unique index is the idempotency guard.
   */
  async insertRunIfAbsent(
    tenantId: string,
    recurringId: number,
    runDate: string,
    manager: EntityManager,
  ): Promise<number | null> {
    const rows: Array<{ id: number }> = await manager.query(
      `INSERT INTO "erp_recurring_voucher_runs" ("tenant_id", "recurring_id", "run_date")
       VALUES ($1, $2, $3)
       ON CONFLICT ("tenant_id", "recurring_id", "run_date") DO NOTHING
       RETURNING "id"`,
      [tenantId, recurringId, runDate],
    );
    return rows.length === 0 ? null : rows[0].id;
  }

  /** Records the voucher a run produced and, for an accrual, the day it must be reversed. */
  attachRunEntry(
    tenantId: string,
    runId: number,
    journalEntryId: number,
    reversalDate: string | null,
    manager: EntityManager,
  ): Promise<unknown> {
    return manager.query(
      `UPDATE "erp_recurring_voucher_runs"
          SET "journal_entry_id" = $3, "reversal_date" = $4
        WHERE "id" = $1 AND "tenant_id" = $2`,
      [runId, tenantId, journalEntryId, reversalDate],
    );
  }

  setNextRunDate(tenantId: string, id: number, nextRunDate: string): Promise<unknown> {
    return this.scope.within(tenantId, undefined, (m) =>
      m.query(
        `UPDATE "erp_recurring_vouchers"
            SET "next_run_date" = $3, "updated_at" = now()
          WHERE "id" = $1 AND "tenant_id" = $2`,
        [id, tenantId, nextRunDate],
      ),
    );
  }

  /** Runs whose reversal day has arrived and that are not yet reversed, oldest first. */
  findDueReversals(tenantId: string, today: string): Promise<DueReversalRow[]> {
    return this.scope.within(tenantId, undefined, async (m) => {
      const rows: Array<{
        id: number;
        recurring_id: number;
        journal_entry_id: number;
        reversal_date: string;
      }> = await m.query(
        `SELECT "id", "recurring_id", "journal_entry_id", "reversal_date"
           FROM "erp_recurring_voucher_runs"
          WHERE "tenant_id" = $1
            AND "reversal_entry_id" IS NULL
            AND "journal_entry_id" IS NOT NULL
            AND "reversal_date" IS NOT NULL
            AND "reversal_date" <= $2
          ORDER BY "reversal_date" ASC, "id" ASC`,
        [tenantId, today],
      );
      return rows.map((row) => ({
        id: row.id,
        recurringId: row.recurring_id,
        journalEntryId: row.journal_entry_id,
        reversalDate: row.reversal_date,
      }));
    });
  }

  setRunReversalEntry(
    tenantId: string,
    runId: number,
    reversalEntryId: number,
  ): Promise<unknown> {
    return this.scope.within(tenantId, undefined, (m) =>
      m.query(
        `UPDATE "erp_recurring_voucher_runs"
            SET "reversal_entry_id" = $3
          WHERE "id" = $1 AND "tenant_id" = $2`,
        [runId, tenantId, reversalEntryId],
      ),
    );
  }

  /** The `tenants` table has no RLS, so the daily job can enumerate tenants. */
  async tenantIds(): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT "id" FROM "tenants"`,
    );
    return rows.map((row) => row.id);
  }
}
