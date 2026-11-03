import { strFromU8, unzipSync } from 'fflate';
import { ExportReportQueryDto } from '../dto/report.dto';
import { FinancialReportsService } from '../services/financial-reports.service';
import { ReportExportService } from '../services/report-export.service';
import { ageing, AgeingLine } from './ageing';
import { writePdf } from './pdf-writer';
import { ageingTable } from './report-tables';
import { writeXlsx } from './xlsx-writer';

const line = (day: string, debit: bigint, credit: bigint, partyCode: string | null): AgeingLine => ({
  accountCode: '1301',
  accountName: 'حساب‌های دریافتنی تجاری',
  partyCode,
  day,
  debit,
  credit,
});

const report = ageing(
  [
    line('2026-06-01', 100000n, 0n, 'C1'),
    line('2026-10-20', 25025n, 0n, 'C1'),
    line('2026-10-01', 0n, 5000n, 'C2'),
    line('2026-09-01', 700n, 0n, null),
  ],
  { side: 'receivable', asOf: '2026-11-01' },
);

describe('ageingTable', () => {
  const table = ageingTable(report);

  it('has one column per bucket plus advance and balance, and a total row', () => {
    expect(table.title).toBe('گزارش سنی حساب‌های دریافتنی');
    expect(table.columns.map((column) => column.title)).toEqual([
      'حساب',
      'نام حساب',
      'تفصیلی',
      'قدیمی‌ترین قلم باز',
      '0 تا 30 روز',
      '31 تا 60 روز',
      '61 تا 90 روز',
      'بیش از 90 روز',
      'پیش‌دریافت',
      'مانده',
    ]);
    expect(table.rows).toHaveLength(report.rows.length + 1);
    for (const row of table.rows) {
      expect(row.cells).toHaveLength(table.columns.length);
    }
  });

  it('carries exact amounts and labels lines without a party', () => {
    const [c1, c2, none, total] = table.rows;
    expect(c1.cells.slice(2)).toEqual(['C1', expect.any(String), 25025n, 0n, 0n, 100000n, 0n, 125025n]);
    expect(c2.cells.slice(2)).toEqual(['C2', '', 0n, 0n, 0n, 0n, 5000n, -5000n]);
    expect(none.cells[2]).toBe('بدون تفصیلی');
    expect(total.bold).toBe(true);
    expect(total.cells.slice(-1)).toEqual([125025n - 5000n + 700n]);
  });

  it('names the payable side', () => {
    const payable = ageingTable(ageing([], { side: 'payable', asOf: '2026-11-01' }));
    expect(payable.title).toBe('گزارش سنی حساب‌های پرداختنی');
    expect(payable.columns.map((column) => column.title)).toContain('پیش‌پرداخت');
  });

  it('renders to xlsx and pdf', async () => {
    const files = unzipSync(writeXlsx(table));
    const strings = strFromU8(files['xl/sharedStrings.xml'] ?? files['xl/worksheets/sheet1.xml']);
    expect(strings).toContain('بدون تفصیلی');
    const pdf = await writePdf(table);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('ReportExportService ageing', () => {
  it('passes the ageing filters through and names the file', async () => {
    const ageingCall = jest.fn().mockResolvedValue({ ...report, accountCodes: ['1301'] });
    const exporter = new ReportExportService({ ageing: ageingCall } as unknown as FinancialReportsService);
    const query = {
      side: 'payable',
      to: '2026-11-01',
      accountCode: '31',
      partyCode: 'S1',
      edges: [15, 45],
      format: 'xlsx',
    } as ExportReportQueryDto;
    const file = await exporter.export('t', 'ageing', query);
    expect(ageingCall).toHaveBeenCalledWith('t', {
      side: 'payable',
      to: '2026-11-01',
      accountCode: '31',
      partyCode: 'S1',
      edges: [15, 45],
    });
    expect(file.filename).toBe('ageing.xlsx');
  });
});
