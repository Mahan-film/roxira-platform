import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, FindOptionsWhere, ILike } from 'typeorm';
import {
  fromDb,
  fromMinor,
  minorToDecimal,
  Money,
  MoneyFormatError,
  parseScaled,
  scaledToDecimal,
  toMinor,
} from '../money';
import { BASE_CURRENCY } from '../../currency/constants/currency.constants';
import { Currency } from '../../currency/enums/currency.enum';
import {
  NormalisedCurrency,
  normalizeCurrency,
} from '../../currency/normaliser/currency-normaliser';
import { CurrencyService } from '../../currency/services/currency.service';
import {
  DEFAULT_CHART_OF_ACCOUNTS,
  FX_SCALE,
} from '../constants/accounting.constants';
import {
  DuplicateEntryNumberError,
  LockedPeriodError,
  PeriodLockedException,
  UnknownDimensionError,
} from '../exceptions/ledger.exceptions';
import {
  LockPeriodDto,
  PeriodLockResponseDto,
  UnlockPeriodDto,
} from '../dto/period-lock.dto';
import { PeriodLockEntity } from '../entities/period-lock.entity';
import { AccountLedgerResponseDto } from '../dto/account-ledger-response.dto';
import { AccountResponseDto } from '../dto/account-response.dto';
import { CreateAccountDto } from '../dto/create-account.dto';
import {
  CreateJournalEntryDto,
  JournalEntryLineDto,
} from '../dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from '../dto/voucher-state.dto';
import {
  JournalEntryLineResponseDto,
  JournalEntryResponseDto,
  PaginatedJournalEntryResponseDto,
} from '../dto/journal-entry-response.dto';
import {
  QueryAccountLedgerDto,
  QueryJournalEntryDto,
  QueryTrialBalanceDto,
} from '../dto/query-journal-entry.dto';
import {
  TrialBalanceResponseDto,
  TrialBalanceRowDto,
} from '../dto/trial-balance-response.dto';
import { ChartOfAccountEntity } from '../entities/chart-of-account.entity';
import { JournalEntryLineEntity } from '../entities/journal-entry-line.entity';
import { JournalEntryEntity } from '../entities/journal-entry.entity';
import {
  AccountLevel,
  AccountType,
  JournalEntryStatus,
  JournalEntryType,
} from '../enums/accounting.enum';
import {
  AccountingRepository,
  JournalLineInput,
} from '../repositories/accounting.repository';

/** ورودی ایجاد حساب از مسیر ورود داده. */
export interface AccountingImportAccountInput {
  code: string;
  name: string;
  accountType: AccountType;
  /** ISO code or IRT / MULTI from the currency normaliser (up to 8 chars). */
  currency?: string;
}

/** ورودی سطر افتتاحیه از مسیر ورود داده. */
export interface AccountingOpeningBalanceInput {
  accountCode: string;
  debit?: number;
  credit?: number;
  description?: string;
  date?: string;
}

/** سطر دفتر یک حساب برای ماژول‌های مصرف‌کننده (تطبیق بانکی). */
export interface LedgerLineView {
  id: number;
  journalEntryId: number;
  entryNumber: string;
  date: Date;
  description: string | null;
  entryDescription: string;
  debit: number;
  credit: number;
}

/** سطر سند پس از عادی‌سازی و اعتبارسنجی در لایه سرویس. */
interface NormalisedJournalLine {
  accountCode: string;
  /** Exact integer minor units. */
  debitMinor: bigint;
  creditMinor: bigint;
  description: string | null;
  currency: NormalisedCurrency;
  /** Exact decimal strings (6 decimals) or null. */
  amountFx: string | null;
  fxRate: string | null;
  partyCode: string | null;
  detailCode: string | null;
  costCenterCode: string | null;
  projectCode: string | null;
}

