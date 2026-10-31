import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Currency } from '../../currency/enums/currency.enum';
import {
  CreatePettyCashExpenseDto,
  CreatePettyCashFundDto,
  PettyCashFundResponseDto,
  PettyCashMovementDto,
  PettyCashStatementDto,
  PettyCashTransactionResponseDto,
  SettlePettyCashDto,
} from '../dto/petty-cash.dto';
import { ChartOfAccountEntity } from '../entities/chart-of-account.entity';
import { PettyCashFundEntity, PettyCashTransactionEntity } from '../entities/petty-cash.entity';
import {
  AccountLevel,
  AccountType,
  PettyCashFundStatus,
  PettyCashKind,
  PettyCashStatus,
  ReportLine,
} from '../enums/accounting.enum';
import { fromDb, fromMinor, minorToDecimal, Money, MoneyFormatError, toMinor } from '../money';
import { AccountingRepository } from '../repositories/accounting.repository';
import { PettyCashRepository } from '../repositories/petty-cash.repository';
import { classify } from '../reports/statements';
import { AccountingService } from './accounting.service';

const PETTY_CASH_PARENT = '1013';

const realDay = (day: string): void => {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new BadRequestException(`تاریخ ${day} معتبر نیست.`);
  }
};

const positive = (value: Money): bigint => {
  let minor: bigint;
  try {
    minor = toMinor(value);
  } catch (error) {
    if (error instanceof MoneyFormatError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
  if (minor <= 0n) {
    throw new BadRequestException('مبلغ باید بزرگ‌تر از صفر باشد.');
  }
  return minor;
};

/** Mid-day UTC keeps the calendar day whatever the database session time zone is. */
const entryDate = (day: string): string => `${day}T12:00:00.000Z`;

/**
 * Petty cash. Receipts wait as PENDING and touch no ledger account; a settlement posts them as one
 * entry (debit expenses, credit the fund) and can refill the fund from a bank in a second entry.
 * All moves of a fund run under its row lock, so limits hold under concurrent requests.
 */
@Injectable()
export class PettyCashService {
  constructor(
    private readonly repository: PettyCashRepository,
    private readonly accountingRepository: AccountingRepository,
    private readonly accounting: AccountingService,
  ) {}

  private async toFundDto(
    tenantId: string,
    fund: PettyCashFundEntity,
    code: string,
    manager: EntityManager,
  ): Promise<PettyCashFundResponseDto> {
    const balance = fromDb(await this.repository.ledgerBalance(tenantId, fund.ledgerAccountId, manager));
    const pending = fromDb(await this.repository.pendingTotal(tenantId, fund.id, manager));
    return {
      id: fund.id,
      name: fund.name,
      custodianName: fund.custodianName,
      custodianUserId: fund.custodianUserId,
      ledgerAccountCode: code,
      imprestAmount: fromMinor(fromDb(fund.imprestAmount)),
      status: fund.status,
      balance: fromMinor(balance),
      pending: fromMinor(pending),
      available: fromMinor(balance - pending),
    };
  }

  private toTransactionDto(row: PettyCashTransactionEntity): PettyCashTransactionResponseDto {
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      date: row.date,
      amount: fromMinor(fromDb(row.amount)),
      accountCode: row.accountCode,
      description: row.description,
      receiptNumber: row.receiptNumber,
      journalEntryId: row.journalEntryId,
    };
  }

  private async accountsById(
    tenantId: string,
    manager: EntityManager,
  ): Promise<Map<number, ChartOfAccountEntity>> {
    const accounts = await this.accountingRepository.findAllAccounts(tenantId, manager);
    return new Map(accounts.map((account) => [account.id, account]));
  }

  async listFunds(tenantId: string): Promise<PettyCashFundResponseDto[]> {
    return this.repository.scoped(tenantId, async (manager) => {
      const funds = await manager.find(PettyCashFundEntity, { where: { tenantId }, order: { name: 'ASC' } });
      const accounts = await this.accountsById(tenantId, manager);
      const result: PettyCashFundResponseDto[] = [];
      for (const fund of funds) {
        result.push(await this.toFundDto(tenantId, fund, accounts.get(fund.ledgerAccountId)!.code, manager));
      }
      return result;
    });
  }

  async statement(tenantId: string, id: number): Promise<PettyCashStatementDto> {
    return this.repository.scoped(tenantId, async (manager) => {
      const fund = await this.repository.findFund(tenantId, id, manager);
      if (!fund) {
        throw new NotFoundException(`تنخواه با شناسه ${id} یافت نشد.`);
      }
      const accounts = await this.accountsById(tenantId, manager);
      return {
        fund: await this.toFundDto(tenantId, fund, accounts.get(fund.ledgerAccountId)!.code, manager),
        transactions: (await this.repository.listTransactions(tenantId, id, manager)).map((row) =>
          this.toTransactionDto(row),
        ),
      };
    });
  }

  /** The named account, or the next free detail account under the petty cash moein. */
  private async fundAccount(
    tenantId: string,
    code: string | undefined,
    name: string,
    manager: EntityManager,
  ): Promise<ChartOfAccountEntity> {
    const accounts = await this.accountingRepository.findAllAccounts(tenantId, manager);
    if (code) {
      const account = accounts.find((candidate) => candidate.code === code);
      if (!account) {
        throw new BadRequestException(`حساب ${code} یافت نشد.`);
      }
      if (account.accountType !== AccountType.ASSET || this.isHeader(account)) {
        throw new BadRequestException(`حساب ${code} برای تنخواه مناسب نیست؛ حساب دارایی معین یا تفصیلی لازم است.`);
      }
      return account;
    }
    const parent = accounts.find((candidate) => candidate.code === PETTY_CASH_PARENT);
    const taken = new Set(accounts.map((account) => account.code));
    let sequence = 1;
    while (taken.has(`${PETTY_CASH_PARENT}${String(sequence).padStart(2, '0')}`)) {
      sequence += 1;
    }
    const newCode = `${PETTY_CASH_PARENT}${String(sequence).padStart(2, '0')}`;
    await this.accountingRepository.insertMissingAccounts(
      tenantId,
      [
        {
          code: newCode,
          name: `تنخواه ${name}`.slice(0, 128),
          accountType: AccountType.ASSET,
          currency: Currency.IRR,
          balance: '0',
          level: AccountLevel.TAFSILI,
          parentCode: parent ? PETTY_CASH_PARENT : null,
          reportLine: ReportLine.PETTY_CASH,
        },
      ],
      manager,
    );
    const [created] = await this.accountingRepository.findAccountsByCodes(tenantId, [newCode], manager);
    return created;
  }

  /** A receipt is spending: moving money between cash accounts is a charge or a return. */
  private isCashLike(account: ChartOfAccountEntity): boolean {
    const { line } = classify({
      id: account.id,
      code: account.code,
      name: account.name,
      accountType: account.accountType,
      level: account.level,
      parentCode: account.parentCode,
      reportLine: account.reportLine,
    });
    return line === ReportLine.CASH || line === ReportLine.BANK || line === ReportLine.PETTY_CASH;
  }

  private isHeader(account: ChartOfAccountEntity): boolean {
    return account.level === AccountLevel.GROUP || account.level === AccountLevel.KOL;
  }

  async createFund(tenantId: string, dto: CreatePettyCashFundDto): Promise<PettyCashFundResponseDto> {
    const imprest = positive(dto.imprestAmount);
    return this.repository.scoped(tenantId, async (manager) => {
      const name = dto.name.trim();
      // Serialises fund creation: no name clash or shared account code between concurrent requests.
      await this.accountingRepository.lockLedgerExclusive(tenantId, manager);
      if (await this.repository.findFundByName(tenantId, name, manager)) {
        throw new ConflictException(`تنخواه ${name} قبلاً تعریف شده است.`);
      }
      const account = await this.fundAccount(tenantId, dto.ledgerAccountCode, name, manager);
      if (await this.repository.findFundByAccount(tenantId, account.id, manager)) {
        throw new ConflictException(`حساب ${account.code} به تنخواه دیگری وصل است.`);
      }
      const fund = await this.repository.saveFund(
        tenantId,
        {
          name,
          custodianName: dto.custodianName.trim(),
          custodianUserId: dto.custodianUserId ?? null,
          ledgerAccountId: account.id,
          imprestAmount: minorToDecimal(imprest),
          status: PettyCashFundStatus.ACTIVE,
        },
        manager,
      );
      return this.toFundDto(tenantId, fund, account.code, manager);
    });
  }

  /** Locks an active fund and returns it with its account code and ledger balance. */
  private async activeFund(tenantId: string, id: number, manager: EntityManager) {
    const fund = await this.repository.lockFund(tenantId, id, manager);
    if (!fund) {
      throw new NotFoundException(`تنخواه با شناسه ${id} یافت نشد.`);
    }
    if (fund.status !== PettyCashFundStatus.ACTIVE) {
      throw new ConflictException(`تنخواه ${fund.name} بسته شده است.`);
    }
    const accounts = await this.accountsById(tenantId, manager);
    return {
      fund,
      code: accounts.get(fund.ledgerAccountId)!.code,
      balance: fromDb(await this.repository.ledgerBalance(tenantId, fund.ledgerAccountId, manager)),
      pending: fromDb(await this.repository.pendingTotal(tenantId, fund.id, manager)),
    };
  }

  /** A CHARGE or RETURN row with its entry. The row id numbers the entry, so numbers never clash. */
  private async postMovement(
    tenantId: string,
    actor: string,
    context: { fund: PettyCashFundEntity; code: string },
    kind: PettyCashKind,
    data: { amount: bigint; date: string; accountCode: string; description: string },
    manager: EntityManager,
  ): Promise<PettyCashTransactionEntity> {
    if (data.accountCode === context.code) {
      throw new BadRequestException('حساب مقابل نمی‌تواند خود تنخواه باشد.');
    }
    const row = await this.repository.saveTransaction(
      tenantId,
      {
        fundId: context.fund.id,
        kind,
        status: PettyCashStatus.POSTED,
        date: data.date,
        amount: minorToDecimal(data.amount),
        accountCode: data.accountCode,
        description: data.description,
        createdBy: actor,
      },
      manager,
    );
    const amount = minorToDecimal(data.amount);
    const [debit, credit] =
      kind === PettyCashKind.CHARGE ? [context.code, data.accountCode] : [data.accountCode, context.code];
    const entry = await this.accounting.createJournalEntry(
      tenantId,
      {
        entryNumber: `PC-${row.id}`,
        date: entryDate(data.date),
        description: `${data.description} (${context.fund.name})`,
        lines: [
          { accountCode: debit, debit: amount },
          { accountCode: credit, credit: amount },
        ],
      } as never,
      manager,
    );
    return this.repository.saveTransaction(tenantId, { ...row, journalEntryId: entry.id }, manager);
  }

  async charge(
    tenantId: string,
    actor: string,
    id: number,
    dto: PettyCashMovementDto,
  ): Promise<PettyCashTransactionResponseDto> {
    realDay(dto.date);
    const amount = positive(dto.amount);
    return this.repository.scoped(tenantId, async (manager) => {
      const context = await this.activeFund(tenantId, id, manager);
      const ceiling = fromDb(context.fund.imprestAmount);
      if (context.balance + amount > ceiling) {
        throw new ConflictException(
          `شارژ از سقف تنخواه (${minorToDecimal(ceiling)}) بیشتر می‌شود؛ مانده فعلی ${minorToDecimal(context.balance)} است.`,
        );
      }
      const row = await this.postMovement(
        tenantId,
        actor,
        context,
        PettyCashKind.CHARGE,
        {
          amount,
          date: dto.date,
          accountCode: dto.accountCode,
          description: dto.description?.trim() || 'شارژ تنخواه',
        },
        manager,
      );
      return this.toTransactionDto(row);
    });
  }

  async returnCash(
    tenantId: string,
    actor: string,
    id: number,
    dto: PettyCashMovementDto,
  ): Promise<PettyCashTransactionResponseDto> {
    realDay(dto.date);
    const amount = positive(dto.amount);
    return this.repository.scoped(tenantId, async (manager) => {
      const context = await this.activeFund(tenantId, id, manager);
      if (amount > context.balance - context.pending) {
        throw new ConflictException('مبلغ برگشتی از مانده آزاد تنخواه بیشتر است.');
      }
      const row = await this.postMovement(
        tenantId,
        actor,
        context,
        PettyCashKind.RETURN,
        {
          amount,
          date: dto.date,
          accountCode: dto.accountCode,
          description: dto.description?.trim() || 'برگشت وجه تنخواه',
        },
        manager,
      );
      return this.toTransactionDto(row);
    });
  }

  async addExpense(
    tenantId: string,
    actor: string,
    id: number,
    dto: CreatePettyCashExpenseDto,
  ): Promise<PettyCashTransactionResponseDto> {
    realDay(dto.date);
    const amount = positive(dto.amount);
    return this.repository.scoped(tenantId, async (manager) => {
      const context = await this.activeFund(tenantId, id, manager);
      if (amount > context.balance - context.pending) {
        throw new ConflictException('مبلغ رسید از مانده آزاد تنخواه بیشتر است.');
      }
      const [account] = await this.accountingRepository.findAccountsByCodes(tenantId, [dto.accountCode], manager);
      if (!account || this.isHeader(account) || this.isCashLike(account)) {
        throw new BadRequestException(`حساب ${dto.accountCode} برای رسید تنخواه مناسب نیست.`);
      }
      const row = await this.repository.saveTransaction(
        tenantId,
        {
          fundId: id,
          kind: PettyCashKind.EXPENSE,
          status: PettyCashStatus.PENDING,
          date: dto.date,
          amount: minorToDecimal(amount),
          accountCode: dto.accountCode,
          description: dto.description.trim(),
          receiptNumber: dto.receiptNumber?.trim() || null,
          createdBy: actor,
        },
        manager,
      );
      return this.toTransactionDto(row);
    });
  }

  async voidExpense(
    tenantId: string,
    id: number,
    expenseId: number,
  ): Promise<PettyCashTransactionResponseDto> {
    return this.repository.scoped(tenantId, async (manager) => {
      await this.activeFund(tenantId, id, manager);
      const [row] = await this.repository.findPendingExpenses(tenantId, id, [expenseId], manager);
      if (!row) {
        throw new NotFoundException('رسید در انتظار تسویه یافت نشد.');
      }
      return this.toTransactionDto(
        await this.repository.saveTransaction(tenantId, { ...row, status: PettyCashStatus.VOID }, manager),
      );
    });
  }

  /** Posts the receipts as one entry, then optionally refills the fund by the same total. */
  async settle(
    tenantId: string,
    actor: string,
    id: number,
    dto: SettlePettyCashDto,
  ): Promise<PettyCashStatementDto> {
    realDay(dto.date);
    const expenseIds = Array.from(new Set(dto.expenseIds));
    await this.repository.scoped(tenantId, async (manager) => {
      const context = await this.activeFund(tenantId, id, manager);
      const expenses = await this.repository.findPendingExpenses(tenantId, id, expenseIds, manager);
      if (expenses.length !== expenseIds.length) {
        throw new ConflictException('بعضی رسیدها در انتظار تسویه نیستند؛ فهرست را تازه کنید.');
      }
      const total = expenses.reduce((sum, row) => sum + fromDb(row.amount), 0n);
      const entry = await this.accounting.createJournalEntry(
        tenantId,
        {
          // Each receipt settles once, so the smallest receipt id numbers the entry for good.
          entryNumber: `PCS-${Math.min(...expenseIds)}`,
          date: entryDate(dto.date),
          description: `تسویه تنخواه ${context.fund.name}`,
          lines: [
            ...expenses
              .sort((a, b) => a.id - b.id)
              .map((row) => ({
                accountCode: row.accountCode,
                debit: minorToDecimal(fromDb(row.amount)),
                description: row.description,
              })),
            { accountCode: context.code, credit: minorToDecimal(total) },
          ],
        } as never,
        manager,
      );
      for (const row of expenses) {
        await this.repository.saveTransaction(
          tenantId,
          { ...row, status: PettyCashStatus.SETTLED, journalEntryId: entry.id },
          manager,
        );
      }
      if (dto.replenishFromAccountCode) {
        await this.postMovement(
          tenantId,
          actor,
          context,
          PettyCashKind.CHARGE,
          {
            amount: total,
            date: dto.date,
            accountCode: dto.replenishFromAccountCode,
            description: 'جبران تنخواه',
          },
          manager,
        );
      }
    });
    return this.statement(tenantId, id);
  }

  async closeFund(tenantId: string, id: number): Promise<PettyCashFundResponseDto> {
    return this.repository.scoped(tenantId, async (manager) => {
      const context = await this.activeFund(tenantId, id, manager);
      if (context.balance !== 0n || context.pending !== 0n) {
        throw new ConflictException('پیش از بستن، رسیدها را تسویه و مانده تنخواه را برگشت بزنید.');
      }
      const fund = await this.repository.saveFund(
        tenantId,
        { ...context.fund, status: PettyCashFundStatus.CLOSED },
        manager,
      );
      return this.toFundDto(tenantId, fund, context.code, manager);
    });
  }
}
