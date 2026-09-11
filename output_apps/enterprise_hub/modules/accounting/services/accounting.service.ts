import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FindOptionsWhere, ILike } from 'typeorm';
import { BASE_CURRENCY } from '../../currency/constants/currency.constants';
import { Currency } from '../../currency/enums/currency.enum';
import { CurrencyService } from '../../currency/services/currency.service';
import { BALANCE_TOLERANCE, MONEY_SCALE } from '../constants/accounting.constants';
import { AccountLedgerResponseDto } from '../dto/account-ledger-response.dto';
import { AccountResponseDto } from '../dto/account-response.dto';
import { CreateAccountDto } from '../dto/create-account.dto';
import {
  CreateJournalEntryDto,
  JournalEntryLineDto,
} from '../dto/create-journal-entry.dto';
import {
  JournalEntryLineResponseDto,
  JournalEntryResponseDto,
  PaginatedJournalEntryResponseDto,
} from '../dto/journal-entry-response.dto';
import {
  QueryAccountLedgerDto,
  QueryJournalEntryDto,
} from '../dto/query-journal-entry.dto';
import {
  TrialBalanceResponseDto,
  TrialBalanceRowDto,
} from '../dto/trial-balance-response.dto';
import { ChartOfAccountEntity } from '../entities/chart-of-account.entity';
import { JournalEntryLineEntity } from '../entities/journal-entry-line.entity';
import { JournalEntryEntity } from '../entities/journal-entry.entity';
import { JournalEntryStatus } from '../enums/accounting.enum';
import {
  AccountingRepository,
  JournalLineInput,
} from '../repositories/accounting.repository';

/**
 * سرویس دفتر کل و حسابداری دوطرفه (Double-Entry General Ledger).
 *
 * تمام منطق کسب‌وکار اینجاست: اعتبارسنجی تراز سند، کنترل یکتایی شماره سند،
 * محاسبه تراز آزمایشی و گردش حساب. Controller فقط مسیریابی می‌کند و
 * Repository فقط پرسیستنس/کوئری انجام می‌دهد (Rule #3 — AGENTS.md).
 */
@Injectable()
export class AccountingService {
  constructor(
    private readonly accountingRepository: AccountingRepository,
    private readonly currencyService: CurrencyService,
  ) {}

  private round(value: number): number {
    const factor = 10 ** MONEY_SCALE;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  private toAccountDto(entity: ChartOfAccountEntity): AccountResponseDto {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      accountType: entity.accountType,
      currency: entity.currency as Currency,
      balance: this.round(Number(entity.balance)),
    };
  }

  private toLineDto(line: JournalEntryLineEntity): JournalEntryLineResponseDto {
    return {
      id: line.id,
      accountId: line.accountId,
      accountCode: line.account?.code ?? '',
      accountName: line.account?.name ?? '',
      currency: (line.account?.currency as Currency) ?? Currency.IRR,
      debit: this.round(Number(line.debit)),
      credit: this.round(Number(line.credit)),
      description: line.description,
    };
  }

  private toEntryDto(entity: JournalEntryEntity): JournalEntryResponseDto {
    const lines = (entity.lines ?? [])
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((line) => this.toLineDto(line));

    const totalDebit = this.round(
      lines.reduce((sum, line) => sum + line.debit, 0),
    );
    const totalCredit = this.round(
      lines.reduce((sum, line) => sum + line.credit, 0),
    );

    const entryCurrency =
      lines.length > 0 ? lines[0].currency : Currency.IRR;

    return {
      id: entity.id,
      entryNumber: entity.entryNumber,
      date: entity.date,
      description: entity.description,
      status: entity.status,
      currency: entryCurrency,
      totalDebit,
      totalCredit,
      baseCurrency: BASE_CURRENCY,
      baseTotalDebit: this.currencyService.convert(
        totalDebit,
        entryCurrency,
        BASE_CURRENCY,
      ),
      baseTotalCredit: this.currencyService.convert(
        totalCredit,
        entryCurrency,
        BASE_CURRENCY,
      ),
      lines,
    };
  }

  /**
   * اعتبارسنجی هر سطر: دقیقاً یکی از بدهکار/بستانکار باید بزرگ‌تر از صفر باشد.
   */
  private normalizeLine(line: JournalEntryLineDto): {
    accountCode: string;
    debit: number;
    credit: number;
    description: string | null;
  } {
    const debit = this.round(Number(line.debit ?? 0));
    const credit = this.round(Number(line.credit ?? 0));

    if (debit < 0 || credit < 0) {
      throw new BadRequestException('مبالغ بدهکار و بستانکار نمی‌توانند منفی باشند.');
    }

    const hasDebit = debit > 0;
    const hasCredit = credit > 0;
    if (hasDebit && hasCredit) {
      throw new BadRequestException(
        `سطر حساب ${line.accountCode} نمی‌تواند هم‌زمان بدهکار و بستانکار باشد.`,
      );
    }
    if (!hasDebit && !hasCredit) {
      throw new BadRequestException(
        `سطر حساب ${line.accountCode} باید یا بدهکار یا بستانکار بزرگ‌تر از صفر داشته باشد.`,
      );
    }

    return {
      accountCode: line.accountCode,
      debit: hasDebit ? debit : 0,
      credit: hasCredit ? credit : 0,
      description: line.description ?? null,
    };
  }

