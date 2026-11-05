import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { AccountResponseDto } from '../../accounting/dto/account-response.dto';
import { toMinor } from '../../accounting/money';
import {
  AccountingService,
  LedgerLineView,
} from '../../accounting/services/accounting.service';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { Currency } from '../../currency/enums/currency.enum';
import { bankDocType } from '../bank-posting';
import {
  DEFAULT_MATCH_WINDOW_DAYS,
  MATCH_AMOUNT_TOLERANCE,
  PG_UNIQUE_VIOLATION,
} from '../constants/banking.constants';
import {
  BankAccountResponseDto,
  CreateBankAccountDto,
} from '../dto/bank-account.dto';
import {
  AutoMatchDto,
  AutoMatchResponseDto,
  BookLineResponseDto,
  CreateEntryFromLineDto,
  QueryBookLinesDto,
  QueryStatementLinesDto,
  ReconciliationSummaryDto,
  StatementLineResponseDto,
} from '../dto/reconciliation.dto';
import { BankAccountEntity } from '../entities/bank-account.entity';
import { BankStatementLineEntity } from '../entities/bank-statement-line.entity';
import {
  BankCode,
  MatchMethod,
  StatementLineStatus,
} from '../enums/banking.enum';
import {
  amountsAgree,
  bankClosingBalance,
  proposeMatches,
} from '../matching/reconciliation-matcher';
import {
  BankingRepository,
  StatementLineInput,
} from '../repositories/banking.repository';

const PERSIAN_DIGITS = /[۰-۹]/g;

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function endOfDay(date: string): Date {
  return new Date(`${date.slice(0, 10)}T23:59:59.999Z`);
}

function startOfDay(date: string): Date {
  return new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { code?: string }).code === PG_UNIQUE_VIOLATION ||
      (error as { driverError?: { code?: string } }).driverError?.code ===
        PG_UNIQUE_VIOLATION)
  );
}

/**
 * سرویس حساب‌های بانکی و مغایرت‌گیری بانکی (Bank reconciliation).
 *
 * - هر حساب بانکی به یک حساب دفتر کل همان مستأجر متصل است.
 * - سطرهای صورتحساب بانک از مسیر ورود داده (`bank-statement`) وارد می‌شوند.
 * - تطبیق خودکار: مبلغ + پنجره تاریخ (+ شماره پیگیری)؛ تطبیق/لغو دستی؛ ساخت سند
 *   از سطر تطبیق‌نخورده؛ خلاصه مغایرت (مانده دفاتر در برابر مانده بانک).
 *
 * پرداخت صورتحساب‌ها (رویداد PAID) سند «بانک / حساب‌های دریافتنی» ثبت می‌کند؛
 * بنابراین تطبیق با سطرهای دفتر حساب بانک، پرداخت صورتحساب‌ها را هم پوشش می‌دهد.
 */
@Injectable()
export class BankingService {
  constructor(
    private readonly bankingRepository: BankingRepository,
    private readonly accountingService: AccountingService,
    private readonly postingRules: PostingRulesService,
  ) {}

  // ------------------------------------------------------------------ accounts

  async listAccounts(tenantId: string): Promise<BankAccountResponseDto[]> {
    const [accounts, ledger] = await Promise.all([
      this.bankingRepository.listAccounts(tenantId),
      this.accountingService.listAccounts(tenantId),
    ]);
    const ledgerById = new Map(ledger.map((account) => [account.id, account]));
    return accounts.map((account) =>
      this.toAccountDto(account, ledgerById.get(account.ledgerAccountId)),
    );
  }

