import { Injectable } from '@nestjs/common';
import { TenantScope } from '../../access/services/tenant-scope';
import {
  EntityManager,
  FindManyOptions,
  FindOptionsWhere,
  ILike,
  In,
} from 'typeorm';
import { JournalEntryStatus, JournalEntryType } from '../enums/accounting.enum';
import { ChartOfAccountEntity } from '../entities/chart-of-account.entity';
import { JournalEntryLineEntity } from '../entities/journal-entry-line.entity';
import { JournalEntryEntity } from '../entities/journal-entry.entity';
import { PeriodLockEntity } from '../entities/period-lock.entity';
import { minorToDecimal } from '../money';
import { JournalSearchFilter, journalSearchWhere } from './journal-search.sql';
import {
  DuplicateEntryNumberError,
  LockedPeriodError,
  UnknownDimensionError,
} from '../exceptions/ledger.exceptions';

/** Advisory-lock namespace shared by posting (shared) and period lock/unlock (exclusive). */
const LEDGER_LOCK_NAMESPACE = 7001;

/**
 * ورودی سطر سند برای پرسیستنس در Transaction واحد.
 */
export interface JournalLineInput {
  accountId: number;
  /** Exact integer minor units; never a float. */
  debitMinor: bigint;
  creditMinor: bigint;
  description?: string | null;
  /** ارز سطر (کد متعارف)؛ پیش‌فرض IRR. */
  currency?: string;
  /** مبلغ به ارز مبدأ (اختیاری)، رشته دهدهی دقیق (۶ رقم اعشار). */
  amountFx?: string | null;
  /** نرخ تبدیل ارز مبدأ به ریال (اختیاری)، رشته دهدهی دقیق. */
  fxRate?: string | null;
  /** کد طرف حساب/تفضیلی (اختیاری). */
  partyCode?: string | null;
  /** Dimension codes; the repository resolves them to ids inside the write transaction. */
  detailCode?: string | null;
  costCenterCode?: string | null;
  projectCode?: string | null;
}

/**
 * سطر خام تراز آزمایشی (خروجی Query Builder).
 */
export interface TrialBalanceRawRow {
  code: string;
  name: string;
  accountType: string;
  totalDebit: string;
  totalCredit: string;
  totalAmountFx?: string;
  totalFxInIrr?: string;
}

/**
 * سطر خام گردش حساب (خروجی Query Builder).
 */
export interface LedgerRawRow {
  id: number;
  journalEntryId: number;
  entryNumber: string;
  date: Date;
  entryDescription: string;
  lineDescription: string | null;
  debit: string;
  credit: string;
}

/**
 * لایه Repository — تنها نقطه دسترسی به جداول مالی برای ماژول Accounting.
 * Controller/Service هرگز نباید مستقیماً به TypeORM Repository دسترسی داشته
 * باشند (Rule #3 - AGENTS.md: Repository Pattern).
 *
 * Every read/write that can run inside a caller's transaction takes an optional `manager`; when
 * given, ALL statements of the call use it (nothing silently falls back to the pool connection).
 */
@Injectable()
export class AccountingRepository {
  constructor(private readonly scope: TenantScope) {}

  /** Runs `work` in one transaction (the caller's, if a manager is passed). */
  transaction<T>(
    tenantId: string,
    work: (manager: EntityManager) => Promise<T>,
    outerManager?: EntityManager,
  ): Promise<T> {
    return this.scope.within(tenantId, outerManager, work);
  }

  async findAllAccounts(
    tenantId: string,
    manager?: EntityManager,
  ): Promise<ChartOfAccountEntity[]> {
    return this.scope.within(tenantId, manager, async (m) => {
      return m.getRepository(ChartOfAccountEntity).find({
        where: { tenantId },
        order: { code: 'ASC' },
      });
    });
  }

  async findAccountById(
    tenantId: string,
    id: number,
  ): Promise<ChartOfAccountEntity | null> {
    return this.scope.within(tenantId, undefined, async (m) => {
      return m.getRepository(ChartOfAccountEntity).findOne({ where: { id, tenantId } });
    });
  }