  async listAccounts(): Promise<AccountResponseDto[]> {
    const accounts = await this.accountingRepository.findAllAccounts();
    return accounts.map((account) => this.toAccountDto(account));
  }

  async createAccount(dto: CreateAccountDto): Promise<AccountResponseDto> {
    const existing = await this.accountingRepository.findAccountByCode(dto.code);
    if (existing) {
      throw new ConflictException(
        `حسابی با کد ${dto.code} قبلاً در دفتر کل ثبت شده است.`,
      );
    }

    const created = await this.accountingRepository.createAccount({
      code: dto.code,
      name: dto.name,
      accountType: dto.accountType,
      currency: dto.currency ?? Currency.IRR,
      balance: 0,
    });

    return this.toAccountDto(created);
  }

  /**
   * ثبت سند حسابداری دوطرفه.
   * شروط پذیرش: حداقل دو سطر، هر سطر یک‌طرفه، جمع بدهکار = جمع بستانکار،
   * شماره سند یکتا و تمام کدهای حساب موجود.
   */
  async createJournalEntry(
    dto: CreateJournalEntryDto,
  ): Promise<JournalEntryResponseDto> {
    const normalizedLines = dto.lines.map((line) => this.normalizeLine(line));

    const totalDebit = this.round(
      normalizedLines.reduce((sum, line) => sum + line.debit, 0),
    );
    const totalCredit = this.round(
      normalizedLines.reduce((sum, line) => sum + line.credit, 0),
    );

    if (Math.abs(totalDebit - totalCredit) >= BALANCE_TOLERANCE) {
      throw new BadRequestException(
        `سند تراز نیست: جمع بدهکار (${totalDebit}) با جمع بستانکار (${totalCredit}) برابر نمی‌باشد.`,
      );
    }

    if (totalDebit <= 0) {
      throw new BadRequestException('مبلغ سند باید بزرگ‌تر از صفر باشد.');
    }

    const existing = await this.accountingRepository.findEntryByNumber(
      dto.entryNumber,
    );
    if (existing) {
      throw new ConflictException(
        `سندی با شماره ${dto.entryNumber} قبلاً ثبت شده است.`,
      );
    }

    const uniqueCodes = Array.from(
      new Set(normalizedLines.map((line) => line.accountCode)),
    );
    const accounts =
      await this.accountingRepository.findAccountsByCodes(uniqueCodes);
    const accountByCode = new Map(accounts.map((account) => [account.code, account]));

    const missingCodes = uniqueCodes.filter((code) => !accountByCode.has(code));
    if (missingCodes.length > 0) {
      throw new BadRequestException(
        `کد(های) حساب یافت نشد: ${missingCodes.join(', ')}`,
      );
    }

    const entryCurrencies = new Set(
      uniqueCodes.map((code) => accountByCode.get(code)!.currency),
    );
    if (entryCurrencies.size > 1) {
      throw new BadRequestException(
        `تمام حساب‌های یک سند باید هم‌ارز باشند؛ ارزهای یافت‌شده: ${Array.from(
          entryCurrencies,
        ).join(', ')}`,
      );
    }

    const lineInputs: JournalLineInput[] = normalizedLines.map((line) => ({
      accountId: accountByCode.get(line.accountCode)!.id,
      debit: line.debit,
      credit: line.credit,
      description: line.description,
    }));

    const saved = await this.accountingRepository.persistJournalEntry(
      {
        entryNumber: dto.entryNumber,
        date: dto.date ? new Date(dto.date) : new Date(),
        description: dto.description,
        status: JournalEntryStatus.POSTED,
      },
      lineInputs,
    );

    return this.toEntryDto(saved);
  }

  async findAllJournalEntries(
    query: QueryJournalEntryDto,
  ): Promise<PaginatedJournalEntryResponseDto> {
    const { page, limit, status, entryNumber } = query;

    const where: FindOptionsWhere<JournalEntryEntity> = {};
    if (status) {
      where.status = status;
    }
    if (entryNumber) {
      where.entryNumber = ILike(`%${entryNumber}%`);
    }

    const [entities, total] =
      await this.accountingRepository.findAndCountEntries({
        where,
        order: { date: 'DESC', id: 'DESC' },
        relations: { lines: true },
        skip: (page - 1) * limit,
        take: limit,
      });

    return {
      data: entities.map((entity) => this.toEntryDto(entity)),
      total,
      page,
      limit,
    };
  }

  async findOneJournalEntry(id: number): Promise<JournalEntryResponseDto> {
    const entity = await this.accountingRepository.findEntryById(id);
    if (!entity) {
      throw new NotFoundException(`سند حسابداری با شناسه ${id} یافت نشد.`);
    }
    return this.toEntryDto(entity);
  }

