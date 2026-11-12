import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { strFromU8, unzipSync } from 'fflate';
import { parseXlsx } from '../data_import/parsers/xlsx.parser';
import { CurrencyService } from '../currency/services/currency.service';
import { AccountType } from './enums/accounting.enum';
import { AccountingRepository } from './repositories/accounting.repository';
import { FiscalYearRepository } from './repositories/fiscal-year.repository';
import { LedgerReportRepository } from './repositories/ledger-report.repository';
import { AccountingService } from './services/accounting.service';
import { ChartTemplateService } from './services/chart-template.service';
import { FinancialReportsService, moneyJson } from './services/financial-reports.service';
import { FiscalYearService } from './services/fiscal-year.service';
import { ReportExportService } from './services/report-export.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
} from '../../test/support/test-pg';

const COMPANY = '33333333-3333-4333-8333-333333333333';
const IMPORTED = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';

/** Rial with two decimals as minor units. */
const rial = (text: string): bigint => BigInt(text.replace('.', ''));

describePg('Financial reports on PostgreSQL', () => {
  let testDb: TestDatabaseContext;
  let accounting: AccountingService;
  let reports: FinancialReportsService;
  let exporter: ReportExportService;
  let years: FiscalYearService;
  let yearId: number;

  const post = (tenant: string, entryNumber: string, date: string, lines: object[]) =>
    accounting.createJournalEntry(tenant, { entryNumber, date, description: entryNumber, lines } as never);
  const pair = (tenant: string, n: string, date: string, debit: string, credit: string, amount: string, partyCode?: string) =>
    post(tenant, n, date, [
      { accountCode: debit, debit: amount, partyCode },
      { accountCode: credit, credit: amount, partyCode },
    ]);

  beforeAll(async () => {
    testDb = await createTestDatabase('rep');
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    const repo = new AccountingRepository(testDb.scope);
    accounting = new AccountingService(repo, currency);
    const fiscal = new FiscalYearRepository(testDb.app);
    const ledger = new LedgerReportRepository(testDb.scope);
    reports = new FinancialReportsService(repo, fiscal, ledger);
    exporter = new ReportExportService(reports);
    years = new FiscalYearService(repo, fiscal, ledger, accounting);

    await new ChartTemplateService(repo).apply(COMPANY, 'iran-trading');
    yearId = (await years.create(COMPANY, { name: '1405', startDate: '2026-03-21', endDate: '2027-03-20' })).id;
    await accounting.importOpeningBalances(COMPANY, [
      { accountCode: '1011', debit: 1_000_000, date: '2026-03-21T12:00:00.000Z' },
      { accountCode: '3010', credit: 1_000_000, date: '2026-03-21T12:00:00.000Z' },
    ]);
    await pair(COMPANY, 'J02', '2026-04-01', '1012', '2110', '500000.00');
    await pair(COMPANY, 'J03', '2026-04-05', '1113', '1012', '300000.00');
    await pair(COMPANY, 'J04', '2026-04-10', '1030', '2010', '400000.00', 'SUP1');
    await post(COMPANY, 'J05', '2026-05-01', [
      { accountCode: '1020', debit: '1090000.50', partyCode: 'CUS1' },
      { accountCode: '4020', credit: '1000000.50' },
      { accountCode: '2020', credit: '90000.00' },
    ]);
    await pair(COMPANY, 'J06', '2026-05-01', '5110', '1030', '350000.00');
    await pair(COMPANY, 'J07', '2026-06-01', '5020', '1012', '100000.25');
    await pair(COMPANY, 'J08', '2026-09-01', '5060', '1120', '30000.00');
    await post(COMPANY, 'J09', '2026-10-01', [
      { accountCode: '1012', debit: '600000.00' },
      { accountCode: '1020', credit: '600000.00', partyCode: 'CUS1' },
    ]);
    await pair(COMPANY, 'J10', '2026-11-01', '1012', '3010', '200000.00');
    await pair(COMPANY, 'J11', '2027-03-01', '5220', '2021', '50000.00');
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  const statements = async (tenant: string, query: object) => ({
    sheet: await reports.balanceSheet(tenant, query),
    income: await reports.incomeStatement(tenant, query),
    cash: await reports.cashFlow(tenant, query),
    equity: await reports.equityChanges(tenant, query),
  });

  /** Every statement proves itself, and they agree with the trial balance and each other. */
  const expectReconciled = async (tenant: string, query: object) => {
    const { sheet, cash, equity, income } = await statements(tenant, query);
    for (const item of [...sheet.checks, ...cash.checks, ...equity.checks]) {
      expect({ key: item.key, left: item.left }).toEqual({ key: item.key, left: item.right });
    }
    const trial = await reports.trialBalance(tenant, { ...query, columns: 10, includeClosing: true });
    expect(trial.balanced).toBe(true);
    const net = trial.rows.reduce(
      (acc, row) => ({ debit: acc.debit + row.endingDebit, credit: acc.credit + row.endingCredit }),
      { debit: 0n, credit: 0n },
    );
    expect(net.debit).toBe(net.credit);
    expect(cash.netProfit).toBe(income.netProfit);
    return { sheet, cash, equity, income, trial };
  };

  const query = () => ({ fiscalYearId: yearId });

  it('produces exact statements for the sample company', async () => {
    const { sheet, income, cash, equity } = await expectReconciled(COMPANY, query());
    expect(income.revenue.total).toBe(rial('1000000.50'));
    expect(income.grossProfit).toBe(rial('650000.50'));
    expect(income.operatingProfit).toBe(rial('520000.25'));
    expect(income.netProfit).toBe(rial('470000.25'));
    expect(sheet.totalAssets).toBe(rial('2710000.25'));
    expect(sheet.totalLiabilities).toBe(rial('1040000.00'));
    expect(sheet.totalEquity).toBe(rial('1670000.25'));
    expect(sheet.inferredAccounts).toEqual([]);
    expect(cash.openingCash).toBe(rial('1000000.00'));
    expect(cash.operatingCash).toBe(rial('499999.75'));
    expect(cash.investing.total).toBe(rial('-300000.00'));
    expect(cash.financing.total).toBe(rial('700000.00'));
    expect(cash.closingCash).toBe(rial('1899999.75'));
    expect(equity.rows.find((r) => r.key === 'closing')).toMatchObject({
      capital: rial('1200000.00'),
      retainedEarnings: rial('470000.25'),
      total: rial('1670000.25'),
    });
  });

  it('shows 2 to 10 column trial balances with the right groups', async () => {
    for (const columns of [2, 4, 6, 8, 10] as const) {
      const report = await reports.trialBalance(COMPANY, { ...query(), columns });
      expect(report.groups.length * 2).toBe(columns);
      expect(report.balanced).toBe(true);
    }
    const eight = await reports.trialBalance(COMPANY, { ...query(), columns: 8, from: '2026-05-01' });
    const bank = eight.rows.find((r) => r.code === '1012')!;
    expect(bank.priorDebit).toBe(rial('500000.00'));
    expect(bank.priorCredit).toBe(rial('300000.00'));
    expect(bank.periodDebit).toBe(rial('800000.00'));
    const cash = eight.rows.find((r) => r.code === '1011')!;
    expect(cash.openingDebit).toBe(rial('1000000.00'));
    expect(eight.totals.openingDebit).toBe(eight.totals.openingCredit);
    expect(eight.totals.priorDebit).toBe(eight.totals.priorCredit);

    const kol = await reports.trialBalance(COMPANY, { ...query(), level: 'KOL' as never });
    expect(kol.rows.map((r) => r.code)).toEqual(['10', '11', '20', '21', '30', '40', '50', '51', '52']);
    expect(kol.balanced).toBe(true);

    const subtree = await reports.trialBalance(COMPANY, { ...query(), accountCode: '10' });
    expect(subtree.rows.length).toBeGreaterThan(0);
    expect(subtree.rows.every((r) => r.code.startsWith('10'))).toBe(true);
    await expect(reports.trialBalance(COMPANY, { ...query(), accountCode: 'NON_EXISTENT_9999' })).rejects.toThrow();
  });

  it('gives general and subsidiary ledgers that agree with the trial balance', async () => {
    const general = await reports.accountLedger(COMPANY, { ...query(), accountCode: '10', from: '2026-05-01' });
    expect(general.opening).toBe(rial('1600000.00'));
    expect(general.closing).toBe(general.lines[general.lines.length - 1].running);

    const customer = await reports.accountLedger(COMPANY, { ...query(), accountCode: '1020', partyCode: 'CUS1' });
    expect(customer.closing).toBe(rial('490000.50'));
    const parties = await reports.subsidiary(COMPANY, { ...query(), accountCode: '1020' });
    expect(parties.rows.map((r) => [r.code, r.endingDebit])).toEqual([['1020/CUS1', rial('490000.50')]]);
    const both = await reports.subsidiary(COMPANY, query());
    expect(both.rows.map((r) => r.code)).toEqual(['1020/CUS1', '1030/SUP1', '2010/SUP1']);
    expect(both.balanced).toBeNull();
    const cash = await reports.accountLedger(COMPANY, { ...query(), accountCode: '1011' });
    expect(cash.opening).toBe(rial('1000000.00'));
    expect(cash.lines).toEqual([]);
    const short = await reports.accountLedger(COMPANY, { ...query(), accountCode: '10', limit: 1 });
    expect(short.truncated).toBe(true);
    expect(short.closing).toBe(general.closing);
  });

  it('keeps every number after the close and carries balances into the next year', async () => {
    const before = await reports.balanceSheet(COMPANY, query());
    const income = await reports.incomeStatement(COMPANY, query());
    const closed = await years.close(COMPANY, 'u', yearId, {
      nextYear: { name: '1406', startDate: '2027-03-21', endDate: '2028-03-19' },
    });
    const after = await expectReconciled(COMPANY, query());
    expect(after.income.netProfit).toBe(income.netProfit);
    expect(after.sheet.totalAssets).toBe(before.totalAssets);
    expect(after.sheet.totalEquity).toBe(before.totalEquity);
    expect(after.sheet.equity.lines.map((l) => l.line)).toEqual(['CAPITAL', 'RETAINED_EARNINGS']);
    expect(after.equity.rows.find((r) => r.key === 'closing')!.retainedEarnings).toBe(rial('470000.25'));

    const nextId = closed.nextYear.id;
    await pair(COMPANY, 'N01', '2027-04-01', '1012', '4020', '1000.00');
    const next = await expectReconciled(COMPANY, { fiscalYearId: nextId });
    expect(next.income.netProfit).toBe(rial('1000.00'));
    expect(next.sheet.totalAssets).toBe(rial('2711000.25'));
    expect(next.cash.openingCash).toBe(rial('1899999.75'));
    expect(next.equity.rows[0].total).toBe(rial('1670000.25'));
    const trial = await reports.trialBalance(COMPANY, { fiscalYearId: nextId, columns: 6 });
    expect(trial.rows.find((r) => r.code === '4020')).toMatchObject({ openingCredit: 0n, periodCredit: rial('1000.00') });
    expect(trial.rows.find((r) => r.code === '3040')).toMatchObject({ openingCredit: rial('470000.25') });
  });

  it('reports imported data with no template and no fiscal year, two unclosed years included', async () => {
    await accounting.importAccounts(IMPORTED, [
      { code: 'A1', name: 'بانک ملت', accountType: AccountType.ASSET },
      { code: 'A2', name: 'مشتریان', accountType: AccountType.ASSET },
      { code: 'L1', name: 'بستانکاران تجاری', accountType: AccountType.LIABILITY },
      { code: 'E1', name: 'سرمایه ثبتی', accountType: AccountType.EQUITY },
      { code: 'R1', name: 'فروش', accountType: AccountType.REVENUE },
      { code: 'X1', name: 'هزینه آب و برق', accountType: AccountType.EXPENSE },
    ]);
    await pair(IMPORTED, 'I1', '2025-01-10', 'A1', 'E1', '1000.00');
    await pair(IMPORTED, 'I2', '2025-02-10', 'A2', 'R1', '300.00');
    await pair(IMPORTED, 'I3', '2026-02-10', 'X1', 'L1', '40.00');
    const period = { from: '2026-01-01', to: '2026-12-31' };
    const { sheet, income, cash } = await expectReconciled(IMPORTED, period);
    expect(income.netProfit).toBe(rial('-40.00'));
    expect(sheet.totalAssets).toBe(rial('1300.00'));
    expect(sheet.equity.lines.map((l) => [l.line, l.amount])).toEqual([
      ['CAPITAL', rial('1000.00')],
      ['EARLIER_EARNINGS', rial('300.00')],
      ['PERIOD_EARNINGS', rial('-40.00')],
    ]);
    expect(cash.closingCash).toBe(rial('1000.00'));
    expect(sheet.inferredAccounts.map((a) => a.line).sort()).toEqual(
      ['BANK', 'CAPITAL', 'OPERATING_EXPENSE', 'PAYABLE', 'RECEIVABLE', 'REVENUE'],
    );
  });

  it('builds the dashboard from the ledger and keeps companies apart', async () => {
    const board = await reports.dashboard(COMPANY, { to: '2027-03-20' });
    expect(board).toMatchObject({
      cash: rial('1000000.00'),
      bank: rial('899999.75'),
      receivables: rial('490000.50'),
      payables: rial('400000.00'),
      sales: rial('1000000.50'),
      taxDue: rial('140000.00'),
      inventory: rial('50000.00'),
    });
    expect((await reports.trialBalance(OTHER, { to: '2027-03-20' })).rows).toEqual([]);
    expect(moneyJson({ amount: rial('12.50'), count: 3 })).toEqual({ amount: 12.5, count: 3 });
  });

  it('exports each report as XLSX and PDF', async () => {
    const out = process.env.ROXIRA_REPORT_OUT;
    const cases = [
      ['trial-balance', { columns: 10 }],
      ['trial-balance', { columns: 4 }],
      ['subsidiary', { accountCode: '1020' }],
      ['ledger', { accountCode: '1012' }],
      ['balance-sheet', {}],
      ['income-statement', {}],
      ['cash-flow', {}],
      ['equity-changes', {}],
    ] as const;
    for (const [report, extra] of cases) {
      const base = { fiscalYearId: yearId, ...extra };
      const xlsx = await exporter.export(COMPANY, report, { ...base, format: 'xlsx' });
      const pdf = await exporter.export(COMPANY, report, { ...base, format: 'pdf' });
      expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
      expect(parseXlsx(xlsx.body).rows.length).toBeGreaterThan(2);
      if (out) {
        const name = `${report}${'columns' in extra ? `-${extra.columns}` : ''}`;
        fs.writeFileSync(path.join(out, `${name}.pdf`), pdf.body);
        fs.writeFileSync(path.join(out, `${name}.xlsx`), xlsx.body);
      }
    }
    const workbook = unzipSync((await exporter.export(COMPANY, 'balance-sheet', { fiscalYearId: yearId })).body);
    const sheet = strFromU8(workbook['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('rightToLeft="1"');
    expect(sheet).toContain('<v>2710000.25</v>');
  }, 60000);

  it('prints the legal journal and general ledger books, page-numbered and balanced (#249)', async () => {
    const journal = await reports.journalBook(COMPANY, { fiscalYearId: yearId });
    // Openings are in the journal; lines run by date and voucher, a voucher's lines together.
    expect(journal.lines[0].entryNumber).toMatch(/^OB-/);
    expect(journal.lines.filter((l) => l.entryNumber === 'J05').map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['1020', rial('1090000.50'), 0n],
      ['4020', 0n, rial('1000000.50')],
      ['2020', 0n, rial('90000.00')],
    ]);
    const sum = (key: 'debit' | 'credit') => journal.lines.reduce((total, line) => total + line[key], 0n);
    expect(sum('debit')).toBe(sum('credit'));

    const ledger = await reports.generalLedgerBook(COMPANY, { fiscalYearId: yearId });
    const kol = new Set(
      (await reports.chartOfAccounts(COMPANY)).filter((a) => a.level === 'KOL').map((a) => a.code),
    );
    expect(ledger.accounts.length).toBe(kol.size);
    expect(ledger.accounts.every((a) => kol.has(a.code))).toBe(true);
    // Every posting account sits under one کل account, so the closing balances of the book net to zero.
    const closing = ledger.accounts.reduce(
      (total, a) => total + a.opening + a.lines.reduce((s, l) => s + l.debit - l.credit, 0n),
      0n,
    );
    expect(closing).toBe(0n);

    for (const report of ['journal-book', 'general-ledger-book'] as const) {
      const pdf = await exporter.export(COMPANY, report, { fiscalYearId: yearId, format: 'pdf' });
      expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
      const xlsx = await exporter.export(COMPANY, report, { fiscalYearId: yearId, format: 'xlsx' });
      expect(strFromU8(unzipSync(xlsx.body)['xl/worksheets/sheet1.xml'])).toContain('rightToLeft="1"');
      if (process.env.ROXIRA_REPORT_OUT) {
        fs.writeFileSync(path.join(process.env.ROXIRA_REPORT_OUT, `${report}.pdf`), pdf.body);
      }
    }
    // Another company's books hold none of these lines.
    expect((await reports.journalBook(OTHER, { from: '2026-03-21', to: '2027-03-20' })).lines).toEqual([]);
  }, 60000);

  it('gives customer and supplier statements with running balance and ageing, per company (#242)', async () => {
    const rows = (statement: Awaited<ReturnType<FinancialReportsService['partyStatement']>>) =>
      statement.ledger.lines.map((l) => [l.entryNumber, l.debit, l.credit, l.running]);

    const customer = await reports.partyStatement(COMPANY, { fiscalYearId: yearId, partyCode: 'CUS1' });
    expect(customer.ledger.opening).toBe(0n);
    expect(rows(customer)).toEqual([
      ['J05', rial('1090000.50'), 0n, rial('1090000.50')],
      ['J09', 0n, rial('600000.00'), rial('490000.50')],
    ]);
    expect(customer.ledger.closing).toBe(rial('490000.50'));
    // Still open at the year end: 490,000.50 of the 2026-05-01 invoice, more than 90 days old.
    expect(customer.ageing.rows.map((r) => [r.partyCode, r.amounts])).toEqual([['CUS1', [0n, 0n, 0n, rial('490000.50')]]]);

    // A later date range starts from the balance brought forward.
    const later = await reports.partyStatement(COMPANY, { from: '2026-06-01', to: '2027-03-20', partyCode: 'CUS1' });
    expect(later.ledger.opening).toBe(rial('1090000.50'));
    expect(rows(later)).toEqual([['J09', 0n, rial('600000.00'), rial('490000.50')]]);

    const supplier = await reports.partyStatement(COMPANY, { fiscalYearId: yearId, partyCode: 'SUP1', side: 'payable' });
    expect(rows(supplier)).toEqual([['J04', 0n, rial('400000.00'), -rial('400000.00')]]);
    expect(supplier.ageing.rows[0].balance).toBe(rial('400000.00'));

    const xlsx = await exporter.export(COMPANY, 'party-statement', { fiscalYearId: yearId, partyCode: 'CUS1', format: 'xlsx' });
    expect(strFromU8(unzipSync(xlsx.body)['xl/worksheets/sheet1.xml'])).toContain('<v>490000.50</v>');
    const pdf = await exporter.export(COMPANY, 'party-statement', { fiscalYearId: yearId, partyCode: 'CUS1', format: 'pdf' });
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');

    // Another company with the same party code sees only its own lines, and does not change ours.
    await new ChartTemplateService(new AccountingRepository(testDb.scope)).apply(OTHER, 'iran-trading');
    await pair(OTHER, 'X01', '2026-05-01', '1020', '4020', '7.00', 'CUS1');
    const other = await reports.partyStatement(OTHER, { from: '2026-03-21', to: '2027-03-20', partyCode: 'CUS1' });
    expect(rows(other)).toEqual([['X01', rial('7.00'), 0n, rial('7.00')]]);
    expect((await reports.partyStatement(COMPANY, { fiscalYearId: yearId, partyCode: 'CUS1' })).ledger.closing).toBe(
      rial('490000.50'),
    );
  }, 60000);

  it('computes trial balance in < 2 s over 100k vouchers seeded with generate_series (#230)', async () => {
    const PERF_TENANT = '77777777-7777-4777-8777-777777777777';
    const repo = new AccountingRepository(testDb.scope);
    await new ChartTemplateService(repo).apply(PERF_TENANT, 'iran-trading');
    await years.create(PERF_TENANT, { name: '1405', startDate: '2026-03-21', endDate: '2027-03-20' });

    // Seed 100,000 POSTED vouchers with 2 balanced lines each using generate_series
    await testDb.owner.query("SET session_replication_role = 'replica'");
    try {
      await testDb.owner.query(
        `INSERT INTO fin_journal_entries (tenant_id, entry_number, permanent_number, date, description, status, entry_type)
         SELECT $1::uuid, 'PV-' || lpad(g::text, 6, '0'), g,
                TIMESTAMPTZ '2026-03-21' + ((g % 350) * interval '1 day') + interval '10 hours',
                'Perf voucher ' || g, 'POSTED', 'NORMAL'
         FROM generate_series(1, 100000) AS g`,
        [PERF_TENANT],
      );

      await testDb.owner.query(
        `WITH e AS (
           SELECT id, tenant_id, right(entry_number, 6)::int AS n
           FROM fin_journal_entries
           WHERE tenant_id = $1::uuid AND entry_number LIKE 'PV-%'
         )
         INSERT INTO fin_journal_entry_lines (tenant_id, journal_entry_id, account_id, debit, credit, currency, description)
         SELECT e.tenant_id, e.id, a.id, s.debit, s.credit, 'IRR', s.d
         FROM e
         CROSS JOIN LATERAL (VALUES
           ('1011', ((e.n % 10) * 1000000 + 100000)::numeric(18,2), 0::numeric(18,2), 'بدهکار'),
           ('4020', 0::numeric(18,2), ((e.n % 10) * 1000000 + 100000)::numeric(18,2), 'بستانکار')
         ) AS s(code, debit, credit, d)
         JOIN fin_chart_of_accounts a ON a.tenant_id = e.tenant_id AND a.code = s.code`,
        [PERF_TENANT],
      );
    } finally {
      await testDb.owner.query("SET session_replication_role = 'origin'");
    }

    const start = Date.now();
    const trial = await reports.trialBalance(PERF_TENANT, { from: '2026-03-21', to: '2027-03-20', columns: 6 });
    const durationMs = Date.now() - start;

    expect(durationMs).toBeLessThan(2000);
    expect(trial.balanced).toBe(true);
    expect(trial.totals.periodDebit).toBeGreaterThan(0n);
    expect(trial.totals.periodDebit).toBe(trial.totals.periodCredit);
  }, 120000);
});