  async findAccountByCode(
    tenantId: string,
    code: string,
  ): Promise<ChartOfAccountEntity | null> {
    return this.scope.within(tenantId, undefined, async (m) => {
      return m.getRepository(ChartOfAccountEntity).findOne({ where: { code, tenantId } });
    });
  }

  async findAccountsByCodes(
    tenantId: string,
    codes: string[],
    manager?: EntityManager,
  ): Promise<ChartOfAccountEntity[]> {
    return this.scope.within(tenantId, manager, async (m) => {
      if (codes.length === 0) {
        return [];
      }
      return m.getRepository(ChartOfAccountEntity).find({
        where: codes.map((code) => ({ code, tenantId })),
      });
    });
  }

  async countAccounts(tenantId: string, manager?: EntityManager): Promise<number> {
    return this.scope.within(tenantId, manager, async (m) => {
      return m.getRepository(ChartOfAccountEntity).count({ where: { tenantId } });
    });
  }

  async createAccount(
    tenantId: string,
    data: Partial<ChartOfAccountEntity>,
  ): Promise<ChartOfAccountEntity> {
    return this.scope.within(tenantId, undefined, async (m) => {
      const entity = m.getRepository(ChartOfAccountEntity).create({ ...data, tenantId });
      return m.getRepository(ChartOfAccountEntity).save(entity);
    });
  }

  async createAccounts(
    tenantId: string,
    data: Partial<ChartOfAccountEntity>[],
  ): Promise<ChartOfAccountEntity[]> {
    return this.scope.within(tenantId, undefined, async (m) => {
      const entities = data.map((item) =>
        m.getRepository(ChartOfAccountEntity).create({ ...item, tenantId }),
      );
      return m.getRepository(ChartOfAccountEntity).save(entities, { chunk: 500 }); // stay under the bind-parameter limit
    });
  }

  /**
   * Inserts accounts whose (tenant, code) does not exist yet and silently skips the rest
   * (ON CONFLICT DO NOTHING). Concurrent first requests of a new tenant all try to seed the
   * default chart; a plain insert made all but one fail with a unique-key 500.
   */
  async insertMissingAccounts(
    tenantId: string,
    data: Partial<ChartOfAccountEntity>[],
    manager?: EntityManager,
  ): Promise<void> {
    return this.scope.within(tenantId, manager, async (m) => {
      if (data.length === 0) {
        return;
      }
      const repo = m.getRepository(ChartOfAccountEntity);
      const entities = data.map((item) => repo.create({ ...item, tenantId }));
      await repo
        .createQueryBuilder()
        .insert()
        .into(ChartOfAccountEntity)
        .values(entities)
        .orIgnore()
        .execute();
    });
  }

  /** Sets level, parent and report line on existing accounts; names, types and balances stay. */
  async updateAccountMetadata(
    tenantId: string,
    code: string,
    data: Pick<ChartOfAccountEntity, 'level' | 'parentCode' | 'reportLine'>,
    manager?: EntityManager,
  ): Promise<void> {
    return this.scope.within(tenantId, manager, async (m) => {
      await m.getRepository(ChartOfAccountEntity).update({ tenantId, code }, data);
    });
  }

  /** شناسه حساب‌هایی که سطر سند دارند (ارجاع‌شده؛ undo ممنوع). */
  async findReferencedAccountIds(
    tenantId: string,
    ids: number[],
  ): Promise<number[]> {
    return this.scope.within(tenantId, undefined, async (m) => {
      if (ids.length === 0) {
        return [];
      }
      const rows = await m.getRepository(JournalEntryLineEntity).find({
        where: { tenantId, accountId: In(ids) },
        select: { accountId: true },
      });
      return Array.from(new Set(rows.map((row) => row.accountId)));
    });
  }

  /** حذف حساب‌های یک دسته ورود داده با قید مستأجر (برای undo). */
  async deleteAccountsByIds(
    tenantId: string,
    ids: number[],
  ): Promise<number> {
    return this.scope.within(tenantId, undefined, async (m) => {
      if (ids.length === 0) {
        return 0;
      }
      const result = await m.getRepository(ChartOfAccountEntity).delete({ tenantId, id: In(ids) });
      return result.affected ?? 0;
    });
  }

