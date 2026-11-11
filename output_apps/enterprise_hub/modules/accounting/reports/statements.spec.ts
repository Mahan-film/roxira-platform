import { strFromU8, unzipSync } from 'fflate';
import { NotFoundException } from '@nestjs/common';
import { AccountLevel, AccountType, ReportLine } from '../enums/accounting.enum';
import { FinancialReportsService } from '../services/financial-reports.service';
import { formatMoney, writePdf } from './pdf-writer';
import { ReportTable } from './report-table';
import {
  AccountBalance,
  balanceSheet,
  cashFlow,
  classify,
  equityChanges,
  incomeStatement,
  ReportAccount,
  trialBalanceRows,
} from './statements';
import { writeXlsx } from './xlsx-writer';

const account = (code: string, name: string, accountType: AccountType, reportLine: ReportLine | null = null): ReportAccount => ({
  id: Number(code),
  code,
  name,
  accountType,
  level: null,
  parentCode: null,
  reportLine,
});

const balance = (a: ReportAccount, period: bigint, opening = 0n): AccountBalance => ({
  account: a,
  ...classify(a),
  opening,
  priorDebit: 0n,
  priorCredit: 0n,
  periodDebit: period > 0n ? period : 0n,
  periodCredit: period < 0n ? -period : 0n,
  closeDebit: 0n,
  closeCredit: 0n,
});

