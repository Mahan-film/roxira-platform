import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { BankAccountEntity } from '../entities/bank-account.entity';
import { BankStatementLineEntity } from '../entities/bank-statement-line.entity';
import { BankCode, MatchMethod, StatementLineStatus } from '../enums/banking.enum';

/** Data for a new bank account (tenant comes separately, never from the client). */
export interface BankAccountInput {
  name: string;
  bankCode: BankCode;
  accountNumber: string;
  iban: string | null;
  ledgerAccountId: number;
  currency: string;
  openingBalance: number;
}

/** A parsed statement line ready to persist. */
export interface StatementLineInput {
  txnDate: string;
  description: string | null;
  withdrawal: number;
  deposit: number;
  balance: number | null;
  reference: string | null;
  dedupeKey: string;
}

export interface StatementLineFilter {
  status?: StatementLineStatus;
  fromDate?: string;
  toDate?: string;
}

/**
 * لایه Repository ماژول بانک — تنها نقطه دسترسی به جداول `fin_bank_accounts` و
 * `fin_bank_statement_lines`. هر خواندن/نوشتن با `tenantId` محدود می‌شود تا
 * سازمانی هرگز به حساب یا سطر سازمان دیگر دست نزند (AGENTS.md §4).
 */
@Injectable()
export class BankingRepository {
  constructor(
    @InjectRepository(BankAccountEntity)
    private readonly accounts: Repository<BankAccountEntity>,
    @InjectRepository(BankStatementLineEntity)
    private readonly lines: Repository<BankStatementLineEntity>,
    private readonly dataSource: DataSource,
    @Optional()
    private readonly scope?: TenantScope,
  ) {}

  private get tenantScope(): TenantScope | undefined {
    if (this.scope) {
      return this.scope;
    }
    const ds = this.dataSource ?? this.accounts?.manager?.connection;
    if (typeof (ds as { transaction?: unknown } | undefined)?.transaction === 'function') {
      return new TenantScope(ds);
    }
    return undefined;
  }