  async findEntryByNumber(
    tenantId: string,
    entryNumber: string,
    manager?: EntityManager,
  ): Promise<JournalEntryEntity | null> {
    return this.scope.within(tenantId, manager, async (m) => {
      return m.getRepository(JournalEntryEntity).findOne({
        where: { entryNumber, tenantId },
      });
    });
  }

  /** The reversing entry of `entryId`, if one was posted. */
  async findReversalOf(
    tenantId: string,
    entryId: number,
    manager?: EntityManager,
  ): Promise<JournalEntryEntity | null> {
    return this.scope.within(tenantId, manager, async (m) => {
      return m.getRepository(JournalEntryEntity).findOne({
        where: { tenantId, reversesEntryId: entryId },
      });
    });
  }

  async findEntryById(
    tenantId: string,
    id: number,
    manager?: EntityManager,
  ): Promise<JournalEntryEntity | null> {
    return this.scope.within(tenantId, manager, async (m) => {
      return m.getRepository(JournalEntryEntity).findOne({
        where: { id, tenantId },
        relations: { lines: true },
      });
    });
  }

  async findEntriesByIds(
    tenantId: string,
    ids: number[],
    manager?: EntityManager,
  ): Promise<JournalEntryEntity[]> {
    return this.scope.within(tenantId, manager, async (m) => {
      if (ids.length === 0) {
        return [];
      }
      return m.getRepository(JournalEntryEntity).find({
        where: { tenantId, id: In(ids) },
        relations: { lines: true },
        order: { id: 'ASC' },
      });
    });
  }

  async findAndCountEntries(
    tenantId: string,
    options: FindManyOptions<JournalEntryEntity>,
  ): Promise<[JournalEntryEntity[], number]> {
    return this.scope.within(tenantId, undefined, async (m) => {
      const where = (options.where ?? {}) as FindOptionsWhere<JournalEntryEntity>;
      return m.getRepository(JournalEntryEntity).findAndCount({
        ...options,
        where: { ...where, tenantId },
      });
    });
  }

