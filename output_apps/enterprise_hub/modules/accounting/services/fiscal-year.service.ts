import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Currency } from '../../currency/enums/currency.enum';
import { INCOME_SUMMARY_ACCOUNT, RETAINED_EARNINGS_ACCOUNT } from '../constants/iran-chart-template';
import {
  CloseFiscalYearDto,
  CloseResultDto,
  CreateFiscalYearDto,
  FiscalYearResponseDto,
  ReopenFiscalYearDto,
} from '../dto/fiscal-year.dto';
import { FiscalYearEntity } from '../entities/fiscal-year.entity';
import {
  AccountType,
  FiscalYearStatus,
  JournalEntryType,
  ReportLine,
} from '../enums/accounting.enum';
import { fromDb, minorToDecimal } from '../money';
import { AccountingRepository } from '../repositories/accounting.repository';
import { FiscalYearRepository } from '../repositories/fiscal-year.repository';
import { LedgerReportRepository } from '../repositories/ledger-report.repository';
import { AccountingService } from './accounting.service';

const realDay = (day: string): boolean => {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
};

/** Mid-day UTC keeps the calendar day whatever the database session time zone is. */
const entryDate = (day: string): string => `${day}T12:00:00.000Z`;

const addDays = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

interface CloseLine {
  accountCode: string;
  debit: string;
  credit: string;
}

/**
 * Fiscal years and their close.
 *
 * A close runs in one transaction under the tenant's exclusive ledger lock and posts:
 *  1. FC-<id>-<seq>-1 (CLOSING_TEMP): every revenue and expense balance into income summary;
 *  2. FC-<id>-<seq>-2 (CLOSING_TEMP): income summary into retained earnings;
 *  3. FC-<id>-<seq>-3 (CLOSING_PERM): the closing entry of permanent accounts, on the last day;
 *  4. FO-<id>-<seq> (OPENING_AUTO): the opening entry of the next year, on its first day;
 * then locks the year. Entries 3 and 4 mirror each other and reports leave both out, so a permanent
 * balance carries across the year end exactly. Reopening reverses all four and unlocks the year.
 */
@Injectable()
export class FiscalYearService {
  constructor(
    private readonly accountingRepository: AccountingRepository,
    private readonly fiscalYears: FiscalYearRepository,
    private readonly reports: LedgerReportRepository,
    private readonly accounting: AccountingService,
  ) {}

  private toDto(entity: FiscalYearEntity): FiscalYearResponseDto {
    return {
      id: entity.id,
      name: entity.name,
      startDate: entity.startDate,
      endDate: entity.endDate,
      status: entity.status,
      closedAt: entity.closedAt,
      closedBy: entity.closedBy,
    };
  }

  async list(tenantId: string): Promise<FiscalYearResponseDto[]> {
    const years = await this.fiscalYears.list(tenantId);
    return years.map((year) => this.toDto(year));
  }

  async create(tenantId: string, dto: CreateFiscalYearDto): Promise<FiscalYearResponseDto> {
    const year = await this.accountingRepository.transaction(tenantId, async (manager) => {
      await this.accountingRepository.lockLedgerExclusive(tenantId, manager);
      return this.insertYear(tenantId, dto, manager);
    });
    return this.toDto(year);
  }

  /** Validates dates and overlap. Runs under the exclusive ledger lock. */
  private async insertYear(
    tenantId: string,
    dto: CreateFiscalYearDto,
    manager: EntityManager,
  ): Promise<FiscalYearEntity> {
    if (!realDay(dto.startDate) || !realDay(dto.endDate)) {
      throw new BadRequestException('تاریخ شروع و پایان سال مالی معتبر نیست.');
    }
    if (dto.startDate > dto.endDate) {
      throw new BadRequestException('شروع سال مالی باید پیش از پایان آن باشد.');
    }
    const years = await this.fiscalYears.list(tenantId, manager);
    const clash = years.find(
      (year) => dto.startDate <= year.endDate && dto.endDate >= year.startDate,
    );
    if (clash) {
      throw new ConflictException(`این بازه با سال مالی ${clash.name} همپوشانی دارد.`);
    }
    if (years.some((year) => year.name === dto.name.trim())) {
      throw new ConflictException(`سال مالی ${dto.name} قبلاً تعریف شده است.`);
    }
    return this.fiscalYears.save(
      tenantId,
      { name: dto.name.trim(), startDate: dto.startDate, endDate: dto.endDate },
      manager,
    );
  }

