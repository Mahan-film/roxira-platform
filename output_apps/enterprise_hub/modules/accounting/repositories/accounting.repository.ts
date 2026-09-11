import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindManyOptions, ILike, Repository } from 'typeorm';
import { JournalEntryStatus } from '../enums/accounting.enum';
import { ChartOfAccountEntity } from '../entities/chart-of-account.entity';
import { JournalEntryLineEntity } from '../entities/journal-entry-line.entity';
import { JournalEntryEntity } from '../entities/journal-entry.entity';

/**
 * ورودی سطر سند برای پرسیستنس در Transaction واحد.
 */
export interface JournalLineInput {
  accountId: number;
  debit: number;
  credit: number;
  description?: string | null;
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
 */
@Injectable()
export class AccountingRepository {
  constructor(
    @InjectRepository(ChartOfAccountEntity)
    private readonly accounts: Repository<ChartOfAccountEntity>,
    @InjectRepository(JournalEntryEntity)
    private readonly entries: Repository<JournalEntryEntity>,
    @InjectRepository(JournalEntryLineEntity)
    private readonly lines: Repository<JournalEntryLineEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async findAllAccounts(): Promise<ChartOfAccountEntity[]> {
    return this.accounts.find({ order: { code: 'ASC' } });
  }

  async findAccountByCode(code: string): Promise<ChartOfAccountEntity | null> {
    return this.accounts.findOne({ where: { code } });
  }

  async findAccountsByCodes(codes: string[]): Promise<ChartOfAccountEntity[]> {
    if (codes.length === 0) {
      return [];
    }
    return this.accounts.find({ where: codes.map((code) => ({ code })) });
  }

  async createAccount(
    data: Partial<ChartOfAccountEntity>,
  ): Promise<ChartOfAccountEntity> {
    const entity = this.accounts.create(data);
    return this.accounts.save(entity);
  }

  async findEntryByNumber(
    entryNumber: string,
  ): Promise<JournalEntryEntity | null> {
    return this.entries.findOne({ where: { entryNumber } });
  }

  async findEntryById(id: number): Promise<JournalEntryEntity | null> {
    return this.entries.findOne({
      where: { id },
      relations: { lines: true },
    });
  }

  async findAndCountEntries(
    options: FindManyOptions<JournalEntryEntity>,
  ): Promise<[JournalEntryEntity[], number]> {
    return this.entries.findAndCount(options);
  }

  async searchEntriesByNumber(
    entryNumber: string,
  ): Promise<JournalEntryEntity[]> {
    return this.entries.find({
      where: { entryNumber: ILike(`%${entryNumber}%`) },
      order: { date: 'DESC' },
      relations: { lines: true },
    });
  }

  /**
   * ثبت اتمیک سرصفحه سند، سطرها و به‌روزرسانی مانده حساب‌ها در یک Transaction.
   * در صورت بروز هر خطا، کل عملیات Rollback می‌شود تا دفاتر هرگز ناتراز نشوند.
   */
  async persistJournalEntry(
    header: {
      entryNumber: string;
      date: Date;
      description: string;
      status: JournalEntryStatus;
    },
    lineInputs: JournalLineInput[],
  ): Promise<JournalEntryEntity> {
    return this.dataSource.transaction(async (manager) => {
      const headerEntity = manager.create(JournalEntryEntity, {
        entryNumber: header.entryNumber,
        date: header.date,
        description: header.description,
        status: header.status,
      });
      const savedHeader = await manager.save(headerEntity);

      for (const line of lineInputs) {
        const lineEntity = manager.create(JournalEntryLineEntity, {
          journalEntryId: savedHeader.id,
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          description: line.description ?? null,
        });
        await manager.save(lineEntity);

        // مانده حساب با علامت بدهکار-مثبت نگهداری می‌شود.
        await manager.increment(
          ChartOfAccountEntity,
          { id: line.accountId },
          'balance',
          line.debit - line.credit,
        );
      }

      const persisted = await manager.findOne(JournalEntryEntity, {
        where: { id: savedHeader.id },
        relations: { lines: true },
      });
      return persisted as JournalEntryEntity;
    });
  }

  /**
   * تراز آزمایشی: جمع بدهکار/بستانکار هر حساب به‌صورت مستقیم از سطرهای اسناد.
   */
  async getTrialBalance(): Promise<TrialBalanceRawRow[]> {
    return this.lines
      .createQueryBuilder('line')
      .innerJoin('line.account', 'account')
      .select('account.code', 'code')
      .addSelect('account.name', 'name')
      .addSelect('account.accountType', 'accountType')
      .addSelect('COALESCE(SUM(line.debit), 0)', 'totalDebit')
      .addSelect('COALESCE(SUM(line.credit), 0)', 'totalCredit')
      .groupBy('account.code')
      .addGroupBy('account.name')
      .addGroupBy('account.accountType')
      .orderBy('account.code', 'ASC')
      .getRawMany<TrialBalanceRawRow>();
  }

  /**
   * گردش حساب یک کد مشخص به همراه اطلاعات سند، مرتب بر اساس تاریخ و شناسه.
   */
  async getAccountLedger(
    accountId: number,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<LedgerRawRow[]> {
    const query = this.lines
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
      .where('line.accountId = :accountId', { accountId })
      .orderBy('entry.date', 'ASC')
      .addOrderBy('line.id', 'ASC');

    if (fromDate) {
      query.andWhere('entry.date >= :fromDate', { fromDate });
    }
    if (toDate) {
      query.andWhere('entry.date <= :toDate', { toDate });
    }

    return query.getRawMany<LedgerRawRow>();
  }
}