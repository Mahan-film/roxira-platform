import { normaliseEnumValue } from '../../data_import/normaliser/normalise';
import { parseXlsx } from '../../data_import/parsers/xlsx.parser';
import { AccountingAccountsRegistry } from '../../data_import/registry/accounting-accounts.registry';
import { locateHeaderRow, scoreEntityHeaders } from '../../data_import/registry/entity-detect';
import { AccountLevel, AccountType } from '../enums/accounting.enum';
import { FinancialReportsService } from '../services/financial-reports.service';
import { AccountingService } from '../services/accounting.service';
import { ReportExportService } from '../services/report-export.service';
import { writePdf } from './pdf-writer';
import { ChartAccountRow, chartOfAccountsTable } from './report-tables';
import { writeXlsx } from './xlsx-writer';

const accounts: ChartAccountRow[] = [
  { code: '3101', name: 'حساب‌های پرداختنی تجاری', accountType: AccountType.LIABILITY, level: AccountLevel.MOEIN, parentCode: '31', currency: 'IRR' },
  { code: '1', name: 'دارایی‌های جاری', accountType: AccountType.ASSET, level: AccountLevel.GROUP, parentCode: null, currency: 'IRR' },
  { code: '5101', name: 'هزینه حقوق', accountType: AccountType.EXPENSE, level: null, parentCode: null, currency: 'IRR' },
  { code: '4101', name: 'فروش کالا', accountType: AccountType.REVENUE, level: AccountLevel.MOEIN, parentCode: '41', currency: 'USD' },
  { code: '2101', name: 'سرمایه ثبت‌شده', accountType: AccountType.EQUITY, level: AccountLevel.KOL, parentCode: '21', currency: 'IRR' },
];

describe('chartOfAccountsTable', () => {
  const table = chartOfAccountsTable(accounts);

  it('lists every account by code with Persian type and level', () => {
    expect(table.subtitle).toBe('5 حساب');
    expect(table.rows.map((row) => row.cells[0])).toEqual(['1', '2101', '3101', '4101', '5101']);
    expect(table.rows[0].cells).toEqual(['1', 'دارایی‌های جاری', 'دارایی', 'IRR', 'گروه', '']);
    expect(table.rows[4].cells.slice(2)).toEqual(['هزینه', 'IRR', '', '']);
  });

  it('renders to pdf', async () => {
    expect((await writePdf(table)).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('chart of accounts xlsx imports back', () => {
  // The real import path: parse with the registry's header locator, then match headers and enums.
  const registry = new AccountingAccountsRegistry({} as AccountingService);
  const parsed = parseXlsx(writeXlsx(chartOfAccountsTable(accounts)), (rows) => locateHeaderRow(rows, [registry]));

  it('finds the header row under the title and maps all importer fields', () => {
    expect(parsed.headers.slice(0, 4)).toEqual(['کد حساب', 'نام حساب', 'ماهیت حساب', 'واحد پول']);
    expect(scoreEntityHeaders(parsed.headers, registry)).toBe(registry.fields.length);
    expect(parsed.rows).toHaveLength(accounts.length);
  });

  it('maps every exported account type back to the same enum value', () => {
    const typeField = registry.fields.find((field) => field.key === 'accountType')!;
    const byCode = new Map(accounts.map((account) => [account.code, account.accountType]));
    for (const row of parsed.rows) {
      expect(normaliseEnumValue(row[2], typeField)).toBe(byCode.get(row[0]));
    }
  });
});

describe('ReportExportService chart-of-accounts', () => {
  it('exports the tenant chart', async () => {
    const chartOfAccounts = jest.fn().mockResolvedValue(accounts);
    const exporter = new ReportExportService({ chartOfAccounts } as unknown as FinancialReportsService);
    const file = await exporter.export('t', 'chart-of-accounts', { format: 'pdf' });
    expect(chartOfAccounts).toHaveBeenCalledWith('t');
    expect(file).toMatchObject({ filename: 'chart-of-accounts.pdf', contentType: 'application/pdf' });
  });
});