  private entryNumbers(year: FiscalYearEntity, seq: number) {
    const base = `FC-${year.id}-${seq}`;
    return {
      summary: `${base}-1`,
      retained: `${base}-2`,
      closing: `${base}-3`,
      opening: `FO-${year.id}-${seq}`,
    };
  }

  /** The tenant's account for a close role, created in place when the chart has none. */
  private async closingAccount(
    tenantId: string,
    line: ReportLine,
    fallback: { code: string; name: string },
    manager: EntityManager,
  ): Promise<string> {
    const accounts = await this.accountingRepository.findAllAccounts(tenantId, manager);
    const existing = accounts.find((a) => a.reportLine === line);
    if (existing) {
      return existing.code;
    }
    const byCode = accounts.find((a) => a.code === fallback.code);
    if (byCode) {
      if (byCode.accountType !== AccountType.EQUITY) {
        throw new ConflictException(
          `کد ${fallback.code} برای حساب دیگری استفاده شده است؛ یک حساب حقوق مالکانه با ردیف گزارش ${line} تعیین کنید.`,
        );
      }
      return byCode.code;
    }
    await this.accountingRepository.insertMissingAccounts(
      tenantId,
      [
        {
          code: fallback.code,
          name: fallback.name,
          accountType: AccountType.EQUITY,
          currency: Currency.IRR,
          balance: '0',
          reportLine: line,
        },
      ],
      manager,
    );
    return fallback.code;
  }

  async close(
    tenantId: string,
    actor: string,
    id: number,
    dto: CloseFiscalYearDto,
  ): Promise<CloseResultDto> {
    return this.accountingRepository.transaction(tenantId, async (manager) => {
      await this.accountingRepository.lockLedgerExclusive(tenantId, manager);
      const years = await this.fiscalYears.list(tenantId, manager);
      const year = years.find((candidate) => candidate.id === id);
      if (!year) {
        throw new NotFoundException(`سال مالی با شناسه ${id} یافت نشد.`);
      }
      if (year.status === FiscalYearStatus.CLOSED) {
        throw new ConflictException(`سال مالی ${year.name} قبلاً بسته شده است.`);
      }
      const earlier = years.find(
        (candidate) =>
          candidate.startDate < year.startDate && candidate.status === FiscalYearStatus.OPEN,
      );
      if (earlier) {
        throw new ConflictException(`ابتدا سال مالی ${earlier.name} را ببندید.`);
      }

      const nextStart = addDays(year.endDate, 1);
      let next = years.find((candidate) => candidate.startDate === nextStart);
      if (!next) {
        if (!dto.nextYear) {
          throw new BadRequestException(
            'سال مالی بعد تعریف نشده است؛ مشخصات آن را همراه درخواست بستن بفرستید.',
          );
        }
        if (dto.nextYear.startDate !== nextStart) {
          throw new BadRequestException(`سال مالی بعد باید از ${nextStart} شروع شود.`);
        }
        next = await this.insertYear(tenantId, dto.nextYear, manager);
      }

      const seq = year.closeSeq + 1;
      const numbers = this.entryNumbers(year, seq);
      const posted = await this.postClosingEntries(tenantId, year, next, numbers, manager);

      const lock = await this.accountingRepository.createPeriodLock(
        tenantId,
        {
          periodStart: year.startDate,
          periodEnd: year.endDate,
          reason: `بستن سال مالی ${year.name}`,
          lockedBy: actor,
        },
        manager,
      );
      const saved = await this.fiscalYears.save(
        tenantId,
        {
          ...year,
          status: FiscalYearStatus.CLOSED,
          closeSeq: seq,
          closedAt: new Date(),
          closedBy: actor,
          periodLockId: lock.id,
        },
        manager,
      );
      return { year: this.toDto(saved), nextYear: this.toDto(next), entryNumbers: posted };
    });
  }