  async createAccount(
    tenantId: string,
    dto: CreateBankAccountDto,
  ): Promise<BankAccountResponseDto> {
    const ledger = await this.accountingService.findAccountById(
      tenantId,
      dto.ledgerAccountId,
    );
    if (!ledger) {
      throw new BadRequestException('حساب دفتر کل انتخاب‌شده یافت نشد.');
    }
    const accountNumber = dto.accountNumber.replace(PERSIAN_DIGITS, (digit) =>
      String(digit.charCodeAt(0) - 0x06f0),
    );
    if (await this.bankingRepository.findAccountByNumber(tenantId, accountNumber)) {
      throw new ConflictException('حسابی با این شماره قبلاً ثبت شده است.');
    }
    try {
      const saved = await this.bankingRepository.createAccount(tenantId, {
        name: dto.name,
        bankCode: dto.bankCode ?? BankCode.OTHER,
        accountNumber,
        iban: dto.iban ?? null,
        ledgerAccountId: ledger.id,
        currency: dto.currency ?? Currency.IRR,
        openingBalance: dto.openingBalance ?? 0,
      });
      return this.toAccountDto(saved, ledger);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('حسابی با این شماره قبلاً ثبت شده است.');
      }
      throw error;
    }
  }

  // ------------------------------------------------------------ import adapter

  /**
   * حساب مقصد ورود صورتحساب: حساب انتخاب‌شده، یا تنها حساب بانکی سازمان.
   * با صفر یا چند حساب و بدون انتخاب، خطای روشن فارسی برمی‌گردد.
   */
  async resolveImportAccount(
    tenantId: string,
    bankAccountId?: number,
  ): Promise<BankAccountEntity> {
    if (bankAccountId) {
      const account = await this.bankingRepository.findAccount(tenantId, bankAccountId);
      if (!account) {
        throw new BadRequestException('حساب بانکی انتخاب‌شده یافت نشد.');
      }
      return account;
    }
    const accounts = await this.bankingRepository.listAccounts(tenantId);
    if (accounts.length === 1) {
      return accounts[0];
    }
    throw new BadRequestException(
      accounts.length === 0
        ? 'ابتدا یک حساب بانکی تعریف کنید (حسابداری ← بانک).'
        : 'حساب بانکی مقصد این صورتحساب را انتخاب کنید.',
    );
  }

  async importStatementLines(
    tenantId: string,
    bankAccountId: number | undefined,
    lines: StatementLineInput[],
  ): Promise<number[]> {
    const account = await this.resolveImportAccount(tenantId, bankAccountId);
    return this.bankingRepository.insertStatementLines(tenantId, account.id, lines);
  }

  async findExistingDedupeKeys(tenantId: string, keys: string[]): Promise<string[]> {
    return this.bankingRepository.findExistingDedupeKeys(tenantId, keys);
  }

  /** undo ورود: سطرهای تطبیق‌خورده حذف نمی‌شوند تا کار مغایرت‌گیری گم نشود. */
  async removeImportedLines(
    tenantId: string,
    ids: number[],
  ): Promise<{ removed: number; refused: number[] }> {
    const lines = await this.bankingRepository.findLinesByIds(tenantId, ids);
    const refused = lines
      .filter((line) => line.matchedJournalLineId !== null)
      .map((line) => line.id);
    const removable = lines
      .filter((line) => line.matchedJournalLineId === null)
      .map((line) => line.id);
    const removed = await this.bankingRepository.deleteLines(tenantId, removable);
    return { removed, refused };
  }

  // ------------------------------------------------------------ reconciliation

  async listStatementLines(
    tenantId: string,
    bankAccountId: number,
    query: QueryStatementLinesDto,
  ): Promise<StatementLineResponseDto[]> {
    await this.requireAccount(tenantId, bankAccountId);
    const lines = await this.bankingRepository.findLines(tenantId, bankAccountId, {
      status: query.status,
      fromDate: query.fromDate?.slice(0, 10),
      toDate: query.toDate?.slice(0, 10),
    });
    return lines.map((line) => this.toLineDto(line));
  }

  async listBookLines(
    tenantId: string,
    bankAccountId: number,
    query: QueryBookLinesDto,
  ): Promise<BookLineResponseDto[]> {
    const account = await this.requireAccount(tenantId, bankAccountId);
    const [bookLines, pairs] = await Promise.all([
      this.accountingService.listLedgerLines(tenantId, account.ledgerAccountId, {
        fromDate: query.fromDate ? startOfDay(query.fromDate) : undefined,
        toDate: query.toDate ? endOfDay(query.toDate) : undefined,
      }),
      this.bankingRepository.findMatchedPairs(tenantId),
    ]);
    const statementByJournalLine = new Map(
      pairs.map((pair) => [pair.journalLineId, pair.id]),
    );
    return bookLines
      .map((line) => ({
        id: line.id,
        journalEntryId: line.journalEntryId,
        entryNumber: line.entryNumber,
        date: line.date,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
        matchedStatementLineId: statementByJournalLine.get(line.id) ?? null,
      }))
      .filter((line) => !query.unmatchedOnly || line.matchedStatementLineId === null);
  }

  async autoMatch(
    tenantId: string,
    bankAccountId: number,
    dto: AutoMatchDto,
  ): Promise<AutoMatchResponseDto> {
    const account = await this.requireAccount(tenantId, bankAccountId);
    const windowDays = dto.windowDays ?? DEFAULT_MATCH_WINDOW_DAYS;
    const statementLines = await this.bankingRepository.findLines(tenantId, bankAccountId, {
      status: StatementLineStatus.UNMATCHED,
      fromDate: dto.fromDate?.slice(0, 10),
      toDate: dto.toDate?.slice(0, 10),
    });
    if (statementLines.length === 0) {
      return { matched: 0, ambiguous: 0, stillUnmatched: 0 };
    }
    // Book lines within the statement range widened by the window.
    const dates = statementLines.map((line) => line.txnDate).sort();
    const from = new Date(startOfDay(dates[0]).getTime() - windowDays * 86_400_000);
    const to = new Date(endOfDay(dates[dates.length - 1]).getTime() + windowDays * 86_400_000);
    const [bookLines, pairs] = await Promise.all([
      this.accountingService.listLedgerLines(tenantId, account.ledgerAccountId, {
        fromDate: from,
        toDate: to,
      }),
      this.bankingRepository.findMatchedPairs(tenantId),
    ]);
    const taken = new Set(pairs.map((pair) => pair.journalLineId));
    const proposal = proposeMatches(
      statementLines.map((line) => this.toMatchable(line)),
      bookLines.filter((line) => !taken.has(line.id)),
      windowDays,
    );

    let matched = 0;
    for (const match of proposal.matches) {
      try {
        if (
          await this.bankingRepository.setMatch(
            tenantId,
            match.statementLineId,
            match.journalLineId,
            MatchMethod.AUTO,
          )
        ) {
          matched += 1;
        }
      } catch (error) {
        // A concurrent match took this journal line; skip it, the rest still apply.
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
    }
    return {
      matched,
      ambiguous: proposal.ambiguous.length,
      stillUnmatched: statementLines.length - matched,
    };
  }

  async manualMatch(
    tenantId: string,
    statementLineId: number,
    journalLineId: number,
  ): Promise<StatementLineResponseDto> {
    const line = await this.requireLine(tenantId, statementLineId);
    if (line.matchedJournalLineId !== null) {
      throw new ConflictException('این سطر بانک قبلاً تطبیق خورده است؛ ابتدا تطبیق را لغو کنید.');
    }
    const account = await this.requireAccount(tenantId, line.bankAccountId);
    const [bookLine] = await this.accountingService.listLedgerLines(
      tenantId,
      account.ledgerAccountId,
      { lineIds: [journalLineId] },
    );
    if (!bookLine) {
      throw new NotFoundException('سطر سند در حساب دفتر کل این بانک یافت نشد.');
    }
    if (!amountsAgree(this.toMatchable(line), bookLine)) {
      throw new BadRequestException(
        `مبلغ یا جهت سطر سند با سطر بانک یکسان نیست (رواداری ${MATCH_AMOUNT_TOLERANCE} ریال).`,
      );
    }
    const pairs = await this.bankingRepository.findMatchedPairs(tenantId);
    if (pairs.some((pair) => pair.journalLineId === journalLineId)) {
      throw new ConflictException('این سطر سند قبلاً با سطر بانک دیگری تطبیق خورده است.');
    }
    await this.applyMatch(tenantId, line.id, journalLineId, MatchMethod.MANUAL);
    return this.toLineDto(await this.requireLine(tenantId, line.id));
  }

  async unmatch(
    tenantId: string,
    statementLineId: number,
  ): Promise<StatementLineResponseDto> {
    const line = await this.requireLine(tenantId, statementLineId);
    if (line.matchedJournalLineId === null) {
      throw new BadRequestException('این سطر تطبیق نخورده است.');
    }
    if (line.matchMethod === MatchMethod.CREATED) {
      throw new ConflictException(
        'این سطر با سندِ ساخته‌شده از خود سطر تطبیق خورده است؛ لغو تطبیق ممکن نیست. ابتدا آن سند را به‌صورت صریح اصلاح یا برگشت بزنید.',
      );
    }
    await this.bankingRepository.clearMatch(tenantId, line.id);
    return this.toLineDto(await this.requireLine(tenantId, line.id));
  }

  /**
   * ساخت سند از سطر بانکِ تطبیق‌نخورده (مثلاً کارمزد یا سود سپرده) و تطبیق آن.
   * واریز → بدهکار بانک / بستانکار حساب مقابل؛ برداشت → برعکس.
   */
  async createEntryFromLine(
    tenantId: string,
    statementLineId: number,
    dto: CreateEntryFromLineDto,
  ): Promise<StatementLineResponseDto> {
    const line = await this.requireLine(tenantId, statementLineId);
    if (line.matchedJournalLineId !== null) {
      throw new ConflictException('این سطر بانک قبلاً تطبیق خورده است.');
    }
    const account = await this.requireAccount(tenantId, line.bankAccountId);
    const ledger = await this.accountingService.findAccountById(
      tenantId,
      account.ledgerAccountId,
    );
    if (!ledger) {
      throw new BadRequestException('حساب دفتر کل این بانک یافت نشد.');
    }
    if (ledger.code === dto.counterAccountCode) {
      throw new BadRequestException('حساب مقابل نمی‌تواند همان حساب بانک باشد.');
    }
    const deposit = Number(line.deposit) || 0;
    const withdrawal = Number(line.withdrawal) || 0;
    const amount = deposit > 0 ? deposit : withdrawal;
    if (amount <= 0 || (deposit > 0 && withdrawal > 0)) {
      throw new BadRequestException('مبلغ سطر بانک برای ساخت سند معتبر نیست.');
    }
    const isDeposit = deposit > 0;
    const description = (
      dto.description ?? line.description ?? 'سطر صورتحساب بانک'
    ).slice(0, 255);

    // Journal entry + match commit together or not at all (no orphan entry on failure). There is no
    // client request id on this path, so the statement line is the idempotency key and the entry
    // number keeps the legacy random suffix.
    await this.bankingRepository.runInTransaction(async (manager) => {
      const result = await this.postingRules.post(
        tenantId,
        {
          docType: bankDocType(isDeposit ? 'in' : 'out'),
          sourceType: 'bank_entry',
          sourceId: String(line.id),
          entryNumber: `BNK-${line.id}-${randomUUID().slice(0, 8)}`,
          date: line.txnDate,
          description: line.reference
            ? `${description} (پیگیری ${line.reference})`
            : description,
          amounts: { amount: toMinor(amount) },
          overrides: { bank: ledger.code, counter: dto.counterAccountCode },
        },
        manager,
      );
      const bankLine = result.lines.find((item) => item.accountCode === ledger.code);
      if (!bankLine) {
        throw new BadRequestException('سطر بانک در سند ساخته‌شده یافت نشد.');
      }
      await this.applyMatch(
        tenantId,
        line.id,
        bankLine.journalLineId,
        MatchMethod.CREATED,
        result.entryId,
        manager,
      );
    });
    return this.toLineDto(await this.requireLine(tenantId, line.id));
  }

  async summary(
    tenantId: string,
    bankAccountId: number,
    asOfInput?: string,
  ): Promise<ReconciliationSummaryDto> {
    const account = await this.requireAccount(tenantId, bankAccountId);
    const asOf = (asOfInput ?? new Date().toISOString()).slice(0, 10);
    const [statementLines, bookLines, pairs] = await Promise.all([
      this.bankingRepository.findLines(tenantId, bankAccountId, { toDate: asOf }),
      this.accountingService.listLedgerLines(tenantId, account.ledgerAccountId, {
        toDate: endOfDay(asOf),
      }),
      this.bankingRepository.findMatchedPairs(tenantId),
    ]);
    const matchedBook = new Set(pairs.map((pair) => pair.journalLineId));

    const bookBalance = round(
      bookLines.reduce((sum, line) => sum + line.debit - line.credit, 0),
    );
    const bankBalance = bankClosingBalance(
      statementLines.map((line) => ({
        id: line.id,
        txnDate: line.txnDate,
        withdrawal: Number(line.withdrawal),
        deposit: Number(line.deposit),
        balance: line.balance === null ? null : Number(line.balance),
      })),
      Number(account.openingBalance) || 0,
    );

    const unmatchedStatement = statementLines.filter(
      (line) => line.matchedJournalLineId === null,
    );
    const unmatchedBook = bookLines.filter((line) => !matchedBook.has(line.id));
    const sum = <T>(rows: T[], pick: (row: T) => number) =>
      round(rows.reduce((total, row) => total + pick(row), 0));

    const unmatchedBankDeposits = sum(unmatchedStatement, (line) => Number(line.deposit) || 0);
    const unmatchedBankWithdrawals = sum(unmatchedStatement, (line) => Number(line.withdrawal) || 0);
    const unmatchedBookDebits = sum(unmatchedBook, (line: LedgerLineView) => line.debit);
    const unmatchedBookCredits = sum(unmatchedBook, (line: LedgerLineView) => line.credit);
    const adjustedBankBalance = round(bankBalance + unmatchedBookDebits - unmatchedBookCredits);
    const adjustedBookBalance = round(
      bookBalance + unmatchedBankDeposits - unmatchedBankWithdrawals,
    );

    return {
      bankAccountId: account.id,
      asOf,
      bookBalance,
      bankBalance,
      unmatchedBankDeposits,
      unmatchedBankWithdrawals,
      unmatchedBookDebits,
      unmatchedBookCredits,
      adjustedBankBalance,
      adjustedBookBalance,
      difference: round(adjustedBankBalance - adjustedBookBalance),
      matchedCount: statementLines.length - unmatchedStatement.length,
      unmatchedStatementCount: unmatchedStatement.length,
      unmatchedBookCount: unmatchedBook.length,
    };
  }

  // ------------------------------------------------------------------ helpers

  private async applyMatch(
    tenantId: string,
    statementLineId: number,
    journalLineId: number,
    method: MatchMethod,
    createdJournalEntryId: number | null = null,
    manager?: EntityManager,
  ): Promise<void> {
    let updated: boolean;
    try {
      updated = await this.bankingRepository.setMatch(
        tenantId,
        statementLineId,
        journalLineId,
        method,
        createdJournalEntryId,
        manager,
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('این سطر سند قبلاً با سطر بانک دیگری تطبیق خورده است.');
      }
      throw error;
    }
    if (!updated) {
      throw new ConflictException('این سطر بانک هم‌زمان تطبیق خورد؛ صفحه را تازه کنید.');
    }
  }

  private async requireAccount(
    tenantId: string,
    bankAccountId: number,
  ): Promise<BankAccountEntity> {
    const account = await this.bankingRepository.findAccount(tenantId, bankAccountId);
    if (!account) {
      throw new NotFoundException('حساب بانکی یافت نشد.');
    }
    return account;
  }

  private async requireLine(
    tenantId: string,
    statementLineId: number,
  ): Promise<BankStatementLineEntity> {
    const line = await this.bankingRepository.findLine(tenantId, statementLineId);
    if (!line) {
      throw new NotFoundException('سطر صورتحساب بانک یافت نشد.');
    }
    return line;
  }

  private toMatchable(line: BankStatementLineEntity) {
    return {
      id: line.id,
      txnDate: String(line.txnDate).slice(0, 10),
      withdrawal: Number(line.withdrawal) || 0,
      deposit: Number(line.deposit) || 0,
      reference: line.reference,
    };
  }

  private toAccountDto(
    account: BankAccountEntity,
    ledger?: AccountResponseDto,
  ): BankAccountResponseDto {
    return {
      id: account.id,
      name: account.name,
      bankCode: account.bankCode,
      accountNumber: account.accountNumber,
      iban: account.iban,
      ledgerAccountId: account.ledgerAccountId,
      ledgerAccountCode: ledger?.code ?? '',
      ledgerAccountName: ledger?.name ?? '',
      currency: account.currency,
      openingBalance: round(Number(account.openingBalance) || 0),
    };
  }

  private toLineDto(line: BankStatementLineEntity): StatementLineResponseDto {
    return {
      id: line.id,
      bankAccountId: line.bankAccountId,
      txnDate: String(line.txnDate).slice(0, 10),
      description: line.description,
      withdrawal: round(Number(line.withdrawal) || 0),
      deposit: round(Number(line.deposit) || 0),
      balance: line.balance === null ? null : round(Number(line.balance)),
      reference: line.reference,
      matchedJournalLineId:
        line.matchedJournalLineId === null ? null : Number(line.matchedJournalLineId),
      matchMethod: line.matchMethod,
      createdJournalEntryId:
        line.createdJournalEntryId === null ? null : Number(line.createdJournalEntryId),
    };
  }
}