  /**
   * تراز آزمایشی (Trial Balance): جمع بدهکار/بستانکار هر حساب مستقیماً از
   * سطرهای اسناد؛ حساب بدون گردش نیز با مانده صفر نمایش داده می‌شود.
   */
  async getTrialBalance(): Promise<TrialBalanceResponseDto> {
    const [accounts, rawRows] = await Promise.all([
      this.accountingRepository.findAllAccounts(),
      this.accountingRepository.getTrialBalance(),
    ]);

    const aggregate = new Map(
      rawRows.map((row) => [
        row.code,
        {
          totalDebit: this.round(Number(row.totalDebit)),
          totalCredit: this.round(Number(row.totalCredit)),
        },
      ]),
    );

    const rows: TrialBalanceRowDto[] = accounts.map((account) => {
      const totals = aggregate.get(account.code) ?? {
        totalDebit: 0,
        totalCredit: 0,
      };
      return {
        code: account.code,
        name: account.name,
        accountType: account.accountType,
        currency: account.currency as Currency,
        totalDebit: totals.totalDebit,
        totalCredit: totals.totalCredit,
        balance: this.round(totals.totalDebit - totals.totalCredit),
      };
    });

    const totalDebit = this.round(
      rows.reduce((sum, row) => sum + row.totalDebit, 0),
    );
    const totalCredit = this.round(
      rows.reduce((sum, row) => sum + row.totalCredit, 0),
    );

    // تجمیع بین‌المللی: تبدیل بدهکار/بستانکار هر حساب به ارز پایه (USD).
    const baseTotalDebit = this.currencyService.round(
      rows.reduce(
        (sum, row) =>
          sum +
          this.currencyService.convert(
            row.totalDebit,
            row.currency,
            BASE_CURRENCY,
          ),
        0,
      ),
      BASE_CURRENCY,
    );
    const baseTotalCredit = this.currencyService.round(
      rows.reduce(
        (sum, row) =>
          sum +
          this.currencyService.convert(
            row.totalCredit,
            row.currency,
            BASE_CURRENCY,
          ),
        0,
      ),
      BASE_CURRENCY,
    );

    return {
      rows,
      totalDebit,
      totalCredit,
      balanced: Math.abs(totalDebit - totalCredit) < BALANCE_TOLERANCE,
      baseCurrency: BASE_CURRENCY,
      baseTotalDebit,
      baseTotalCredit,
      baseBalanced:
        Math.abs(baseTotalDebit - baseTotalCredit) < BALANCE_TOLERANCE,
    };
  }

  /**
   * گردش حساب (Account Ledger) به همراه مانده افتتاح/اختتام و مانده تجمعی.
   */
  async getAccountLedger(
    code: string,
    query: QueryAccountLedgerDto,
  ): Promise<AccountLedgerResponseDto> {
    const account = await this.accountingRepository.findAccountByCode(code);
    if (!account) {
      throw new NotFoundException(`حساب با کد ${code} یافت نشد.`);
    }

    const rawRows = await this.accountingRepository.getAccountLedger(account.id);
    const fromDate = query.fromDate ? new Date(query.fromDate) : undefined;
    const toDate = query.toDate ? new Date(query.toDate) : undefined;

    let runningBalance = 0;
    const computed = rawRows.map((row) => {
      const debit = Number(row.debit);
      const credit = Number(row.credit);
      runningBalance = this.round(runningBalance + debit - credit);
      return {
        id: row.id,
        journalEntryId: row.journalEntryId,
        entryNumber: row.entryNumber,
        date: row.date,
        description: row.lineDescription ?? row.entryDescription,
        debit: this.round(debit),
        credit: this.round(credit),
        runningBalance,
      };
    });

    const inRange = computed.filter((row) => {
      const rowDate = new Date(row.date);
      if (fromDate && rowDate < fromDate) return false;
      if (toDate && rowDate > toDate) return false;
      return true;
    });

    const limited = inRange.slice(0, query.limit);

    const openingBeforeRange = computed
      .filter((row) => (fromDate ? new Date(row.date) < fromDate : false))
      .reduce((sum, row) => this.round(sum + row.debit - row.credit), 0);

    const openingBalance =
      limited.length > 0
        ? this.round(
            limited[0].runningBalance - (limited[0].debit - limited[0].credit),
          )
        : openingBeforeRange;

    const closingBalance =
      limited.length > 0
        ? limited[limited.length - 1].runningBalance
        : openingBeforeRange;

    return {
      account: this.toAccountDto(account),
      openingBalance,
      totalDebit: this.round(
        limited.reduce((sum, row) => sum + row.debit, 0),
      ),
      totalCredit: this.round(
        limited.reduce((sum, row) => sum + row.credit, 0),
      ),
      closingBalance,
      baseCurrency: BASE_CURRENCY,
      baseClosingBalance: this.currencyService.convert(
        closingBalance,
        account.currency as Currency,
        BASE_CURRENCY,
      ),
      entries: limited,
    };
  }
}