describe('statements', () => {
  const cash = account('1', 'صندوق', AccountType.ASSET);
  const bank = account('2', 'بانک ملت', AccountType.ASSET);
  const capital = account('3', 'سرمایه', AccountType.EQUITY);
  const sales = account('4', 'فروش', AccountType.REVENUE);
  const rent = account('5', 'هزینه اجاره', AccountType.EXPENSE);
  const balances = [
    balance(cash, 100n, 1000n),
    balance(bank, 50n),
    balance(capital, -30n, -1000n),
    balance(sales, -150n),
    balance(rent, 30n),
  ];

  it('classifies imported accounts from their name and type, and keeps a set line', () => {
    expect(classify(bank)).toEqual({ line: ReportLine.BANK, inferred: true });
    expect(classify(account('9', 'صندوق', AccountType.ASSET, ReportLine.BANK))).toEqual({
      line: ReportLine.BANK,
      inferred: false,
    });
  });

  it('puts a non-operating expense below operating profit', () => {
    const other = account('6', 'هزینه‌های غیرعملیاتی', AccountType.EXPENSE);
    const statement = incomeStatement([balance(sales, -150n), balance(other, 100n)]);
    expect(statement.operatingProfit).toBe(150n);
    expect(statement.nonOperating.total).toBe(-100n);
    expect(statement.netProfit).toBe(50n);
  });

  it('reconciles all statements exactly', () => {
    expect(incomeStatement(balances).netProfit).toBe(120n);
    const sheet = balanceSheet(balances);
    expect(sheet.totalAssets).toBe(1150n);
    expect(sheet.totalEquity).toBe(1150n);
    expect(sheet.checks.every((c) => c.ok)).toBe(true);
    const flow = cashFlow(balances);
    expect(flow.netChange).toBe(150n);
    expect(flow.checks.every((c) => c.ok)).toBe(true);
    expect(equityChanges(balances).checks.every((c) => c.ok)).toBe(true);
  });

  it('nets the opening onto one side of the trial balance', () => {
    const rows = trialBalanceRows(balances, []);
    expect(rows.find((r) => r.code === '3')).toMatchObject({ openingCredit: 1000n, endingCredit: 1030n, endingDebit: 0n });
    const sum = (key: 'endingDebit' | 'endingCredit') => rows.reduce((t, r) => t + r[key], 0n);
    expect(sum('endingDebit')).toBe(sum('endingCredit'));
  });

  it('rolls up hierarchical accounts for multi-level account review drill-down (kol -> moein)', () => {
    const kolAssets: ReportAccount = {
      id: 10,
      code: '10',
      name: 'دارایی‌های جاری',
      accountType: AccountType.ASSET,
      level: AccountLevel.KOL,
      parentCode: null,
      reportLine: null,
    };
    const moeinCash: ReportAccount = {
      id: 1010,
      code: '1010',
      name: 'موجودی نقد و بانک',
      accountType: AccountType.ASSET,
      level: AccountLevel.MOEIN,
      parentCode: '10',
      reportLine: null,
    };
    const moeinReceivable: ReportAccount = {
      id: 1020,
      code: '1020',
      name: 'حساب‌های دریافتنی',
      accountType: AccountType.ASSET,
      level: AccountLevel.MOEIN,
      parentCode: '10',
      reportLine: null,
    };
    const tafsiliCash: ReportAccount = {
      id: 10101,
      code: '10101',
      name: 'صندوق مرکزی',
      accountType: AccountType.ASSET,
      level: AccountLevel.TAFSILI,
      parentCode: '1010',
      reportLine: null,
    };
    const tafsiliBank: ReportAccount = {
      id: 10102,
      code: '10102',
      name: 'بانک ملت',
      accountType: AccountType.ASSET,
      level: AccountLevel.TAFSILI,
      parentCode: '1010',
      reportLine: null,
    };
    const tafsiliCustomer: ReportAccount = {
      id: 10201,
      code: '10201',
      name: 'مشتری الف',
      accountType: AccountType.ASSET,
      level: AccountLevel.TAFSILI,
      parentCode: '1020',
      reportLine: null,
    };

    const accounts = [kolAssets, moeinCash, moeinReceivable, tafsiliCash, tafsiliBank, tafsiliCustomer];
    const treeBalances = [
      balance(tafsiliCash, 500n, 100n),
      balance(tafsiliBank, 300n, 200n),
      balance(tafsiliCustomer, 400n, 50n),
    ];

    // Kol level review
    const kolRows = trialBalanceRows(treeBalances, accounts, { level: AccountLevel.KOL });
    expect(kolRows).toHaveLength(1);
    expect(kolRows[0].code).toBe('10');
    expect(kolRows[0].openingDebit).toBe(350n);
    expect(kolRows[0].periodDebit).toBe(1200n);
    expect(kolRows[0].endingDebit).toBe(1550n);

    // Moein level review (drill down from Kol)
    const moeinRows = trialBalanceRows(treeBalances, accounts, { level: AccountLevel.MOEIN });
    expect(moeinRows).toHaveLength(2);
    const cashRow = moeinRows.find((r) => r.code === '1010')!;
    const recRow = moeinRows.find((r) => r.code === '1020')!;
    expect(cashRow.openingDebit).toBe(300n);
    expect(cashRow.periodDebit).toBe(800n);
    expect(cashRow.endingDebit).toBe(1100n);
    expect(recRow.openingDebit).toBe(50n);
    expect(recRow.periodDebit).toBe(400n);
    expect(recRow.endingDebit).toBe(450n);
  });

  it('filters trialBalance by account subtree in FinancialReportsService and rejects unknown code with 404', async () => {
    const kolAssets: ReportAccount = {
      id: 10,
      code: '10',
      name: 'دارایی‌های جاری',
      accountType: AccountType.ASSET,
      level: AccountLevel.KOL,
      parentCode: null,
      reportLine: null,
    };
    const moeinCash: ReportAccount = {
      id: 1010,
      code: '1010',
      name: 'موجودی نقد و بانک',
      accountType: AccountType.ASSET,
      level: AccountLevel.MOEIN,
      parentCode: '10',
      reportLine: null,
    };
    const kolLiab: ReportAccount = {
      id: 20,
      code: '20',
      name: 'بدهی‌های جاری',
      accountType: AccountType.LIABILITY,
      level: AccountLevel.KOL,
      parentCode: null,
      reportLine: null,
    };
    const moeinPayable: ReportAccount = {
      id: 2010,
      code: '2010',
      name: 'حساب‌های پرداختنی',
      accountType: AccountType.LIABILITY,
      level: AccountLevel.MOEIN,
      parentCode: '20',
      reportLine: null,
    };

    const service = new FinancialReportsService({} as never, {} as never, {} as never);
    jest.spyOn(service as never, 'resolvePeriod').mockResolvedValue({
      start: '2026-03-21T00:00:00.000Z',
      end: '2027-03-20T23:59:59.999Z',
      from: '2026-03-21',
      to: '2027-03-20',
      yearId: 1,
      yearName: '1405',
    } as never);
    jest.spyOn(service as never, 'balances').mockResolvedValue({
      accounts: [kolAssets, moeinCash, kolLiab, moeinPayable],
      balances: [
        balance(moeinCash, 800n, 300n),
        balance(moeinPayable, -500n, -200n),
      ],
    } as never);

    // Subtree filtering under '10' includes only '10' and its children
    const tb = await service.trialBalance('tenant-1', {
      columns: 6,
      accountCode: '10',
    });
    expect(tb.rows.length).toBeGreaterThan(0);
    expect(tb.rows.every((r) => r.code.startsWith('10'))).toBe(true);
    expect(tb.rows.some((r) => r.code.startsWith('20'))).toBe(false);

    // Unknown account code throws NotFoundException (404)
    await expect(
      service.trialBalance('tenant-1', {
        columns: 6,
        accountCode: 'NON_EXISTENT_9999',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('export', () => {
  const table: ReportTable = {
    title: 'گزارش <آزمایشی> & نمونه',
    subtitle: 'از ۱۴۰۵/۱/۱',
    columns: [{ title: 'شرح', width: 2 }, { title: 'مبلغ', money: true }],
    rows: [{ cells: ['=HYPERLINK("x")', -123456n], bold: true }, { cells: ['خالی', null] }],
  };

  it('formats exact money in Persian, negatives in brackets', () => {
    expect(formatMoney(123456700n)).toBe('۱٬۲۳۴٬۵۶۷');
    expect(formatMoney(-123456n)).toBe('(۱٬۲۳۴٫۵۶)');
  });

  it('writes a right-to-left workbook where text can never run as a formula', () => {
    const files = unzipSync(writeXlsx(table));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('rightToLeft="1"');
    expect(sheet).toContain('<v>-1234.56</v>');
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('&lt;آزمایشی&gt; &amp; نمونه');
  });

  it('writes a PDF, wide tables in landscape', async () => {
    const wide = { ...table, columns: Array.from({ length: 10 }, () => ({ title: 'ستون' })), rows: [] };
    const pdf = await writePdf(wide);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
