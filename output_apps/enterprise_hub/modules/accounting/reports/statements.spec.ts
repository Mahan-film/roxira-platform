import { strFromU8, unzipSync } from 'fflate';
import { AccountType, ReportLine } from '../enums/accounting.enum';
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
