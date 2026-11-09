import { readGrid } from '../parse/statement-parser';
import { BankItem, BookItem } from '../matching/matcher';
import {
  buildReconciliationStatement,
  reportToCsv,
  reportToHtml,
  reportToXlsx,
} from './reconciliation-report';

const bank = (id: number, direction: 'in' | 'out', rial: number, description = 'x'): BankItem => ({
  id,
  date: '2024-10-05',
  amount: BigInt(rial) * 100n,
  direction,
  reference: '9001',
  chequeNo: null,
  sayadId: null,
  description,
});
const book = (id: number, direction: 'in' | 'out', rial: number, text = 'y'): BookItem => ({
  id,
  date: '2024-10-04',
  amount: BigInt(rial) * 100n,
  direction,
  entryNumber: `JV-${id}`,
  text,
});

describe('reconciliation statement', () => {
  // Bank 1,000 + transit 200 - outstanding 50 = 1,150. Book 1,080 + bank-only deposit 100 - fee 30 = 1,150.
  const report = buildReconciliationStatement({
    bankAccountName: 'ملت - جاری',
    periodFrom: '2024-09-22',
    periodTo: '2024-10-06',
    bankBalance: 1_000n * 100n,
    ledgerBalance: 1_080n * 100n,
    unmatchedBook: [book(1, 'in', 200), book(2, 'out', 50)],
    unmatchedBank: [bank(3, 'in', 100), bank(4, 'out', 30)],
  });

  it('adjusts both sides with outstanding items and reaches a zero difference', () => {
    expect(report.adjustedBank).toBe(1_150n * 100n);
    expect(report.adjustedBook).toBe(1_150n * 100n);
    expect(report.difference).toBe(0n);
    expect(report.unresolvedCount).toBe(4);
  });

  it('shows a non-zero difference when something is unexplained', () => {
    const off = buildReconciliationStatement({
      bankAccountName: 'a',
      periodFrom: '2024-09-22',
      periodTo: '2024-10-06',
      bankBalance: 1_000n * 100n,
      ledgerBalance: 900n * 100n,
      unmatchedBook: [],
      unmatchedBank: [],
    });
    expect(off.difference).toBe(100n * 100n);
  });

  it('exports an Excel file that our own reader opens and that contains the figures', () => {
    const file = readGrid(reportToXlsx(report), 'report.xlsx');
    expect(file.kind).toBe('xlsx');
    const text = file.grid.flat().join('|');
    expect(text).toContain('مانده تعدیل‌شده بانک');
    expect(text).toContain('1150');
    expect(text).toContain('JV-1');
  });

  it('CSV neutralises spreadsheet formulas in untrusted descriptions', () => {
    const hostile = buildReconciliationStatement({
      bankAccountName: 'a',
      periodFrom: '2024-09-22',
      periodTo: '2024-10-06',
      bankBalance: 0n,
      ledgerBalance: 0n,
      unmatchedBook: [
        book(1, 'in', 10, '+PLUS_CMD'),
        book(2, 'out', 20, '-NON_NUMERIC'),
        book(3, 'in', 30, '@AT_FORMULA'),
        book(4, 'out', 40, '\tTAB_PREFIX'),
      ],
      unmatchedBank: [bank(9, 'in', 5, '=cmd|\' /C calc\'!A0')],
    });
    const csv = reportToCsv(hostile);
    expect(csv).toContain("'=cmd");
    expect(csv).not.toMatch(/(^|,)=cmd/m);
    expect(csv).toContain("'+PLUS_CMD");
    expect(csv).toContain("'-NON_NUMERIC");
    expect(csv).toContain("'@AT_FORMULA");
    expect(csv).toContain("'\tTAB_PREFIX");

    // XLSX also neutralises formulas
    const xlsxBuf = reportToXlsx(hostile);
    expect(xlsxBuf).toBeInstanceOf(Buffer);
  });

  it('HTML escapes statement text', () => {
    const hostile = buildReconciliationStatement({
      bankAccountName: '<script>alert(1)</script>',
      periodFrom: '2024-09-22',
      periodTo: '2024-10-06',
      bankBalance: 0n,
      ledgerBalance: 0n,
      unmatchedBook: [],
      unmatchedBank: [bank(9, 'in', 5, '<img src=x onerror=alert(1)>')],
    });
    const html = reportToHtml(hostile);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain("default-src 'none'");
  });
});