  /**
   * Journal entry search (amount, date, account, party, text): one page of matching entries,
   * newest first, with their lines, and the total match count. SQL in `journal-search.sql.ts`.
   */
  async searchEntries(
    tenantId: string,
    filter: JournalSearchFilter,
    page: { skip: number; take: number },
  ): Promise<[JournalEntryEntity[], number]> {
    const { where, params } = journalSearchWhere(tenantId, filter);
    return this.scope.within(tenantId, undefined, async (m) => {
      const n = params.length;
      // One transaction, one connection: the two queries run one after the other.
      const ids: Array<{ id: number }> = await m.query(
        `SELECT e.id AS "id" FROM fin_journal_entries e WHERE ${where}
          ORDER BY e.date DESC, e.id DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...params, page.take, page.skip],
      );
      const counted: Array<{ total: string }> = await m.query(
        `SELECT COUNT(*) AS "total" FROM fin_journal_entries e WHERE ${where}`,
        params,
      );
      const total = Number(counted[0]?.total ?? 0);
      if (ids.length === 0) {
        return [[], total];
      }
      const order = new Map(ids.map((row, i) => [Number(row.id), i]));
      const entries = await m.getRepository(JournalEntryEntity).find({
        where: { tenantId, id: In([...order.keys()]) },
        relations: { lines: true },
      });
      entries.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      return [entries, total];
    });
  }

  async searchEntriesByNumber(
    tenantId: string,
    entryNumber: string,
  ): Promise<JournalEntryEntity[]> {
    return this.scope.within(tenantId, undefined, async (m) => {
      return m.getRepository(JournalEntryEntity).find({
        where: { entryNumber: ILike(`%${entryNumber}%`), tenantId },
        order: { date: 'DESC' },
        relations: { lines: true },
      });
    });
  }

  /**
   * ثبت اتمیک سرصفحه سند، سطرها و به‌روزرسانی مانده حساب‌ها در یک Transaction.
   *
   *  - Takes the tenant's ledger advisory lock in SHARED mode (period lock/unlock takes it
   *    exclusively), so "check period is open" and "insert" cannot interleave with a lock.
   *  - The header is inserted with ON CONFLICT DO NOTHING: a duplicate (tenant, number) is
   *    reported as `DuplicateEntryNumberError` without raising a Postgres error, so a caller's
   *    outer transaction is never left in the aborted state.
   *  - Balance updates are applied one account at a time in ascending account id order, so two
   *    concurrent entries touching the same accounts cannot deadlock.
   *
   * @throws LockedPeriodError the date is inside an active period lock.
   * @throws DuplicateEntryNumberError the entry number (or the reversal of the same entry) exists.
   */
  async persistJournalEntry(
    tenantId: string,
    header: {
      entryNumber: string;
      date: Date;
      description: string;
      status: JournalEntryStatus;
      reversesEntryId?: number | null;
      entryType?: JournalEntryType;
    },
    lineInputs: JournalLineInput[],
    outerManager?: EntityManager,
  ): Promise<JournalEntryEntity> {
    return this.transaction(tenantId, async (manager) => {
      await this.lockLedgerShared(tenantId, manager);
      await this.assertDateOpen(tenantId, header.date, manager);

      const inserted: Array<{ id: number }> = (
        await manager
          .createQueryBuilder()
          .insert()
          .into(JournalEntryEntity)
          .values({
            tenantId,
            entryNumber: header.entryNumber,
            date: header.date,
            description: header.description,
            status: header.status,
            reversesEntryId: header.reversesEntryId ?? null,
            entryType: header.entryType ?? JournalEntryType.NORMAL,
          })
          .orIgnore()
          .returning('id')
          .execute()
      ).raw;
      if (inserted.length === 0) {
        throw new DuplicateEntryNumberError(header.entryNumber);
      }
      const entryId = inserted[0].id;

      await this.insertLines(tenantId, entryId, lineInputs, manager);

      // Only final entries move the cached account balances; drafts and temporary entries do not.
      if (header.status === JournalEntryStatus.POSTED) {
        await this.applyBalanceDeltas(tenantId, lineInputs, header.entryNumber, manager);
      }

      return (await manager.findOne(JournalEntryEntity, {
        where: { id: entryId, tenantId },
        relations: { lines: true },
      })) as JournalEntryEntity;
    }, outerManager);
  }

  /**
   * Debit-positive balance deltas, applied in a fixed order (ascending account id) so two
   * concurrent entries touching the same accounts cannot deadlock.
   */
  private async applyBalanceDeltas(
    tenantId: string,
    lineInputs: JournalLineInput[],
    entryNumber: string,
    manager: EntityManager,
  ): Promise<void> {
    const deltaByAccount = new Map<number, bigint>();
    for (const line of lineInputs) {
      deltaByAccount.set(
        line.accountId,
        (deltaByAccount.get(line.accountId) ?? 0n) + line.debitMinor - line.creditMinor,
      );
    }
    const accountIds = Array.from(deltaByAccount.keys()).sort((a, b) => a - b);
    for (const accountId of accountIds) {
      // `pg` returns `[rows, rowCount]` for UPDATE, plain rows for SELECT.
      const result: unknown[] = await manager.query(
        `UPDATE "fin_chart_of_accounts" SET "balance" = "balance" + $1::numeric
          WHERE "id" = $2 AND "tenant_id" = $3 RETURNING "id"`,
        [minorToDecimal(deltaByAccount.get(accountId)!), accountId, tenantId],
      );
      const updated = Array.isArray(result[0]) ? result[0] : result;
      if (updated.length !== 1) {
        throw new Error(
          `Account ${accountId} not found for tenant while posting entry ${entryNumber}.`,
        );
      }
    }
  }

  /** Row-locks one entry (header only) so concurrent edits and status changes serialise. */
  async lockEntry(
    tenantId: string,
    id: number,
    manager: EntityManager,
  ): Promise<JournalEntryEntity | null> {
    await this.lockLedgerShared(tenantId, manager);
    return manager.findOne(JournalEntryEntity, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * Replaces the header fields and every line of a DRAFT or TEMPORARY entry. The caller has
   * locked the entry and checked its status; the database refuses to touch a POSTED one anyway.
   */
  async replaceEntryContent(
    tenantId: string,
    entryId: number,
    header: { entryNumber: string; date: Date; description: string },
    lineInputs: JournalLineInput[],
    manager: EntityManager,
  ): Promise<void> {
    await manager.delete(JournalEntryLineEntity, { journalEntryId: entryId, tenantId });
    await manager.update(JournalEntryEntity, { id: entryId, tenantId }, {
      entryNumber: header.entryNumber,
      date: header.date,
      description: header.description,
    });
    await this.insertLines(tenantId, entryId, lineInputs, manager);
  }

  /** Maps `KIND:code` to the id of an active dimension; an unknown code throws UnknownDimensionError. */
  private async resolveDimensions(
    tenantId: string,
    lineInputs: JournalLineInput[],
    manager: EntityManager,
  ): Promise<Map<string, number>> {
    const wanted = new Set<string>();
    for (const line of lineInputs) {
      if (line.detailCode) wanted.add(`DETAIL:${line.detailCode}`);
      if (line.costCenterCode) wanted.add(`COST_CENTER:${line.costCenterCode}`);
      if (line.projectCode) wanted.add(`PROJECT:${line.projectCode}`);
    }
    const ids = new Map<string, number>();
    if (wanted.size === 0) {
      return ids;
    }
    await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const rows: Array<{ id: number; key: string }> = await manager.query(
      `SELECT id, kind || ':' || code AS key FROM fin_dimensions
        WHERE tenant_id = $1 AND active AND kind || ':' || code = ANY($2)`,
      [tenantId, Array.from(wanted)],
    );
    for (const row of rows) {
      ids.set(row.key, row.id);
    }
    for (const key of wanted) {
      if (!ids.has(key)) {
        const [kind, ...code] = key.split(':');
        throw new UnknownDimensionError(kind, code.join(':'));
      }
    }
    return ids;
  }

  private async insertLines(
    tenantId: string,
    entryId: number,
    lineInputs: JournalLineInput[],
    manager: EntityManager,
  ): Promise<void> {
    const ids = await this.resolveDimensions(tenantId, lineInputs, manager);
    const lineRows = lineInputs.map((line) => ({
      detailId: line.detailCode ? ids.get(`DETAIL:${line.detailCode}`)! : null,
      costCenterId: line.costCenterCode ? ids.get(`COST_CENTER:${line.costCenterCode}`)! : null,
      projectId: line.projectCode ? ids.get(`PROJECT:${line.projectCode}`)! : null,
      tenantId,
      journalEntryId: entryId,
      accountId: line.accountId,
      debit: minorToDecimal(line.debitMinor),
      credit: minorToDecimal(line.creditMinor),
      currency: line.currency ?? 'IRR',
      amountFx: line.amountFx ?? null,
      fxRate: line.fxRate ?? null,
      partyCode: line.partyCode ?? null,
      description: line.description ?? null,
    }));
    for (let offset = 0; offset < lineRows.length; offset += 200) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(JournalEntryLineEntity)
        .values(lineRows.slice(offset, offset + 200))
        .execute();
    }
  }

  /**
   * Moves an entry between states. Becoming POSTED applies the line totals to the account
   * balances in the same transaction; the database refuses an unbalanced or locked-period post.
   */
  async setEntryStatus(
    tenantId: string,
    entry: JournalEntryEntity,
    status: JournalEntryStatus,
    lineInputs: JournalLineInput[],
    manager: EntityManager,
  ): Promise<void> {
    await manager.update(JournalEntryEntity, { id: entry.id, tenantId }, { status });
    if (status === JournalEntryStatus.POSTED) {
      await this.applyBalanceDeltas(tenantId, lineInputs, entry.entryNumber, manager);
    }
  }

  /** Deletes a DRAFT or TEMPORARY entry; its lines go with it. */
  async deleteEntry(tenantId: string, id: number, manager: EntityManager): Promise<void> {
    await manager.delete(JournalEntryEntity, { id, tenantId });
  }

  // ---------------------------------------------------------------------------
  // Period locks
  // ---------------------------------------------------------------------------

  /** Shared advisory lock: held by every posting until its transaction ends. */
  private async lockLedgerShared(
    tenantId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      `SELECT pg_advisory_xact_lock_shared($1, hashtext($2))`,
      [LEDGER_LOCK_NAMESPACE, tenantId],
    );
  }

  /** Exclusive advisory lock: waits for in-flight postings and blocks new ones. */
  async lockLedgerExclusive(
    tenantId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [
      LEDGER_LOCK_NAMESPACE,
      tenantId,
    ]);
  }

  /** @throws LockedPeriodError when `date` lies inside an active lock of the tenant. */
  async assertDateOpen(
    tenantId: string,
    date: Date,
    manager?: EntityManager,
  ): Promise<void> {
    const locked = await this.findActiveLockCovering(tenantId, date, manager);
    if (locked) {
      throw new LockedPeriodError(this.dayOf(date));
    }
  }

  async findActiveLockCovering(
    tenantId: string,
    date: Date,
    manager?: EntityManager,
  ): Promise<PeriodLockEntity | null> {
    return this.scope.within(tenantId, manager, async (m) => {
      // The calendar day is computed by PostgreSQL from the same bound value the INSERT uses, so
      // this check and the BEFORE INSERT trigger can never disagree about the day (time zones).
      return m.getRepository(PeriodLockEntity)
        .createQueryBuilder('lock')
        .where('lock.tenantId = :tenantId', { tenantId })
        .andWhere('lock.unlockedAt IS NULL')
        .andWhere(
          'CAST(CAST(:date AS timestamp) AS date) BETWEEN lock.periodStart AND lock.periodEnd',
          { date },
        )
        .getOne();
    });
  }

  private dayOf(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  async createPeriodLock(
    tenantId: string,
    data: {
      periodStart: string;
      periodEnd: string;
      reason: string | null;
      lockedBy: string;
    },
    outerManager?: EntityManager,
  ): Promise<PeriodLockEntity> {
    return this.transaction(tenantId, async (manager) => {
      await this.lockLedgerExclusive(tenantId, manager);
      return manager.save(
        manager.create(PeriodLockEntity, { ...data, tenantId }),
      );
    }, outerManager);
  }

  /** Returns null when the lock does not exist for this tenant or is already unlocked. */
  async unlockPeriod(
    tenantId: string,
    id: number,
    data: { unlockedBy: string; unlockReason: string },
    outerManager?: EntityManager,
  ): Promise<PeriodLockEntity | null> {
    return this.transaction(tenantId, async (manager) => {
      await this.lockLedgerExclusive(tenantId, manager);
      const rows: unknown[] = (
        await manager
          .createQueryBuilder()
          .update(PeriodLockEntity)
          .set({
            unlockedAt: () => 'now()',
            unlockedBy: data.unlockedBy,
            unlockReason: data.unlockReason,
          })
          .where('id = :id AND tenant_id = :tenantId AND unlocked_at IS NULL', {
            id,
            tenantId,
          })
          .returning('id')
          .execute()
      ).raw;
      if (rows.length === 0) {
        return null;
      }
      return manager.findOne(PeriodLockEntity, { where: { id, tenantId } });
    }, outerManager);
  }

  async findPeriodLock(
    tenantId: string,
    id: number,
  ): Promise<PeriodLockEntity | null> {
    return this.scope.within(tenantId, undefined, async (m) => {
      return m.getRepository(PeriodLockEntity).findOne({ where: { id, tenantId } });
    });
  }

  async listPeriodLocks(tenantId: string): Promise<PeriodLockEntity[]> {
    return this.scope.within(tenantId, undefined, async (m) => {
      return m.getRepository(PeriodLockEntity).find({
        where: { tenantId },
        order: { lockedAt: 'DESC', id: 'DESC' },
      });
    });
  }

  /**
   * تراز آزمایشی: جمع بدهکار/بستانکار هر حساب به‌صورت مستقیم از سطرهای اسناد.
   *
   * خروجی همیشه بر مبنای ریال است؛ با ارسال `currency` تنها سطرهای همان ارز
   * لحاظ می‌شوند و جمع مبالغ ارزی (amount_fx) و معادل ریالی آن‌ها نیز برمی‌گردد.
   * Sums are PostgreSQL numeric, returned as exact decimal strings.
   */
  async getTrialBalance(
    tenantId: string,
    currency?: string,
  ): Promise<TrialBalanceRawRow[]> {
    return this.scope.within(tenantId, undefined, async (m) => {
      const query = m.getRepository(JournalEntryLineEntity)
        .createQueryBuilder('line')
        .innerJoin('line.account', 'account')
        .innerJoin('line.journalEntry', 'entry')
        .select('account.code', 'code')
        .addSelect('account.name', 'name')
        .addSelect('account.accountType', 'accountType')
        .addSelect('COALESCE(SUM(line.debit), 0)', 'totalDebit')
        .addSelect('COALESCE(SUM(line.credit), 0)', 'totalCredit')
        .addSelect('COALESCE(SUM(line.amountFx), 0)', 'totalAmountFx')
        .addSelect('COALESCE(SUM(line.amountFx * line.fxRate), 0)', 'totalFxInIrr')
        .where('line.tenantId = :tenantId', { tenantId })
        .andWhere('entry.status = :posted', { posted: JournalEntryStatus.POSTED });

      if (currency) {
        query.andWhere('line.currency = :currency', { currency });
      }

      return query
        .groupBy('account.code')
        .addGroupBy('account.name')
        .addGroupBy('account.accountType')
        .orderBy('account.code', 'ASC')
        .getRawMany<TrialBalanceRawRow>();
    });
  }

  /**
   * سطرهای مشخص یک حساب (با اطلاعات سند) برای تطبیق بانکی؛ فقط سطرهای همین
   * مستأجر و همین حساب برمی‌گردند.
   */
  async findLedgerLinesByIds(
    tenantId: string,
    accountId: number,
    lineIds: number[],
  ): Promise<LedgerRawRow[]> {
    return this.scope.within(tenantId, undefined, async (m) => {
      if (lineIds.length === 0) {
        return [];
      }
      return m.getRepository(JournalEntryLineEntity)
        .createQueryBuilder('line')
        .innerJoin('line.journalEntry', 'entry')
        .select('line.id', 'id')
        .addSelect('line.journalEntryId', 'journalEntryId')
        .addSelect('entry.entryNumber', 'entryNumber')
        .addSelect('entry.date', 'date')
        .addSelect('entry.description', 'entryDescription')
        .addSelect('line.description', 'lineDescription')
        .addSelect('line.debit', 'debit')
        .addSelect('line.credit', 'credit')
        .where('line.tenantId = :tenantId', { tenantId })
        .andWhere('line.accountId = :accountId', { accountId })
        .andWhere('line.id IN (:...lineIds)', { lineIds })
        .andWhere('entry.status = :posted', { posted: JournalEntryStatus.POSTED })
        .getRawMany<LedgerRawRow>();
    });
  }

  /**
   * Totals of one account's POSTED lines computed by PostgreSQL over the WHOLE requested range:
   * the net of everything dated before `fromDate` (opening), debit and credit inside
   * [fromDate, toDate] and the number of lines in it. Independent of any page size.
   */
  async getAccountLedgerSummary(
    tenantId: string,
    accountId: number,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<{ openingNet: string; debit: string; credit: string; count: string }> {
    return this.scope.within(tenantId, undefined, async (m) => {
      const rows = await m.query(
        `SELECT COALESCE(SUM(l.debit - l.credit) FILTER (WHERE $3::timestamp IS NOT NULL AND e.date < $3::timestamp), 0) AS "openingNet",
                COALESCE(SUM(l.debit) FILTER (WHERE ($3::timestamp IS NULL OR e.date >= $3::timestamp) AND ($4::timestamp IS NULL OR e.date <= $4::timestamp)), 0) AS "debit",
                COALESCE(SUM(l.credit) FILTER (WHERE ($3::timestamp IS NULL OR e.date >= $3::timestamp) AND ($4::timestamp IS NULL OR e.date <= $4::timestamp)), 0) AS "credit",
                COUNT(*) FILTER (WHERE ($3::timestamp IS NULL OR e.date >= $3::timestamp) AND ($4::timestamp IS NULL OR e.date <= $4::timestamp)) AS "count"
           FROM fin_journal_entry_lines l
           JOIN fin_journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
          WHERE l.tenant_id = $1 AND l.account_id = $2 AND e.status = 'POSTED'`,
        [tenantId, accountId, fromDate ?? null, toDate ?? null],
      );
      return rows[0];
    });
  }

  /**
   * One page (LIMIT/OFFSET) of the ledger lines in [fromDate, toDate], ordered by date then line id,
   * plus `precedingNet`: debit - credit of the in-range lines BEFORE the page, so a later page's
   * running balance starts from the sum of the earlier rows, not from zero.
   */
  async getAccountLedgerPage(
    tenantId: string,
    accountId: number,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    offset: number,
    limit: number,
  ): Promise<{ rows: LedgerRawRow[]; precedingNet: string }> {
    return this.scope.within(tenantId, undefined, async (m) => {
      const from = `FROM fin_journal_entry_lines l
           JOIN fin_journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
          WHERE l.tenant_id = $1 AND l.account_id = $2 AND e.status = 'POSTED'
            AND ($3::timestamp IS NULL OR e.date >= $3::timestamp)
            AND ($4::timestamp IS NULL OR e.date <= $4::timestamp)
          ORDER BY e.date ASC, l.id ASC`;
      const rows = await m.query(
        `SELECT l.id AS "id", l.journal_entry_id AS "journalEntryId", e.entry_number AS "entryNumber",
                e.date AS "date", e.description AS "entryDescription", l.description AS "lineDescription",
                l.debit AS "debit", l.credit AS "credit"
           ${from} LIMIT $5 OFFSET $6`,
        [tenantId, accountId, fromDate ?? null, toDate ?? null, limit, offset],
      );
      let precedingNet = '0';
      if (offset > 0) {
        const before = await m.query(
          `SELECT COALESCE(SUM(x.d - x.c), 0) AS "net" FROM (
             SELECT l.debit AS d, l.credit AS c ${from} LIMIT $5) x`,
          [tenantId, accountId, fromDate ?? null, toDate ?? null, offset],
        );
        precedingNet = before[0].net;
      }
      return { rows: rows as LedgerRawRow[], precedingNet };
    });
  }

  /**
   * گردش حساب یک کد مشخص به همراه اطلاعات سند، مرتب بر اساس تاریخ و شناسه.
   */
  async getAccountLedger(
    tenantId: string,
    accountId: number,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<LedgerRawRow[]> {
    return this.scope.within(tenantId, undefined, async (m) => {
      const query = m.getRepository(JournalEntryLineEntity)
        .createQueryBuilder('line')
        .innerJoin('line.journalEntry', 'entry')
        .select('line.id', 'id')
        .addSelect('line.journalEntryId', 'journalEntryId')
        .addSelect('entry.entryNumber', 'entryNumber')
        .addSelect('entry.date', 'date')
        .addSelect('entry.description', 'entryDescription')
        .addSelect('line.description', 'lineDescription')
        .addSelect('line.debit', 'debit')
        .addSelect('line.credit', 'credit')
        .where('line.tenantId = :tenantId', { tenantId })
        .andWhere('line.accountId = :accountId', { accountId })
        .andWhere('entry.status = :posted', { posted: JournalEntryStatus.POSTED })
        .orderBy('entry.date', 'ASC')
        .addOrderBy('line.id', 'ASC');

      if (fromDate) {
        query.andWhere('entry.date >= :fromDate', { fromDate });
      }
      if (toDate) {
        query.andWhere('entry.date <= :toDate', { toDate });
      }

      return query.getRawMany<LedgerRawRow>();
    });
  }
}
