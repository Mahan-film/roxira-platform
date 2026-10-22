import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  FindManyOptions,
  FindOptionsWhere,
  ILike,
  In,
  Repository,
} from 'typeorm';
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
  /** ارز سطر (کد متعارف)؛ پیش‌فرض IRR. */
  currency?: string;
  /** مبلغ به ارز مبدأ (اختیاری). */
  amountFx?: number | null;
  /** نرخ تبدیل ارز مبدأ به ریال (اختیاری). */
  fxRate?: number | null;
  /** کد طرف حساب/تفضیلی (اختیاری). */
  partyCode?: string | null;
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

  async findAllAccounts(tenantId: string): Promise<ChartOfAccountEntity[]> {
    return this.accounts.find({ where: { tenantId }, order: { code: 'ASC' } });
  }

  async findAccountByCode(
    tenantId: string,
    code: string,
  ): Promise<ChartOfAccountEntity | null> {
    return this.accounts.findOne({ where: { code, tenantId } });
  }

  async findAccountsByCodes(
    tenantId: string,
    codes: string[],
  ): Promise<ChartOfAccountEntity[]> {
    if (codes.length === 0) {
      return [];
    }
    return this.accounts.find({
      where: codes.map((code) => ({ code, tenantId })),
    });
  }

  async countAccounts(tenantId: string): Promise<number> {
    return this.accounts.count({ where: { tenantId } });
  }

  async createAccount(
    tenantId: string,
    data: Partial<ChartOfAccountEntity>,
  ): Promise<ChartOfAccountEntity> {
    const entity = this.accounts.create({ ...data, tenantId });
    return this.accounts.save(entity);
  }

  async createAccounts(
    tenantId: string,
    data: Partial<ChartOfAccountEntity>[],
  ): Promise<ChartOfAccountEntity[]> {
    const entities = data.map((item) =>
      this.accounts.create({ ...item, tenantId }),
    );
    return this.accounts.save(entities);
  }

  /** شناسه حساب‌هایی که سطر سند دارند (ارجاع‌شده؛ undo ممنوع). */
  async findReferencedAccountIds(
    tenantId: string,
    ids: number[],
  ): Promise<number[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.lines.find({
      where: { tenantId, accountId: In(ids) },
      select: { accountId: true },
    });
    return Array.from(new Set(rows.map((row) => row.accountId)));
  }

  /** حذف حساب‌های یک دسته ورود داده با قید مستأجر (برای undo). */
  async deleteAccountsByIds(
    tenantId: string,
    ids: number[],
  ): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const result = await this.accounts.delete({ tenantId, id: In(ids) });
    return result.affected ?? 0;
  }

  /**
   * حذف اسناد یک دسته ورود داده و برگرداندن اثر آن‌ها روی مانده حساب‌ها.
   *
   * ابتدا اختلاف بدهکار-بستانکار هر حساب از سطرهای اسناد جمع می‌شود، سپس
   * اسناد (و با CASCADE سطرهایشان) حذف و مانده حساب‌ها به‌اندازه همان اختلاف
   * کاهش داده می‌شود. کل عملیات در یک Transaction اتمیک است.
   */
  async deleteJournalEntriesByIds(
    tenantId: string,
    ids: number[],
  ): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    return this.dataSource.transaction(async (manager) => {
      const entries = await manager.find(JournalEntryEntity, {
        where: { id: In(ids), tenantId },
        relations: { lines: true },
      });

      const deltaByAccount = new Map<number, number>();
      for (const entry of entries) {
        for (const line of entry.lines ?? []) {
          const delta = Number(line.debit) - Number(line.credit);
          deltaByAccount.set(
            line.accountId,
            (deltaByAccount.get(line.accountId) ?? 0) + delta,
          );
        }
      }

      if (entries.length > 0) {
        await manager.delete(JournalEntryEntity, {
          id: In(entries.map((entry) => entry.id)),
          tenantId,
        });
      }

      for (const [accountId, delta] of deltaByAccount) {
        await manager.increment(
          ChartOfAccountEntity,
          { id: accountId, tenantId },
          'balance',
          -delta,
        );
      }

      return entries.length;
    });
  }

  async findEntryByNumber(
    tenantId: string,
    entryNumber: string,
  ): Promise<JournalEntryEntity | null> {
    return this.entries.findOne({ where: { entryNumber, tenantId } });
  }

  async findEntryById(
    tenantId: string,
    id: number,
  ): Promise<JournalEntryEntity | null> {
    return this.entries.findOne({
      where: { id, tenantId },
      relations: { lines: true },
    });
  }

  async findAndCountEntries(
    tenantId: string,
    options: FindManyOptions<JournalEntryEntity>,
  ): Promise<[JournalEntryEntity[], number]> {
    const where = (options.where ?? {}) as FindOptionsWhere<JournalEntryEntity>;
    return this.entries.findAndCount({
      ...options,
      where: { ...where, tenantId },
    });
  }

  async searchEntriesByNumber(
    tenantId: string,
    entryNumber: string,
  ): Promise<JournalEntryEntity[]> {
    return this.entries.find({
      where: { entryNumber: ILike(`%${entryNumber}%`), tenantId },
      order: { date: 'DESC' },
      relations: { lines: true },
    });
  }

  /**
   * ثبت اتمیک سرصفحه سند، سطرها و به‌روزرسانی مانده حساب‌ها در یک Transaction.
   * در صورت بروز هر خطا، کل عملیات Rollback می‌شود تا دفاتر هرگز ناتراز نشوند.
   */
  async persistJournalEntry(
    tenantId: string,
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
        tenantId,
        entryNumber: header.entryNumber,
        date: header.date,
        description: header.description,
        status: header.status,
      });
      const savedHeader = await manager.save(headerEntity);

      for (const line of lineInputs) {
        const lineEntity = manager.create(JournalEntryLineEntity, {
          tenantId,
          journalEntryId: savedHeader.id,
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          currency: line.currency ?? 'IRR',
          amountFx: line.amountFx ?? null,
          fxRate: line.fxRate ?? null,
          partyCode: line.partyCode ?? null,
          description: line.description ?? null,
        });
        await manager.save(lineEntity);

        // مانده حساب با علامت بدهکار-مثبت نگهداری می‌شود؛ قید مستأجر ضامن
        // آن است که فقط مانده حساب همین سازمان تغییر کند.
        await manager.increment(
          ChartOfAccountEntity,
          { id: line.accountId, tenantId },
          'balance',
          line.debit - line.credit,
        );
      }

      const persisted = await manager.findOne(JournalEntryEntity, {
        where: { id: savedHeader.id, tenantId },
        relations: { lines: true },
      });
      return persisted as JournalEntryEntity;
    });
  }

  /**
   * تراز آزمایشی: جمع بدهکار/بستانکار هر حساب به‌صورت مستقیم از سطرهای اسناد.
   *
   * خروجی همیشه بر مبنای ریال است؛ با ارسال `currency` تنها سطرهای همان ارز
   * لحاظ می‌شوند و جمع مبالغ ارزی (amount_fx) و معادل ریالی آن‌ها نیز برمی‌گردد.
   */
  async getTrialBalance(
    tenantId: string,
    currency?: string,
  ): Promise<TrialBalanceRawRow[]> {
    const query = this.lines
      .createQueryBuilder('line')
      .innerJoin('line.account', 'account')
      .select('account.code', 'code')
      .addSelect('account.name', 'name')
      .addSelect('account.accountType', 'accountType')
      .addSelect('COALESCE(SUM(line.debit), 0)', 'totalDebit')
      .addSelect('COALESCE(SUM(line.credit), 0)', 'totalCredit')
      .addSelect('COALESCE(SUM(line.amountFx), 0)', 'totalAmountFx')
      .addSelect('COALESCE(SUM(line.amountFx * line.fxRate), 0)', 'totalFxInIrr')
      .where('line.tenantId = :tenantId', { tenantId });

    if (currency) {
      query.andWhere('line.currency = :currency', { currency });
    }

    return query
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
    tenantId: string,
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
      .where('line.tenantId = :tenantId', { tenantId })
      .andWhere('line.accountId = :accountId', { accountId })
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