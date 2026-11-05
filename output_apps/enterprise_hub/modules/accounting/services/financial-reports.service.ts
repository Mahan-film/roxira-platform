import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { fromDb, fromMinor } from '../money';
import { AgeingQueryDto, LedgerQueryDto, ReportPeriodDto, SubsidiaryQueryDto, TrialBalanceQueryDto } from '../dto/report.dto';
import { AccountType, ReportLine } from '../enums/accounting.enum';
import { AccountingRepository } from '../repositories/accounting.repository';
import { FiscalYearRepository } from '../repositories/fiscal-year.repository';
import { AccountBucketRow, LedgerReportRepository } from '../repositories/ledger-report.repository';
import {
  AccountBalance,
  balanceSheet,
  BalanceSheet,
  cashFlow,
  CashFlowStatement,
  classify,
  dashboard,
  Dashboard,
  equityChanges,
  EquityChanges,
  incomeStatement,
  IncomeStatement,
  ReportAccount,
  rollUp,
  TRIAL_BALANCE_GROUPS,
  TrialBalanceColumns,
  TrialBalanceGroup,
  TrialBalanceRow,
  trialBalanceRows,
} from '../reports/statements';
import { ageing, AgeingInputError, AgeingReport } from '../reports/ageing';
import { AGEING_ALLOCATIONS, AllocationLister, allocationSource } from '../reports/ageing-allocations';
import type { ChartAccountRow } from '../reports/report-tables';

export interface ResolvedPeriod {
  yearStart: string;
  from: string;
  to: string;
}

export interface InferredAccount {
  code: string;
  name: string;
  line: string;
}

export interface TrialBalanceReport {
  period: ResolvedPeriod;
  columns: TrialBalanceColumns;
  groups: readonly TrialBalanceGroup[];
  rows: TrialBalanceRow[];
  totals: Omit<TrialBalanceRow, 'code' | 'name' | 'level'>;
  /** Null on a subsidiary report: parties are only part of the ledger, so its sides need not match. */
  balanced: boolean | null;
}

export interface LedgerReport {
  period: ResolvedPeriod;
  accountCode: string;
  accountName: string;
  partyCode: string | null;
  opening: bigint;
  totalDebit: bigint;
  totalCredit: bigint;
  closing: bigint;
  /** Lines beyond `limit` are left out of `lines` but stay in the totals. */
  truncated: boolean;
  lines: Array<{
    journalEntryId: number;
    entryNumber: string;
    date: string;
    accountCode: string;
    accountName: string;
    partyCode: string | null;
    description: string;
    debit: bigint;
    credit: bigint;
    running: bigint;
  }>;
}

const realDay = (day: string): boolean => {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
};

/** Turns the bigints of a report into exact JSON money (see `fromMinor`), keeping counts as they are. */
export function moneyJson<T>(value: T): unknown {
  if (typeof value === 'bigint') {
    return fromMinor(value);
  }
  if (Array.isArray(value)) {
    return value.map(moneyJson);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, moneyJson(item)]));
  }
  return value;
}

/**
 * Reports over POSTED ledger lines of the JWT tenant. The ledger is the only source, so imported
 * data and data from any other module report the same way.
 */