  private async postClosingEntries(
    tenantId: string,
    year: FiscalYearEntity,
    next: FiscalYearEntity,
    numbers: ReturnType<FiscalYearService['entryNumbers']>,
    manager: EntityManager,
  ): Promise<string[]> {
    const accounts = await this.accountingRepository.findAllAccounts(tenantId, manager);
    const accountByCode = new Map(accounts.map((account) => [account.code, account]));
    const balances = new Map(
      (await this.reports.balancesUpTo(tenantId, year.endDate, manager)).map((row) => [
        row.code,
        fromDb(row.balance),
      ]),
    );
    const isTemporary = (code: string): boolean => {
      const type = accountByCode.get(code)?.accountType;
      return type === AccountType.REVENUE || type === AccountType.EXPENSE;
    };
    const line = (accountCode: string, debitPositive: bigint): CloseLine => ({
      accountCode,
      debit: minorToDecimal(debitPositive > 0n ? debitPositive : 0n),
      credit: minorToDecimal(debitPositive < 0n ? -debitPositive : 0n),
    });
    const post = async (
      entryNumber: string,
      day: string,
      description: string,
      lines: CloseLine[],
      type: JournalEntryType,
    ): Promise<void> => {
      await this.accounting.postTypedEntry(
        tenantId,
        { entryNumber, date: entryDate(day), description, lines } as never,
        type,
        manager,
      );
      posted.push(entryNumber);
    };
    const posted: string[] = [];

    const temporary = [...balances].filter(([code, value]) => isTemporary(code) && value !== 0n);
    const summaryCode = await this.closingAccount(
      tenantId,
      ReportLine.INCOME_SUMMARY,
      INCOME_SUMMARY_ACCOUNT,
      manager,
    );
    const retainedCode = await this.closingAccount(
      tenantId,
      ReportLine.RETAINED_EARNINGS,
      RETAINED_EARNINGS_ACCOUNT,
      manager,
    );
    const netTemporary = temporary.reduce((sum, [, value]) => sum + value, 0n);
    if (temporary.length > 0) {
      await post(
        numbers.summary,
        year.endDate,
        `بستن حساب‌های موقت سال مالی ${year.name}`,
        [
          ...temporary.map(([code, value]) => line(code, -value)),
          ...(netTemporary !== 0n ? [line(summaryCode, netTemporary)] : []),
        ],
        JournalEntryType.CLOSING_TEMP,
      );
    }
    if (netTemporary !== 0n) {
      await post(
        numbers.retained,
        year.endDate,
        `انتقال خلاصه سود و زیان سال مالی ${year.name} به سود و زیان انباشته`,
        [line(summaryCode, -netTemporary), line(retainedCode, netTemporary)],
        JournalEntryType.CLOSING_TEMP,
      );
      balances.set(retainedCode, (balances.get(retainedCode) ?? 0n) + netTemporary);
    }

    const permanent = [...balances].filter(([code, value]) => !isTemporary(code) && value !== 0n);
    if (permanent.length > 0) {
      await post(
        numbers.closing,
        year.endDate,
        `سند اختتامیه سال مالی ${year.name}`,
        permanent.map(([code, value]) => line(code, -value)),
        JournalEntryType.CLOSING_PERM,
      );
      await post(
        numbers.opening,
        next.startDate,
        `سند افتتاحیه سال مالی ${next.name}`,
        permanent.map(([code, value]) => line(code, value)),
        JournalEntryType.OPENING_AUTO,
      );
    }
    return posted;
  }

  /** Undoes a close by reversal: nothing is deleted. Only the latest closed year can reopen. */
  async reopen(
    tenantId: string,
    actor: string,
    id: number,
    dto: ReopenFiscalYearDto,
  ): Promise<FiscalYearResponseDto> {
    return this.accountingRepository.transaction(tenantId, async (manager) => {
      await this.accountingRepository.lockLedgerExclusive(tenantId, manager);
      const years = await this.fiscalYears.list(tenantId, manager);
      const year = years.find((candidate) => candidate.id === id);
      if (!year) {
        throw new NotFoundException(`سال مالی با شناسه ${id} یافت نشد.`);
      }
      if (year.status !== FiscalYearStatus.CLOSED) {
        throw new ConflictException(`سال مالی ${year.name} باز است.`);
      }
      const later = years.find(
        (candidate) =>
          candidate.startDate > year.startDate && candidate.status === FiscalYearStatus.CLOSED,
      );
      if (later) {
        throw new ConflictException(`ابتدا سال مالی ${later.name} را بازگشایی کنید.`);
      }
      const reason = dto.reason.trim();
      if (year.periodLockId != null) {
        await this.accountingRepository.unlockPeriod(
          tenantId,
          year.periodLockId,
          { unlockedBy: actor, unlockReason: reason },
          manager,
        );
      }
      const numbers = this.entryNumbers(year, year.closeSeq);
      const entries = await this.reports.findCloseEntryIds(
        tenantId,
        Object.values(numbers),
        manager,
      );
      for (const entry of entries) {
        await this.accounting.reverseTypedEntry(
          tenantId,
          entry.id,
          { date: entryDate(entry.date), reason },
          manager,
        );
      }
      const saved = await this.fiscalYears.save(
        tenantId,
        {
          ...year,
          status: FiscalYearStatus.OPEN,
          closedAt: null,
          closedBy: null,
          periodLockId: null,
        },
        manager,
      );
      return this.toDto(saved);
    });
  }
}