/** Minor units as a JS number for consumers that need one (base-currency conversion, banking). */
const asNumber = (minor: bigint): number => Number(minorToDecimal(minor));

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

  private toAccountDto(entity: ChartOfAccountEntity): AccountResponseDto {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      accountType: entity.accountType,
      currency: entity.currency as Currency,
      balance: fromMinor(fromDb(entity.balance)),
      level: entity.level ?? null,
      parentCode: entity.parentCode ?? null,
      reportLine: entity.reportLine ?? null,
    };
  }

  private toLineDto(line: JournalEntryLineEntity): JournalEntryLineResponseDto {
    return {
      id: line.id,
      accountId: line.accountId,
      accountCode: line.account?.code ?? '',
      accountName: line.account?.name ?? '',
      currency:
        line.currency ?? (line.account?.currency as string) ?? Currency.IRR,
      debit: fromMinor(fromDb(line.debit)),
      credit: fromMinor(fromDb(line.credit)),
      amountFx: line.amountFx != null ? Number(line.amountFx) : null,
      fxRate: line.fxRate != null ? Number(line.fxRate) : null,
      partyCode: line.partyCode ?? null,
      description: line.description,
    };
  }

  /**
   * تبدیل مبلغ ریالی سند به ارز پایه با تحمل ارزهای خارج از دامنه CurrencyService.
   * ارزهای ناشناخته/غیرقابل‌تبدیل صفر برمی‌گردانند تا ثبت سند مسدود نشود.
   */
  private toBaseCurrency(amount: number, currency: string): number {
    try {
      return this.currencyService.convert(
        amount,
        currency as Currency,
        BASE_CURRENCY,
      );
    } catch {
      return 0;
    }
  }

  private toEntryDto(entity: JournalEntryEntity): JournalEntryResponseDto {
    const sortedLines = (entity.lines ?? []).slice().sort((a, b) => a.id - b.id);
    const lines = sortedLines.map((line) => this.toLineDto(line));

    const debitMinor = sortedLines.reduce((sum, l) => sum + fromDb(l.debit), 0n);
    const creditMinor = sortedLines.reduce((sum, l) => sum + fromDb(l.credit), 0n);

    const entryCurrency =
      lines.length > 0 ? lines[0].currency : Currency.IRR;

    return {
      id: entity.id,
      entryNumber: entity.entryNumber,
      date: entity.date,
      description: entity.description,
      status: entity.status,
      currency: entryCurrency,
      totalDebit: fromMinor(debitMinor),
      totalCredit: fromMinor(creditMinor),
      baseCurrency: BASE_CURRENCY,
      baseTotalDebit: this.toBaseCurrency(asNumber(debitMinor), entryCurrency),
      baseTotalCredit: this.toBaseCurrency(asNumber(creditMinor), entryCurrency),
      lines,
    };
  }

  /**
   * اعتبارسنجی هر سطر: دقیقاً یکی از بدهکار/بستانکار باید بزرگ‌تر از صفر باشد،
   * ارز سطر باید متعارف باشد و در صورت ارائه هم‌زمان `amount_fx` و `fx_rate`،
   * معادل ریالی آن‌ها با مبلغ سطر تطبیق کند.
   */
  private normalizeLine(line: JournalEntryLineDto): NormalisedJournalLine {
    const amount = (value: Money | undefined): bigint => {
      try {
        return value == null ? 0n : toMinor(value);
      } catch (error) {
        if (error instanceof MoneyFormatError) {
          throw new BadRequestException(
            `مبلغ سطر حساب ${line.accountCode} نامعتبر است: ${error.message}`,
          );
        }
        throw error;
      }
    };
    const debitMinor = amount(line.debit);
    const creditMinor = amount(line.credit);

    if (debitMinor < 0n || creditMinor < 0n) {
      throw new BadRequestException('مبالغ بدهکار و بستانکار نمی‌توانند منفی باشند.');
    }

    const hasDebit = debitMinor > 0n;
    const hasCredit = creditMinor > 0n;
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

    const currency = line.currency
      ? normalizeCurrency(line.currency)
      : NormalisedCurrency.IRR;
    if (!currency) {
      throw new BadRequestException(
        `ارز سطر حساب ${line.accountCode} نامعتبر است: ${line.currency}`,
      );
    }
    if (currency === NormalisedCurrency.MULTI) {
      throw new BadRequestException(
        'ارز MULTI تنها در سطح حساب مجاز است و در سطرهای سند پذیرفته نمی‌شود.',
      );
    }

    const scaled = (value: Money | undefined, label: string): bigint | null => {
      if (value == null) {
        return null;
      }
      try {
        return parseScaled(value, FX_SCALE);
      } catch {
        throw new BadRequestException(
          `${label} سطر حساب ${line.accountCode} نامعتبر است.`,
        );
      }
    };
    const amountFx = scaled(line.amountFx, 'مبلغ ارزی');
    const fxRate = scaled(line.fxRate, 'نرخ تبدیل');

    if (amountFx != null && fxRate != null) {
      // Exact rule, no tolerance: amount_fx x fx_rate rounded half-up to the cent must equal the
      // rial amount of the line. (scale 6 x scale 6 = scale 12; cents are scale 2.)
      const product = amountFx * fxRate;
      const divisor = 10n ** BigInt(2 * FX_SCALE - 2);
      const fxAmountMinor = (product + divisor / 2n) / divisor;
      const rialMinor = debitMinor + creditMinor;
      if (fxAmountMinor !== rialMinor) {
        throw new BadRequestException(
          `مبلغ ارزی سطر حساب ${line.accountCode} با معادل ریالی آن نمی‌خواند: ` +
            `amount_fx × fx_rate = ${minorToDecimal(fxAmountMinor)} در برابر ${minorToDecimal(rialMinor)} ریال.`,
        );
      }
    }

    return {
      accountCode: line.accountCode,
      debitMinor: hasDebit ? debitMinor : 0n,
      creditMinor: hasCredit ? creditMinor : 0n,
      description: line.description ?? null,
      currency,
      amountFx: amountFx != null ? scaledToDecimal(amountFx, FX_SCALE) : null,
      fxRate: fxRate != null ? scaledToDecimal(fxRate, FX_SCALE) : null,
      partyCode: line.partyCode?.trim() || null,
      detailCode: line.detailCode?.trim() || null,
      costCenterCode: line.costCenterCode?.trim() || null,
      projectCode: line.projectCode?.trim() || null,
    };
  }

  /**
   * بذرگذاری تنبل دفتر کل پیش‌فرض برای یک مستأجر در نخستین استفاده.
   *
   * جایگزین بذرگذاری سراسری قبلی در Migration شده است تا هر سازمان دفتر کل
   * مستقل خود را داشته باشد؛ هیچ ردیفی برای سازمان دیگر ساخته نمی‌شود.
   */
  private async ensureDefaultAccounts(
    tenantId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const count = await this.accountingRepository.countAccounts(tenantId, manager);
    if (count > 0) {
      return;
    }
    await this.accountingRepository.insertMissingAccounts(
      tenantId,
      DEFAULT_CHART_OF_ACCOUNTS.map((account) => ({
        code: account.code,
        name: account.name,
        accountType: account.accountType,
        currency: Currency.IRR,
        balance: '0',
      })),
      manager,
    );
  }

  async listAccounts(tenantId: string): Promise<AccountResponseDto[]> {
    await this.ensureDefaultAccounts(tenantId);
    const accounts = await this.accountingRepository.findAllAccounts(tenantId);
    return accounts.map((account) => this.toAccountDto(account));
  }

  async createAccount(
    tenantId: string,
    dto: CreateAccountDto,
  ): Promise<AccountResponseDto> {
    await this.ensureDefaultAccounts(tenantId);
    const existing = await this.accountingRepository.findAccountByCode(
      tenantId,
      dto.code,
    );
    if (existing) {
      throw new ConflictException(
        `حسابی با کد ${dto.code} قبلاً در دفتر کل ثبت شده است.`,
      );
    }
    if (dto.parentCode) {
      const parent = await this.accountingRepository.findAccountByCode(tenantId, dto.parentCode);
      if (!parent) {
        throw new BadRequestException(`حساب بالادست ${dto.parentCode} یافت نشد.`);
      }
    }

    const created = await this.accountingRepository.createAccount(tenantId, {
      code: dto.code,
      name: dto.name,
      accountType: dto.accountType,
      currency: dto.currency ?? Currency.IRR,
      balance: '0',
      level: dto.level ?? null,
      parentCode: dto.parentCode?.trim() || null,
      reportLine: dto.reportLine ?? null,
    });

    return this.toAccountDto(created);
  }

  /**
   * درج حساب‌ها از مسیر ورود داده (بدون بذرگذاری دفتر کل پیش‌فرض).
   *
   * برخلاف `createAccount`، این متد دفتر پیش‌فرض را بذر نمی‌کند تا ورود یک
   * «دفتر کل» کامل جایگزین/تکمیل‌کننده، با کدهای موجود تعارض پیدا نکند.
   * تشخیص تکراری کد حساب پیش‌تر در لایه ورود داده انجام شده است.
   */
  async importAccounts(
    tenantId: string,
    inputs: AccountingImportAccountInput[],
  ): Promise<number[]> {
    const createdIds: number[] = [];
    for (const input of inputs) {
      const existing = await this.accountingRepository.findAccountByCode(
        tenantId,
        input.code,
      );
      if (existing) {
        throw new ConflictException(
          `حسابی با کد ${input.code} قبلاً در دفتر کل ثبت شده است.`,
        );
      }
      const created = await this.accountingRepository.createAccount(tenantId, {
        code: input.code,
        name: input.name,
        accountType: input.accountType,
        currency: input.currency ?? Currency.IRR,
        balance: '0',
      });
      createdIds.push(created.id);
    }
    return createdIds;
  }

  /** کدهای حساب موجودِ مستأجر در میان فهرست داده‌شده (تشخیص تکراری ورود). */
  async findExistingAccountCodes(
    tenantId: string,
    codes: string[],
  ): Promise<string[]> {
    const accounts = await this.accountingRepository.findAccountsByCodes(
      tenantId,
      codes,
    );
    return accounts.map((account) => account.code);
  }

  /**
   * حذف حساب‌های یک دسته ورود داده.
   * حسابی که سطر سند دارد «ارجاع‌شده» است و حذف نمی‌شود.
   */
  async removeImportedAccounts(
    tenantId: string,
    ids: number[],
  ): Promise<{ removed: number; refused: number[] }> {
    if (ids.length === 0) {
      return { removed: 0, refused: [] };
    }
    const referenced = new Set(
      await this.accountingRepository.findReferencedAccountIds(tenantId, ids),
    );
    const deletable = ids.filter((id) => !referenced.has(id));
    const removed = await this.accountingRepository.deleteAccountsByIds(
      tenantId,
      deletable,
    );
    return { removed, refused: Array.from(referenced) };
  }

  /**
   * ثبت مانده‌های افتتاحیه به‌صورت یک سند دوطرفه واحد.
   *
   * تمام سطرهای ورودی در یک سند قرار می‌گیرند؛ شرط تراز بودن سند توسط
   * `createJournalEntry` اعمال می‌شود. خروجی شناسه سند ایجادشده است.
   */
  async importOpeningBalances(
    tenantId: string,
    inputs: AccountingOpeningBalanceInput[],
  ): Promise<number> {
    if (inputs.length === 0) {
      throw new BadRequestException('هیچ سطر افتتاحیه‌ای برای ثبت وجود ندارد.');
    }

    const date =
      inputs.find((input) => input.date)?.date ?? new Date().toISOString();
    const entryNumber = `OB-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const lines: JournalEntryLineDto[] = inputs.map((input) => ({
      accountCode: input.accountCode,
      debit: input.debit ?? 0,
      credit: input.credit ?? 0,
      description: input.description,
    }));

    const entry = await this.createJournalEntry(tenantId, {
      entryNumber,
      date,
      description: 'مانده‌های افتتاحیه (ورود داده)',
      lines,
    });
    return entry.id;
  }

  /**
   * Undo of an import batch: a posted entry is never deleted. Each entry that is not yet reversed
   * gets a reversing entry (dated like the original, so the original period is restored), all in
   * one transaction. If any of them lies in a locked period nothing is posted and the whole undo
   * is refused (423) with the entry numbers and the way out (unlock the period first).
   * Entries that already have a reversal count as removed, so retrying an undo is idempotent.
   */
  async removeImportedJournalEntries(
    tenantId: string,
    ids: number[],
  ): Promise<{ removed: number; refused: number[] }> {
    const unique = Array.from(new Set(ids));
    return this.accountingRepository.transaction(async (manager) => {
      const entries = await this.accountingRepository.findEntriesByIds(
        tenantId,
        unique,
        manager,
      );
      const pending: JournalEntryEntity[] = [];
      let alreadyReversed = 0;
      for (const entry of entries) {
        if (entry.reversesEntryId != null) {
          continue; // a reversal is not itself an imported entry
        }
        const reversal = await this.accountingRepository.findReversalOf(
          tenantId,
          entry.id,
          manager,
        );
        if (reversal) {
          alreadyReversed += 1;
        } else {
          pending.push(entry);
        }
      }

      const locked: string[] = [];
      for (const entry of pending) {
        const lock = await this.accountingRepository.findActiveLockCovering(
          tenantId,
          new Date(entry.date),
          manager,
        );
        if (lock) {
          locked.push(
            `${entry.entryNumber} (${new Date(entry.date).toISOString().slice(0, 10)}, locked ${lock.periodStart}..${lock.periodEnd})`,
          );
        }
      }
      if (locked.length > 0) {
        throw new PeriodLockedException(
          `Import rollback refused: ${locked.length} entr${locked.length === 1 ? 'y is' : 'ies are'} in a locked period and nothing was changed: ` +
            `${locked.slice(0, 10).join(', ')}${locked.length > 10 ? ', ...' : ''}. ` +
            'Unlock the period (POST period-locks/:id/unlock) and retry, or leave the entries in place.',
        );
      }

      for (const entry of pending) {
        await this.reverseWithin(
          tenantId,
          entry.id,
          {
            date: new Date(entry.date).toISOString(),
            reason: 'import rollback',
          },
          manager,
        );
      }
      return { removed: pending.length + alreadyReversed, refused: [] };
    });
  }

  /**
   * ثبت سند حسابداری دوطرفه.
   * شروط پذیرش: حداقل دو سطر، هر سطر یک‌طرفه، جمع بدهکار = جمع بستانکار (دقیق، بدون
   * تحمل)، شماره سند یکتا، تمام کدهای حساب موجود و تاریخ خارج از دوره قفل‌شده.
   *
   * With `manager` the call joins the caller's transaction: every read and write uses it and a
   * duplicate number is reported without aborting that transaction.
   */
  async createJournalEntry(
    tenantId: string,
    dto: CreateJournalEntryDto,
    manager?: EntityManager,
  ): Promise<JournalEntryResponseDto> {
    return this.postEntry(tenantId, dto, {}, manager);
  }

  /** Posts an entry of a fiscal close or an opening; only the close service calls this. */
  async postTypedEntry(
    tenantId: string,
    dto: CreateJournalEntryDto,
    entryType: JournalEntryType,
    manager: EntityManager,
  ): Promise<JournalEntryResponseDto> {
    return this.postEntry(tenantId, dto, { entryType }, manager);
  }

  /** Exact check in integer minor units: debit equals credit and the total is above zero. */
  private assertBalanced(lines: NormalisedJournalLine[]): void {
    const debitMinor = lines.reduce((sum, l) => sum + l.debitMinor, 0n);
    const creditMinor = lines.reduce((sum, l) => sum + l.creditMinor, 0n);

    if (debitMinor !== creditMinor) {
      throw new BadRequestException(
        `سند تراز نیست: جمع بدهکار (${minorToDecimal(debitMinor)}) با جمع بستانکار (${minorToDecimal(creditMinor)}) برابر نیست.`,
      );
    }

    if (debitMinor <= 0n) {
      throw new BadRequestException('مبلغ سند باید بزرگ‌تر از صفر باشد.');
    }
  }

  /** Looks the account codes up and refuses unknown codes and header (group or kol) accounts. */
  private async resolveLineInputs(
    tenantId: string,
    normalizedLines: NormalisedJournalLine[],
    manager?: EntityManager,
  ): Promise<JournalLineInput[]> {
    const uniqueCodes = Array.from(
      new Set(normalizedLines.map((line) => line.accountCode)),
    );
    const accounts = await this.accountingRepository.findAccountsByCodes(
      tenantId,
      uniqueCodes,
      manager,
    );
    const accountByCode = new Map(accounts.map((account) => [account.code, account]));

    const missingCodes = uniqueCodes.filter((code) => !accountByCode.has(code));
    if (missingCodes.length > 0) {
      throw new BadRequestException(
        `کد(های) حساب یافت نشد: ${missingCodes.join(', ')}`,
      );
    }

    const headers = accounts.filter(
      (account) =>
        account.level === AccountLevel.GROUP || account.level === AccountLevel.KOL,
    );
    if (headers.length > 0) {
      throw new BadRequestException(
        `سند روی حساب گروه یا کل ثبت نمی‌شود؛ حساب معین یا تفصیلی انتخاب کنید: ${headers.map((a) => a.code).join(', ')}`,
      );
    }

    return normalizedLines.map((line) => ({
      accountId: accountByCode.get(line.accountCode)!.id,
      debitMinor: line.debitMinor,
      creditMinor: line.creditMinor,
      description: line.description,
      currency: line.currency,
      amountFx: line.amountFx,
      fxRate: line.fxRate,
      partyCode: line.partyCode,
      detailCode: line.detailCode,
      costCenterCode: line.costCenterCode,
      projectCode: line.projectCode,
    }));
  }

  private async postEntry(
    tenantId: string,
    dto: CreateJournalEntryDto,
    options: { reversesEntryId?: number; entryType?: JournalEntryType },
    manager?: EntityManager,
  ): Promise<JournalEntryResponseDto> {
    await this.ensureDefaultAccounts(tenantId, manager);

    const status = dto.status ?? JournalEntryStatus.POSTED;
    const normalizedLines = dto.lines.map((line) => this.normalizeLine(line));

    // A draft may be unbalanced while it is typed; every other state must balance to the cent.
    if (status !== JournalEntryStatus.DRAFT) {
      this.assertBalanced(normalizedLines);
    }

    const existing = await this.accountingRepository.findEntryByNumber(
      tenantId,
      dto.entryNumber,
      manager,
    );
    if (existing) {
      throw new ConflictException(
        `سندی با شماره ${dto.entryNumber} قبلاً ثبت شده است.`,
      );
    }

    const lineInputs = await this.resolveLineInputs(tenantId, normalizedLines, manager);

    let saved: JournalEntryEntity;
    try {
      saved = await this.accountingRepository.persistJournalEntry(
        tenantId,
        {
          entryNumber: dto.entryNumber,
          date: dto.date ? new Date(dto.date) : new Date(),
          description: dto.description,
          status,
          reversesEntryId: options.reversesEntryId ?? null,
          entryType: options.entryType,
        },
        lineInputs,
        manager,
      );
    } catch (error) {
      if (error instanceof LockedPeriodError) {
        throw new PeriodLockedException(
          `Posting refused: ${error.date} is inside a locked accounting period.`,
        );
      }
      if (error instanceof UnknownDimensionError) {
        this.mapPeriodLock(error);
      }
      // A concurrent writer won the (tenant, number) unique index; reported, not thrown by PG.
      if (error instanceof DuplicateEntryNumberError) {
        throw new ConflictException(
          `سندی با شماره ${dto.entryNumber} قبلاً ثبت شده است.`,
        );
      }
      throw error;
    }

    return this.toEntryDto(saved);
  }

  private mapPeriodLock(error: unknown): never {
    if (error instanceof UnknownDimensionError) {
      throw new BadRequestException(`تفصیلی یا مرکز ${error.code} (${error.kind}) تعریف نشده یا غیرفعال است.`);
    }
    if (error instanceof LockedPeriodError) {
      throw new PeriodLockedException(
        `Posting refused: ${error.date} is inside a locked accounting period.`,
      );
    }
    throw error;
  }

  /** Loads and row-locks a voucher that is still editable; a final one is refused with 409. */
  private async lockEditableVoucher(
    tenantId: string,
    id: number,
    manager: EntityManager,
  ): Promise<JournalEntryEntity> {
    const entry = await this.accountingRepository.lockEntry(tenantId, id, manager);
    if (!entry) {
      throw new NotFoundException(`سند حسابداری با شناسه ${id} یافت نشد.`);
    }
    if (entry.status === JournalEntryStatus.POSTED || entry.status === JournalEntryStatus.VOID) {
      throw new ConflictException(
        'سند قطعی قابل ویرایش یا حذف نیست؛ برای اصلاح، سند برگشتی ثبت کنید.',
      );
    }
    return entry;
  }

  /** Replaces the header and lines of a DRAFT or TEMPORARY voucher. */
  async updateVoucher(
    tenantId: string,
    id: number,
    dto: UpdateJournalEntryDto,
  ): Promise<JournalEntryResponseDto> {
    await this.ensureDefaultAccounts(tenantId);
    return this.accountingRepository.transaction(async (manager) => {
      const entry = await this.lockEditableVoucher(tenantId, id, manager);
      const normalizedLines = dto.lines.map((line) => this.normalizeLine(line));
      if (entry.status === JournalEntryStatus.TEMPORARY) {
        this.assertBalanced(normalizedLines);
      }
      if (dto.entryNumber !== entry.entryNumber) {
        const clash = await this.accountingRepository.findEntryByNumber(
          tenantId,
          dto.entryNumber,
          manager,
        );
        if (clash) {
          throw new ConflictException(`سندی با شماره ${dto.entryNumber} قبلاً ثبت شده است.`);
        }
      }
      const date = dto.date ? new Date(dto.date) : entry.date;
      try {
        await this.accountingRepository.assertDateOpen(tenantId, date, manager);
      } catch (error) {
        this.mapPeriodLock(error);
      }
      const lineInputs = await this.resolveLineInputs(tenantId, normalizedLines, manager);
      try {
        await this.accountingRepository.replaceEntryContent(
          tenantId,
          id,
          { entryNumber: dto.entryNumber, date, description: dto.description },
          lineInputs,
          manager,
        );
      } catch (error) {
        this.mapPeriodLock(error);
      }
      const saved = await this.accountingRepository.findEntryById(tenantId, id, manager);
      return this.toEntryDto(saved as JournalEntryEntity);
    });
  }

  /**
   * DRAFT to TEMPORARY or POSTED, TEMPORARY to DRAFT or POSTED. POSTED is final. Leaving DRAFT
   * needs a balanced voucher of two or more lines dated in an open period.
   */
  async changeVoucherStatus(
    tenantId: string,
    id: number,
    target: JournalEntryStatus,
  ): Promise<JournalEntryResponseDto> {
    return this.accountingRepository.transaction(async (manager) => {
      const entry = await this.lockEditableVoucher(tenantId, id, manager);
      if (entry.status === target) {
        throw new ConflictException('سند از قبل در همین وضعیت است.');
      }
      const full = (await this.accountingRepository.findEntryById(tenantId, id, manager)) as JournalEntryEntity;
      const lineInputs: JournalLineInput[] = full.lines.map((line) => ({
        accountId: line.accountId,
        debitMinor: fromDb(line.debit),
        creditMinor: fromDb(line.credit),
      }));
      if (target !== JournalEntryStatus.DRAFT) {
        if (lineInputs.length < 2) {
          throw new BadRequestException('سند باید حداقل دو سطر داشته باشد.');
        }
        const debit = lineInputs.reduce((sum, l) => sum + l.debitMinor, 0n);
        const credit = lineInputs.reduce((sum, l) => sum + l.creditMinor, 0n);
        if (debit !== credit || debit <= 0n) {
          throw new BadRequestException(
            `سند تراز نیست: جمع بدهکار (${minorToDecimal(debit)}) با جمع بستانکار (${minorToDecimal(credit)}) برابر نیست.`,
          );
        }
      }
      if (target === JournalEntryStatus.POSTED) {
        try {
          await this.accountingRepository.assertDateOpen(tenantId, entry.date, manager);
        } catch (error) {
          this.mapPeriodLock(error);
        }
      }
      await this.accountingRepository.setEntryStatus(tenantId, entry, target, lineInputs, manager);
      const saved = await this.accountingRepository.findEntryById(tenantId, id, manager);
      return this.toEntryDto(saved as JournalEntryEntity);
    });
  }

  /** Deletes a DRAFT or TEMPORARY voucher. A final voucher is only ever reversed. */
  async deleteVoucher(tenantId: string, id: number): Promise<void> {
    await this.accountingRepository.transaction(async (manager) => {
      await this.lockEditableVoucher(tenantId, id, manager);
      await this.accountingRepository.deleteEntry(tenantId, id, manager);
    });
  }

  /**
   * Reverse a posted entry. Posted entries are never edited or deleted: the correction is a new
   * entry with debit and credit swapped, linked through `reverses_entry_id`.
   *  - a reversal cannot be reversed (400);
   *  - an entry is reversed at most once (409, enforced by a unique index);
   *  - the number is `<number>-REV` when it fits the 64-char column, otherwise `REV-<id>`.
   */
  async reverseJournalEntry(
    tenantId: string,
    id: number,
    options: { date?: string; reason?: string } = {},
  ): Promise<JournalEntryResponseDto> {
    return this.accountingRepository.transaction(async (manager) => {
      const entry = await this.accountingRepository.findEntryById(tenantId, id, manager);
      if (
        entry &&
        (entry.entryType === JournalEntryType.CLOSING_TEMP ||
          entry.entryType === JournalEntryType.CLOSING_PERM ||
          entry.entryType === JournalEntryType.OPENING_AUTO)
      ) {
        throw new BadRequestException(
          'سند بستن سال مالی جداگانه برگشت نمی‌خورد؛ سال مالی را بازگشایی کنید.',
        );
      }
      return this.reverseWithin(tenantId, id, options, manager);
    });
  }

  /** Reverses an entry of a fiscal close; only the reopen flow calls this. */
  reverseTypedEntry(
    tenantId: string,
    id: number,
    options: { date: string; reason: string },
    manager: EntityManager,
  ): Promise<JournalEntryResponseDto> {
    return this.reverseWithin(tenantId, id, options, manager);
  }

  private async reverseWithin(
    tenantId: string,
    id: number,
    options: { date?: string; reason?: string },
    manager: EntityManager,
  ): Promise<JournalEntryResponseDto> {
    const original = await this.accountingRepository.findEntryById(
      tenantId,
      id,
      manager,
    );
    if (!original) {
      throw new NotFoundException(`سند حسابداری با شناسه ${id} یافت نشد.`);
    }
    if (original.status !== JournalEntryStatus.POSTED) {
      throw new BadRequestException('فقط سند ثبت‌شده قابل برگشت است.');
    }
    if (original.reversesEntryId != null) {
      throw new BadRequestException(
        'سند برگشتی قابل برگشت دوباره نیست؛ در صورت نیاز سند اصلاحی جدید ثبت کنید.',
      );
    }
    const already = await this.accountingRepository.findReversalOf(
      tenantId,
      original.id,
      manager,
    );
    if (already) {
      throw new ConflictException(
        `سند ${original.entryNumber} قبلاً با سند ${already.entryNumber} برگشت خورده است.`,
      );
    }

    const lines: JournalEntryLineDto[] = (original.lines ?? [])
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((line) => ({
        accountCode: line.account.code,
        debit: minorToDecimal(fromDb(line.credit)),
        credit: minorToDecimal(fromDb(line.debit)),
        description: line.description ?? undefined,
        currency: line.currency,
        amountFx: line.amountFx != null ? line.amountFx : undefined,
        fxRate: line.fxRate != null ? line.fxRate : undefined,
        partyCode: line.partyCode ?? undefined,
      }));
    const reason = options.reason?.trim();
    const entryNumber = await this.reversalNumber(tenantId, original, manager);
    try {
      return await this.postEntry(
        tenantId,
        {
          entryNumber,
          date: options.date,
          description:
            `برگشت سند ${original.entryNumber}` + (reason ? `: ${reason}` : ''),
          lines,
        } as CreateJournalEntryDto,
        { reversesEntryId: original.id, entryType: original.entryType },
        manager,
      );
    } catch (error) {
      if (error instanceof ConflictException) {
        // Lost a race with another reversal of the same entry? Report that, not the number.
        const raced = await this.accountingRepository.findReversalOf(
          tenantId,
          original.id,
          manager,
        );
        if (raced) {
          throw new ConflictException(
            `سند ${original.entryNumber} قبلاً با سند ${raced.entryNumber} برگشت خورده است.`,
          );
        }
      }
      throw error;
    }
  }

  /** `<number>-REV` if it fits (<= 64 chars) and is free, else `REV-<id>` (then a unique suffix). */
  private async reversalNumber(
    tenantId: string,
    original: JournalEntryEntity,
    manager: EntityManager,
  ): Promise<string> {
    const candidates = [
      `${original.entryNumber}-REV`,
      `REV-${original.id}`,
      `REV-${original.id}-${Date.now().toString(36)}`,
    ];
    for (const candidate of candidates) {
      if (candidate.length > 64) {
        continue;
      }
      const taken = await this.accountingRepository.findEntryByNumber(
        tenantId,
        candidate,
        manager,
      );
      if (!taken) {
        return candidate;
      }
    }
    throw new ConflictException(
      `شماره سند برگشتی برای ${original.entryNumber} قابل تولید نیست.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Period locks
  // ---------------------------------------------------------------------------

  private toLockDto(entity: PeriodLockEntity): PeriodLockResponseDto {
    return {
      id: entity.id,
      periodStart: entity.periodStart,
      periodEnd: entity.periodEnd,
      reason: entity.reason,
      lockedBy: entity.lockedBy,
      lockedAt: entity.lockedAt,
      active: entity.unlockedAt == null,
      unlockedAt: entity.unlockedAt,
      unlockedBy: entity.unlockedBy,
      unlockReason: entity.unlockReason,
    };
  }

  /** Locks an inclusive date range: nothing can be posted or reversed into it until unlocked. */
  async lockPeriod(
    tenantId: string,
    actor: string,
    dto: LockPeriodDto,
  ): Promise<PeriodLockResponseDto> {
    const valid = (day: string): boolean =>
      new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day;
    if (!valid(dto.periodStart) || !valid(dto.periodEnd)) {
      throw new BadRequestException('periodStart/periodEnd must be real calendar days.');
    }
    if (dto.periodStart > dto.periodEnd) {
      throw new BadRequestException('periodStart must not be after periodEnd.');
    }
    const created = await this.accountingRepository.createPeriodLock(tenantId, {
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
      reason: dto.reason?.trim() || null,
      lockedBy: actor,
    });
    return this.toLockDto(created);
  }

  /** Unlocks (the row stays as audit trail); a reason is mandatory. */
  async unlockPeriod(
    tenantId: string,
    actor: string,
    id: number,
    dto: UnlockPeriodDto,
  ): Promise<PeriodLockResponseDto> {
    const existing = await this.accountingRepository.findPeriodLock(tenantId, id);
    if (!existing) {
      throw new NotFoundException(`قفل دوره با شناسه ${id} یافت نشد.`);
    }
    if (existing.unlockedAt != null) {
      throw new ConflictException('این دوره قبلاً باز شده است.');
    }
    const updated = await this.accountingRepository.unlockPeriod(tenantId, id, {
      unlockedBy: actor,
      unlockReason: dto.reason.trim(),
    });
    if (!updated) {
      throw new ConflictException('این دوره قبلاً باز شده است.');
    }
    return this.toLockDto(updated);
  }

  async listPeriodLocks(tenantId: string): Promise<PeriodLockResponseDto[]> {
    const locks = await this.accountingRepository.listPeriodLocks(tenantId);
    return locks.map((lock) => this.toLockDto(lock));
  }

  /** True when `date` falls inside an active period lock of the tenant (read-only pre-check). */
  async isPeriodLocked(tenantId: string, date: Date): Promise<boolean> {
    return (await this.accountingRepository.findActiveLockCovering(tenantId, date)) !== null;
  }

  /** Header of a tenant's journal entry by its exact number, or null. */
  async findJournalEntryByNumber(
    tenantId: string,
    entryNumber: string,
  ): Promise<{ id: number; entryNumber: string } | null> {
    const entry = await this.accountingRepository.findEntryByNumber(
      tenantId,
      entryNumber,
    );
    return entry ? { id: entry.id, entryNumber: entry.entryNumber } : null;
  }

  async findAllJournalEntries(
    tenantId: string,
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
      await this.accountingRepository.findAndCountEntries(tenantId, {
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

  async findOneJournalEntry(
    tenantId: string,
    id: number,
  ): Promise<JournalEntryResponseDto> {
    const entity = await this.accountingRepository.findEntryById(tenantId, id);
    if (!entity) {
      throw new NotFoundException(`سند حسابداری با شناسه ${id} یافت نشد.`);
    }
    return this.toEntryDto(entity);
  }

  /**
   * تراز آزمایشی (Trial Balance): جمع بدهکار/بستانکار هر حساب مستقیماً از
   * سطرهای اسناد؛ حساب بدون گردش نیز با مانده صفر نمایش داده می‌شود.
   *
   * تراز همیشه بر مبنای ریال (ارز گزارش‌گیری) است. با ارسال `?currency=` تنها
   * سطرهای همان ارز لحاظ می‌شوند و جمع مبالغ ارزی (amount_fx) و معادل ریالی
   * آن‌ها نیز برگردانده می‌شود.
   */
  async getTrialBalance(
    tenantId: string,
    query?: QueryTrialBalanceDto,
  ): Promise<TrialBalanceResponseDto> {
    await this.ensureDefaultAccounts(tenantId);

    const normalised = query?.currency
      ? normalizeCurrency(query.currency)
      : undefined;
    if (query?.currency && !normalised) {
      throw new BadRequestException(
        `ارز فیلتر نامعتبر است: ${query.currency}`,
      );
    }
    const currency = normalised ?? undefined;

    const [accounts, rawRows] = await Promise.all([
      this.accountingRepository.findAllAccounts(tenantId),
      this.accountingRepository.getTrialBalance(tenantId, currency),
    ]);

    const aggregate = new Map(
      rawRows.map((row) => [
        row.code,
        { debit: fromDb(row.totalDebit), credit: fromDb(row.totalCredit) },
      ]),
    );

    const rowMinors = accounts.map((account) => {
      const totals = aggregate.get(account.code) ?? { debit: 0n, credit: 0n };
      return { account, ...totals };
    });
    const rows: TrialBalanceRowDto[] = rowMinors.map(({ account, debit, credit }) => ({
      code: account.code,
      name: account.name,
      accountType: account.accountType,
      currency: account.currency as Currency,
      totalDebit: fromMinor(debit),
      totalCredit: fromMinor(credit),
      balance: fromMinor(debit - credit),
    }));

    const totalDebitMinor = rowMinors.reduce((sum, row) => sum + row.debit, 0n);
    const totalCreditMinor = rowMinors.reduce((sum, row) => sum + row.credit, 0n);

    // Ledger debit/credit are always stored in rial (IRR), whatever the account's default
    // currency (USD, MULTI, ...), so the base conversion is IRR -> USD of the exact totals.
    const baseTotalDebit = this.toBaseCurrency(
      asNumber(totalDebitMinor),
      Currency.IRR,
    );
    const baseTotalCredit = this.toBaseCurrency(
      asNumber(totalCreditMinor),
      Currency.IRR,
    );

    // جمع‌های ارزی (تنها زمانی معنادار که فیلتر ارز اعمال شده باشد).
    const totalAmountFx = fromMinor(
      rawRows.reduce((sum, row) => sum + fromDb(row.totalAmountFx), 0n),
    );
    const totalFxInIrr = fromMinor(
      rawRows.reduce((sum, row) => sum + fromDb(row.totalFxInIrr), 0n),
    );

    const balanced = totalDebitMinor === totalCreditMinor;
    return {
      rows,
      totalDebit: fromMinor(totalDebitMinor),
      totalCredit: fromMinor(totalCreditMinor),
      balanced,
      baseCurrency: BASE_CURRENCY,
      baseTotalDebit,
      baseTotalCredit,
      // Both base totals are the same conversion of the exact IRR totals: they match iff those do.
      baseBalanced: balanced,
      currency,
      totalAmountFx,
      totalFxInIrr,
    };
  }

  /** حساب دفتر کل با شناسه (فقط همین مستأجر)؛ برای اتصال حساب بانکی. */
  async findAccountById(
    tenantId: string,
    id: number,
  ): Promise<AccountResponseDto | null> {
    await this.ensureDefaultAccounts(tenantId);
    const account = await this.accountingRepository.findAccountById(
      tenantId,
      id,
    );
    return account ? this.toAccountDto(account) : null;
  }

  /**
   * سطرهای دفتر یک حساب (با شناسه سطر) برای تطبیق بانکی؛ مبالغ عددی ریالی.
   * با `lineIds` فقط همان سطرها (در همین حساب و مستأجر) برمی‌گردند.
   */
  async listLedgerLines(
    tenantId: string,
    accountId: number,
    options: { fromDate?: Date; toDate?: Date; lineIds?: number[] } = {},
  ): Promise<LedgerLineView[]> {
    const rows = options.lineIds
      ? await this.accountingRepository.findLedgerLinesByIds(
          tenantId,
          accountId,
          options.lineIds,
        )
      : await this.accountingRepository.getAccountLedger(
          tenantId,
          accountId,
          options.fromDate,
          options.toDate,
        );
    return rows.map((row) => ({
      id: Number(row.id),
      journalEntryId: Number(row.journalEntryId),
      entryNumber: row.entryNumber,
      date: new Date(row.date),
      description: row.lineDescription ?? row.entryDescription,
      entryDescription: row.entryDescription,
      debit: asNumber(fromDb(row.debit)),
      credit: asNumber(fromDb(row.credit)),
    }));
  }

  /**
   * گردش حساب (Account Ledger) به همراه مانده افتتاح/اختتام و مانده تجمعی.
   */
  async getAccountLedger(
    tenantId: string,
    code: string,
    query: QueryAccountLedgerDto,
  ): Promise<AccountLedgerResponseDto> {
    await this.ensureDefaultAccounts(tenantId);
    const account = await this.accountingRepository.findAccountByCode(
      tenantId,
      code,
    );
    if (!account) {
      throw new NotFoundException(`حساب با کد ${code} یافت نشد.`);
    }

    const rawRows = await this.accountingRepository.getAccountLedger(
      tenantId,
      account.id,
    );
    const fromDate = query.fromDate ? new Date(query.fromDate) : undefined;
    const toDate = query.toDate ? new Date(query.toDate) : undefined;

    let runningMinor = 0n;
    const computed = rawRows.map((row) => {
      const debit = fromDb(row.debit);
      const credit = fromDb(row.credit);
      runningMinor += debit - credit;
      return {
        id: row.id,
        journalEntryId: row.journalEntryId,
        entryNumber: row.entryNumber,
        date: row.date,
        description: row.lineDescription ?? row.entryDescription,
        debit,
        credit,
        running: runningMinor,
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
      .reduce((sum, row) => sum + row.debit - row.credit, 0n);

    const openingMinor =
      limited.length > 0
        ? limited[0].running - (limited[0].debit - limited[0].credit)
        : openingBeforeRange;

    const closingMinor =
      limited.length > 0 ? limited[limited.length - 1].running : openingBeforeRange;

    return {
      account: this.toAccountDto(account),
      openingBalance: fromMinor(openingMinor),
      totalDebit: fromMinor(limited.reduce((sum, row) => sum + row.debit, 0n)),
      totalCredit: fromMinor(limited.reduce((sum, row) => sum + row.credit, 0n)),
      closingBalance: fromMinor(closingMinor),
      baseCurrency: BASE_CURRENCY,
      // closingBalance is in rial (ledger amounts), not in the account's default currency.
      baseClosingBalance: this.toBaseCurrency(asNumber(closingMinor), Currency.IRR),
      entries: limited.map((row) => ({
        id: row.id,
        journalEntryId: row.journalEntryId,
        entryNumber: row.entryNumber,
        date: row.date,
        description: row.description,
        debit: fromMinor(row.debit),
        credit: fromMinor(row.credit),
        runningBalance: fromMinor(row.running),
      })),
    };
  }
}