  private withAccounts<T>(
    tenantId: string,
    work: (repo: Repository<BankAccountEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.tenantScope;
    if (scope) {
      return scope.run(tenantId, (m) => work(m.getRepository(BankAccountEntity)));
    }
    return work(this.accounts);
  }

  private withLines<T>(
    tenantId: string,
    work: (repo: Repository<BankStatementLineEntity>) => Promise<T>,
    manager?: EntityManager,
  ): Promise<T> {
    const scope = this.tenantScope;
    if (scope) {
      return scope.within(tenantId, manager, (m) => work(m.getRepository(BankStatementLineEntity)));
    }
    const target = manager ? manager.getRepository(BankStatementLineEntity) : this.lines;
    return work(target);
  }

  /** Runs `work` in one database transaction (commit on success, rollback on throw). */
  async runInTransaction<T>(
    work: (manager: EntityManager) => Promise<T>,
    tenantId?: string,
  ): Promise<T> {
    const scope = this.tenantScope;
    if (tenantId && scope) {
      return scope.run(tenantId, work);
    }
    return this.dataSource.transaction(work);
  }

  async listAccounts(tenantId: string): Promise<BankAccountEntity[]> {
    return this.withAccounts(tenantId, (repo) =>
      repo.find({ where: { tenantId }, order: { id: 'ASC' } }),
    );
  }

  async findAccount(
    tenantId: string,
    id: number,
  ): Promise<BankAccountEntity | null> {
    return this.withAccounts(tenantId, (repo) => repo.findOne({ where: { id, tenantId } }));
  }

  async findAccountByNumber(
    tenantId: string,
    accountNumber: string,
  ): Promise<BankAccountEntity | null> {
    return this.withAccounts(tenantId, (repo) =>
      repo.findOne({ where: { accountNumber, tenantId } }),
    );
  }

  async createAccount(
    tenantId: string,
    input: BankAccountInput,
  ): Promise<BankAccountEntity> {
    return this.withAccounts(tenantId, (repo) =>
      repo.save(repo.create({ ...input, tenantId })),
    );
  }

  async insertStatementLines(
    tenantId: string,
    bankAccountId: number,
    inputs: StatementLineInput[],
  ): Promise<number[]> {
    if (inputs.length === 0) {
      return [];
    }
    return this.withLines(tenantId, async (repo) => {
      const saved = await repo.save(
        inputs.map((input) => repo.create({ ...input, tenantId, bankAccountId })),
      );
      return saved.map((line) => line.id);
    });
  }

  async findExistingDedupeKeys(
    tenantId: string,
    keys: string[],
  ): Promise<string[]> {
    if (keys.length === 0) {
      return [];
    }
    return this.withLines(tenantId, async (repo) => {
      const rows = await repo.find({
        select: { dedupeKey: true },
        where: { tenantId, dedupeKey: In(keys) },
      });
      return rows.map((row) => row.dedupeKey);
    });
  }

  async findLines(
    tenantId: string,
    bankAccountId: number,
    filter: StatementLineFilter = {},
  ): Promise<BankStatementLineEntity[]> {
    const where: FindOptionsWhere<BankStatementLineEntity> = {
      tenantId,
      bankAccountId,
    };
    if (filter.status === StatementLineStatus.MATCHED) {
      where.matchedJournalLineId = Not(IsNull());
    } else if (filter.status === StatementLineStatus.UNMATCHED) {
      where.matchedJournalLineId = IsNull();
    }
    if (filter.fromDate && filter.toDate) {
      where.txnDate = Between(filter.fromDate, filter.toDate);
    } else if (filter.fromDate) {
      where.txnDate = MoreThanOrEqual(filter.fromDate);
    } else if (filter.toDate) {
      where.txnDate = LessThanOrEqual(filter.toDate);
    }
    return this.withLines(tenantId, (repo) =>
      repo.find({ where, order: { txnDate: 'ASC', id: 'ASC' } }),
    );
  }

  async findLine(
    tenantId: string,
    id: number,
  ): Promise<BankStatementLineEntity | null> {
    return this.withLines(tenantId, (repo) => repo.findOne({ where: { id, tenantId } }));
  }

  async findLinesByIds(
    tenantId: string,
    ids: number[],
  ): Promise<BankStatementLineEntity[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.withLines(tenantId, (repo) => repo.find({ where: { tenantId, id: In(ids) } }));
  }

  async deleteLines(tenantId: string, ids: number[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    return this.withLines(tenantId, async (repo) => {
      const result = await repo.delete({ tenantId, id: In(ids) });
      return result.affected ?? 0;
    });
  }

  /** (statement line id, journal line id) pairs this tenant has already matched (any bank account). */
  async findMatchedPairs(
    tenantId: string,
  ): Promise<{ id: number; journalLineId: number }[]> {
    return this.withLines(tenantId, async (repo) => {
      const rows = await repo.find({
        select: { id: true, matchedJournalLineId: true },
        where: { tenantId, matchedJournalLineId: Not(IsNull()) },
      });
      return rows.map((row) => ({
        id: row.id,
        journalLineId: Number(row.matchedJournalLineId),
      }));
    });
  }

  /**
   * Sets a match only while the line is still unmatched (guards against a concurrent match).
   * Returns false if nothing was updated.
   */
  async setMatch(
    tenantId: string,
    lineId: number,
    journalLineId: number,
    method: MatchMethod,
    createdJournalEntryId: number | null = null,
    manager?: EntityManager,
  ): Promise<boolean> {
    const patch: Partial<BankStatementLineEntity> = {
      matchedJournalLineId: journalLineId,
      matchMethod: method,
      matchedAt: new Date(),
    };
    if (createdJournalEntryId !== null) {
      patch.createdJournalEntryId = createdJournalEntryId;
    }
    return this.withLines(
      tenantId,
      async (repo) => {
        const result = await repo.update(
          { id: lineId, tenantId, matchedJournalLineId: IsNull() },
          patch,
        );
        return (result.affected ?? 0) > 0;
      },
      manager,
    );
  }

  async clearMatch(tenantId: string, lineId: number): Promise<boolean> {
    return this.withLines(tenantId, async (repo) => {
      const result = await repo.update(
        { id: lineId, tenantId },
        { matchedJournalLineId: null, matchMethod: null, matchedAt: null },
      );
      return (result.affected ?? 0) > 0;
    });
  }
}