@Injectable()
export class FinancialReportsService {
  constructor(
    private readonly accounting: AccountingRepository,
    private readonly fiscalYears: FiscalYearRepository,
    private readonly ledger: LedgerReportRepository,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private readonly log = new Logger(FinancialReportsService.name);

  /** Treasury's allocations when that module is loaded (it binds AGEING_ALLOCATIONS), else none. */
  private allocationLister(): AllocationLister | null {
    try {
      return this.moduleRef?.get<AllocationLister>(AGEING_ALLOCATIONS, { strict: false }) ?? null;
    } catch {
      return null;
    }
  }

  async resolvePeriod(tenantId: string, query: ReportPeriodDto): Promise<ResolvedPeriod> {
    for (const day of [query.from, query.to]) {
      if (day && !realDay(day)) {
        throw new BadRequestException(`تاریخ ${day} معتبر نیست.`);
      }
    }
    let yearStart: string | undefined;
    let to = query.to;
    if (query.fiscalYearId) {
      const year = await this.fiscalYears.find(tenantId, query.fiscalYearId);
      if (!year) {
        throw new NotFoundException(`سال مالی با شناسه ${query.fiscalYearId} یافت نشد.`);
      }
      yearStart = year.startDate;
      to = to ?? year.endDate;
    } else {
      to = to ?? new Date().toISOString().slice(0, 10);
      yearStart = (await this.fiscalYears.findContaining(tenantId, to))?.startDate;
    }
    yearStart = yearStart ?? query.from ?? (await this.ledger.firstEntryDay(tenantId)) ?? to;
    const from = query.from ?? yearStart;
    if (from > to) {
      throw new BadRequestException('شروع دوره نباید بعد از پایان آن باشد.');
    }
    // A range that starts before the year reports as its own period.
    return { yearStart: from < yearStart ? from : yearStart, from, to };
  }

  async accounts(tenantId: string): Promise<ReportAccount[]> {
    const rows = await this.accounting.findAllAccounts(tenantId);
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      accountType: row.accountType,
      level: row.level ?? null,
      parentCode: row.parentCode ?? null,
      reportLine: row.reportLine ?? null,
    }));
  }

  /** Every account of the tenant with its currency, for the chart export. */
  async chartOfAccounts(tenantId: string): Promise<ChartAccountRow[]> {
    const rows = await this.accounting.findAllAccounts(tenantId);
    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      accountType: row.accountType,
      level: row.level ?? null,
      parentCode: row.parentCode ?? null,
      currency: row.currency,
    }));
  }

  toBalance(row: AccountBucketRow, account: ReportAccount): AccountBalance {
    return {
      account,
      ...classify(account),
      opening: fromDb(row.openingDebit) - fromDb(row.openingCredit),
      priorDebit: fromDb(row.priorDebit),
      priorCredit: fromDb(row.priorCredit),
      periodDebit: fromDb(row.periodDebit),
      periodCredit: fromDb(row.periodCredit),
      closeDebit: fromDb(row.closingDebit),
      closeCredit: fromDb(row.closingCredit),
    };
  }

  private async balances(
    tenantId: string,
    period: ResolvedPeriod,
  ): Promise<{ accounts: ReportAccount[]; balances: AccountBalance[] }> {
    const [accounts, rows] = await Promise.all([
      this.accounts(tenantId),
      this.ledger.accountBuckets(tenantId, period),
    ]);
    const byId = new Map(accounts.map((account) => [account.id, account]));
    return {
      accounts,
      balances: rows.map((row) => this.toBalance(row, byId.get(Number(row.accountId))!)),
    };
  }

  private inferred(balances: AccountBalance[]): InferredAccount[] {
    return balances
      .filter((balance) => balance.inferred)
      .map(({ account, line }) => ({ code: account.code, name: account.name, line }));
  }

  summarize(
    period: ResolvedPeriod,
    columns: TrialBalanceColumns,
    rows: TrialBalanceRow[],
  ): TrialBalanceReport {
    const keys = [
      'openingDebit', 'openingCredit', 'priorDebit', 'priorCredit', 'periodDebit', 'periodCredit',
      'turnoverDebit', 'turnoverCredit', 'endingDebit', 'endingCredit',
    ] as const;
    const totals = Object.fromEntries(
      keys.map((key) => [key, rows.reduce((total, row) => total + row[key], 0n)]),
    ) as TrialBalanceReport['totals'];
    const groups = TRIAL_BALANCE_GROUPS[columns];
    return {
      period,
      columns,
      groups,
      rows,
      totals,
      balanced:
        totals.periodDebit === totals.periodCredit &&
        totals.turnoverDebit === totals.turnoverCredit &&
        totals.endingDebit === totals.endingCredit,
    };
  }

  async trialBalance(tenantId: string, query: TrialBalanceQueryDto): Promise<TrialBalanceReport> {
    const period = await this.resolvePeriod(tenantId, query);
    const { accounts, balances } = await this.balances(tenantId, period);
    const rows = trialBalanceRows(balances, accounts, query);
    return this.summarize(period, query.columns ?? 6, rows);
  }

  /** Accounts under `code`, the account itself included. */
  private subtree(accounts: ReportAccount[], code: string): ReportAccount[] {
    const root = accounts.find((account) => account.code === code);
    if (!root) {
      throw new NotFoundException(`حساب با کد ${code} یافت نشد.`);
    }
    const included = new Map([[root.code, root]]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const account of accounts) {
        if (!included.has(account.code) && account.parentCode && included.has(account.parentCode)) {
          included.set(account.code, account);
          grew = true;
        }
      }
    }
    return [...included.values()];
  }

  /**
   * Trial balance per account and party (tafsili), for one account's subtree or for all. A party's
   * balances on different accounts stay on separate rows: a customer's debt never nets a payable.
   */
  async subsidiary(tenantId: string, query: SubsidiaryQueryDto): Promise<TrialBalanceReport> {
    const period = await this.resolvePeriod(tenantId, query);
    const [accounts, rows] = await Promise.all([
      this.accounts(tenantId),
      this.ledger.accountBuckets(tenantId, { ...period, byParty: true }),
    ]);
    const scope = new Set(
      (query.accountCode ? this.subtree(accounts, query.accountCode) : accounts).map((a) => a.id),
    );
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const byCode = new Map(accounts.map((account) => [account.code, account]));
    const balances = rows
      .filter((row) => scope.has(Number(row.accountId)) && row.partyCode)
      .map((row) => {
        const account = rollUp(byId.get(Number(row.accountId))!, query.level, byCode);
        const party: ReportAccount = {
          id: 0,
          code: `${account.code}/${row.partyCode}`,
          name: `${account.name}: ${row.partyCode}`,
          accountType: AccountType.ASSET,
          level: null,
          parentCode: null,
          reportLine: null,
        };
        return this.toBalance(row, party);
      });
    const report = this.summarize(
      period,
      query.columns ?? 6,
      trialBalanceRows(balances, [], { includeClosing: query.includeClosing }),
    );
    return { ...report, balanced: null };
  }

  /**
   * Receivable or payable ageing per account and party at `to` (default today), by document date.
   * Without `accountCode` it covers every account whose statement line is RECEIVABLE (or PAYABLE),
   * set on the account or inferred from its name.
   */
  async ageing(tenantId: string, query: AgeingQueryDto): Promise<AgeingReport & { accountCodes: string[] }> {
    const side = query.side ?? 'receivable';
    const to = query.to ?? new Date().toISOString().slice(0, 10);
    if (!realDay(to)) {
      throw new BadRequestException(`تاریخ ${to} معتبر نیست.`);
    }
    const accounts = await this.accounts(tenantId);
    const line = side === 'receivable' ? ReportLine.RECEIVABLE : ReportLine.PAYABLE;
    const scope = query.accountCode
      ? this.subtree(accounts, query.accountCode)
      : accounts.filter((account) => classify(account).line === line);
    const accountCodes = scope.map((account) => account.code).sort();
    const rows = scope.length
      ? await this.ledger.ageingLines(tenantId, {
          accountIds: scope.map((account) => account.id),
          to,
          partyCode: query.partyCode,
        })
      : [];
    // Real settlements (#237): a receipt allocated to an invoice settles that invoice; the rest is FIFO.
    const lister = rows.some((row) => row.ref) ? this.allocationLister() : null;
    const allocations = allocationSource(
      lister ? await lister.listAllocations(tenantId, { partyCode: query.partyCode, asOf: to }) : [],
    );
    if (!lister && rows.some((row) => row.ref?.startsWith('trs:'))) {
      this.log.warn('Treasury lines found but no allocation source is bound; ageing them FIFO.');
    }
    try {
      const report = ageing(
        rows.map((row) => ({
          accountCode: row.accountCode,
          accountName: row.accountName,
          partyCode: row.partyCode,
          day: row.day,
          debit: fromDb(row.debit),
          credit: fromDb(row.credit),
          ref: row.ref ?? null,
        })),
        { side, asOf: to, edges: query.edges, allocations },
      );
      return { ...report, accountCodes };
    } catch (error) {
      if (error instanceof AgeingInputError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async accountLedger(tenantId: string, query: LedgerQueryDto): Promise<LedgerReport> {
    const period = await this.resolvePeriod(tenantId, query);
    const accounts = await this.accounts(tenantId);
    const scope = this.subtree(accounts, query.accountCode);
    const filter = {
      accountIds: scope.map((account) => account.id),
      partyCode: query.partyCode,
      from: period.from,
      to: period.to,
      limit: query.limit ?? 1000,
    };
    const [totals, lines] = await Promise.all([
      this.ledger.ledgerTotals(tenantId, filter),
      this.ledger.ledgerLines(tenantId, filter),
    ]);
    const opening = fromDb(totals.opening);
    const totalDebit = fromDb(totals.debit);
    const totalCredit = fromDb(totals.credit);
    let running = opening;
    return {
      period,
      accountCode: query.accountCode,
      accountName: scope[0].name,
      partyCode: query.partyCode ?? null,
      opening,
      totalDebit,
      totalCredit,
      closing: opening + totalDebit - totalCredit,
      truncated: Number(totals.count) > lines.length,
      lines: lines.map((line) => {
        const debit = fromDb(line.debit);
        const credit = fromDb(line.credit);
        running += debit - credit;
        return {
          journalEntryId: Number(line.journalEntryId),
          entryNumber: line.entryNumber,
          date: new Date(line.date).toISOString().slice(0, 10),
          accountCode: line.accountCode,
          accountName: line.accountName,
          partyCode: line.partyCode,
          description: line.description,
          debit,
          credit,
          running,
        };
      }),
    };
  }

  /** A balance sheet is a position: it always reports from the start of the year. */
  async balanceSheet(
    tenantId: string,
    query: ReportPeriodDto,
  ): Promise<BalanceSheet & { period: ResolvedPeriod; inferredAccounts: InferredAccount[] }> {
    const resolved = await this.resolvePeriod(tenantId, query);
    const period = { ...resolved, from: resolved.yearStart };
    const { balances } = await this.balances(tenantId, period);
    return { ...balanceSheet(balances), period, inferredAccounts: this.inferred(balances) };
  }

  async incomeStatement(
    tenantId: string,
    query: ReportPeriodDto,
  ): Promise<IncomeStatement & { period: ResolvedPeriod; inferredAccounts: InferredAccount[] }> {
    const period = await this.resolvePeriod(tenantId, query);
    const { balances } = await this.balances(tenantId, period);
    return { ...incomeStatement(balances), period, inferredAccounts: this.inferred(balances) };
  }

  async cashFlow(
    tenantId: string,
    query: ReportPeriodDto,
  ): Promise<CashFlowStatement & { period: ResolvedPeriod; inferredAccounts: InferredAccount[] }> {
    const period = await this.resolvePeriod(tenantId, query);
    const { balances } = await this.balances(tenantId, period);
    return { ...cashFlow(balances), period, inferredAccounts: this.inferred(balances) };
  }

  async equityChanges(
    tenantId: string,
    query: ReportPeriodDto,
  ): Promise<EquityChanges & { period: ResolvedPeriod; inferredAccounts: InferredAccount[] }> {
    const period = await this.resolvePeriod(tenantId, query);
    const { balances } = await this.balances(tenantId, period);
    return { ...equityChanges(balances), period, inferredAccounts: this.inferred(balances) };
  }

  /** Position today (or at `to`), with sales and profit of the year so far. */
  async dashboard(
    tenantId: string,
    query: ReportPeriodDto,
  ): Promise<Dashboard & { period: ResolvedPeriod; inferredAccounts: InferredAccount[] }> {
    const resolved = await this.resolvePeriod(tenantId, query);
    const period = { ...resolved, from: resolved.yearStart };
    const { balances } = await this.balances(tenantId, period);
    return { ...dashboard(balances), period, inferredAccounts: this.inferred(balances) };
  }
}
