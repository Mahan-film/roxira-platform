import { Injectable } from '@nestjs/common';
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
  ) {}

  /** Runs `work` in one database transaction (commit on success, rollback on throw). */
  async runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  async listAccounts(tenantId: string): Promise<BankAccountEntity[]> {
    return this.accounts.find({ where: { tenantId }, order: { id: 'ASC' } });
  }

  async findAccount(
    tenantId: string,
    id: number,
  ): Promise<BankAccountEntity | null> {
    return this.accounts.findOne({ where: { id, tenantId } });
  }

  async findAccountByNumber(
    tenantId: string,
    accountNumber: string,
  ): Promise<BankAccountEntity | null> {
    return this.accounts.findOne({ where: { accountNumber, tenantId } });
  }

  async createAccount(
    tenantId: string,
    input: BankAccountInput,
  ): Promise<BankAccountEntity> {
    return this.accounts.save(this.accounts.create({ ...input, tenantId }));
  }

  async insertStatementLines(
    tenantId: string,
    bankAccountId: number,
    inputs: StatementLineInput[],
  ): Promise<number[]> {
    if (inputs.length === 0) {
      return [];
    }
    const saved = await this.lines.save(
      inputs.map((input) =>
        this.lines.create({ ...input, tenantId, bankAccountId }),
      ),
    );
    return saved.map((line) => line.id);
  }

  async findExistingDedupeKeys(
    tenantId: string,
    keys: string[],
  ): Promise<string[]> {
    if (keys.length === 0) {
      return [];
    }
    const rows = await this.lines.find({
      select: { dedupeKey: true },
      where: { tenantId, dedupeKey: In(keys) },
    });
    return rows.map((row) => row.dedupeKey);
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
    return this.lines.find({ where, order: { txnDate: 'ASC', id: 'ASC' } });
  }

  async findLine(
    tenantId: string,
    id: number,
  ): Promise<BankStatementLineEntity | null> {
    return this.lines.findOne({ where: { id, tenantId } });
  }

  async findLinesByIds(
    tenantId: string,
    ids: number[],
  ): Promise<BankStatementLineEntity[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.lines.find({ where: { tenantId, id: In(ids) } });
  }

  async deleteLines(tenantId: string, ids: number[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const result = await this.lines.delete({ tenantId, id: In(ids) });
    return result.affected ?? 0;
  }

  /** (statement line id, journal line id) pairs this tenant has already matched (any bank account). */
  async findMatchedPairs(
    tenantId: string,
  ): Promise<{ id: number; journalLineId: number }[]> {
    const rows = await this.lines.find({
      select: { id: true, matchedJournalLineId: true },
      where: { tenantId, matchedJournalLineId: Not(IsNull()) },
    });
    return rows.map((row) => ({
      id: row.id,
      journalLineId: Number(row.matchedJournalLineId),
    }));
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
    const target = manager
      ? manager.getRepository(BankStatementLineEntity)
      : this.lines;
    const result = await target.update(
      { id: lineId, tenantId, matchedJournalLineId: IsNull() },
      patch,
    );
    return (result.affected ?? 0) > 0;
  }

  async clearMatch(tenantId: string, lineId: number): Promise<boolean> {
    const result = await this.lines.update(
      { id: lineId, tenantId },
      { matchedJournalLineId: null, matchMethod: null, matchedAt: null },
    );
    return (result.affected ?? 0) > 0;
  }
}
