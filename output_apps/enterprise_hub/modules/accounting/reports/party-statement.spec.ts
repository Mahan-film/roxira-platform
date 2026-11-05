import { BadRequestException } from '@nestjs/common';
import { AccountType } from '../enums/accounting.enum';
import { AccountingRepository } from '../repositories/accounting.repository';
import { FiscalYearRepository } from '../repositories/fiscal-year.repository';
import { AgeingLineRow, LedgerLineRow, LedgerReportRepository } from '../repositories/ledger-report.repository';
import { FinancialReportsService } from '../services/financial-reports.service';
import { ReportExportService } from '../services/report-export.service';
import { partyStatementTable } from './report-tables';

const TENANT = '00000000-0000-0000-0000-000000000001';

const accounts = [
  { id: 2, code: '1301', name: 'حساب‌های دریافتنی تجاری', accountType: AccountType.ASSET, parentCode: null },
  { id: 3, code: '1101', name: 'صندوق', accountType: AccountType.ASSET, parentCode: null },
  { id: 4, code: '3101', name: 'حساب‌های پرداختنی تجاری', accountType: AccountType.LIABILITY, parentCode: null },
];

const line = (id: number, day: string, debit: string, credit: string, accountCode = '1301'): LedgerLineRow => ({
  id,
  journalEntryId: id,
  entryNumber: `S-${id}`,
  date: new Date(`${day}T12:00:00.000Z`),
  accountCode,
  accountName: accountCode === '1301' ? 'حساب‌های دریافتنی تجاری' : 'حساب‌های پرداختنی تجاری',
  partyCode: 'C-7',
  description: `سند ${id}`,
  debit,
  credit,
});
const age = (day: string, debit: string, credit: string, accountCode = '1301'): AgeingLineRow => ({
  accountCode,
  accountName: 'x',
  partyCode: 'C-7',
  day,
  debit,
  credit,
});

function setup(opts: { opening: string; lines: LedgerLineRow[]; ageing: AgeingLineRow[] }) {
  const ledger = {
    ledgerTotals: jest.fn().mockImplementation(async () => {
      const debit = opts.lines.reduce((s, l) => s + Number(l.debit) * 100, 0) / 100;
      const credit = opts.lines.reduce((s, l) => s + Number(l.credit) * 100, 0) / 100;
      return { opening: opts.opening, debit: debit.toFixed(2), credit: credit.toFixed(2), count: String(opts.lines.length) };
    }),
    ledgerLines: jest.fn().mockResolvedValue(opts.lines),
    ageingLines: jest.fn().mockResolvedValue(opts.ageing),
    firstEntryDay: jest.fn().mockResolvedValue('2026-03-21'),
  };
  const service = new FinancialReportsService(
    { findAllAccounts: jest.fn().mockResolvedValue(accounts) } as unknown as AccountingRepository,
    { findContaining: jest.fn().mockResolvedValue(null), find: jest.fn() } as unknown as FiscalYearRepository,
    ledger as unknown as LedgerReportRepository,
  );
  return { service, ledger };
}

describe('FinancialReportsService.partyStatement', () => {
  it('a customer: receivable accounts, party filter, running balance and ageing at the period end', async () => {
    const { service, ledger } = setup({
      opening: '1000.00',
      lines: [line(1, '2026-09-01', '5000.50', '0.00'), line(2, '2026-10-20', '0.00', '2000.00')],
      ageing: [age('2026-08-01', '1000.00', '0.00'), age('2026-09-01', '5000.50', '0.00'), age('2026-10-20', '0.00', '2000.00')],
    });
    const report = await service.partyStatement(TENANT, { partyCode: 'C-7', from: '2026-09-01', to: '2026-11-01' });
    expect(ledger.ledgerLines).toHaveBeenCalledWith(TENANT, expect.objectContaining({ accountIds: [2], partyCode: 'C-7', from: '2026-09-01', to: '2026-11-01' }));
    expect(ledger.ageingLines).toHaveBeenCalledWith(TENANT, { accountIds: [2], to: '2026-11-01', partyCode: 'C-7' });
    expect(report.accountCodes).toEqual(['1301']);
    expect(report.ledger.opening).toBe(100000n);
    expect(report.ledger.lines.map((l) => l.running)).toEqual([600050n, 400050n]);
    expect(report.ledger.closing).toBe(400050n);
    expect(report.ageing.totals.balance).toBe(report.ledger.closing);

    const table = partyStatementTable(report);
    expect(table.title).toBe('صورت‌حساب مشتری C-7');
    const balances = table.rows.map((row) => row.cells[6]);
    expect(balances.slice(0, 4)).toEqual([100000n, 600050n, 400050n, 400050n]);
    // Buckets 0-30, 31-60, 61-90, 91+ at 1405/08/10: the 2,000 payment settles the oldest item first.
    expect(table.rows.slice(5).map((row) => row.cells[6])).toEqual([0n, 0n, 400050n, 0n]);
  });

  it('a supplier: payable accounts, balances shown positive on the credit side', async () => {
    const { service } = setup({
      opening: '0.00',
      lines: [line(1, '2026-10-01', '0.00', '3000.00', '3101'), line(2, '2026-10-10', '1000.00', '0.00', '3101')],
      ageing: [age('2026-10-01', '0.00', '3000.00', '3101'), age('2026-10-10', '1000.00', '0.00', '3101')],
    });
    const report = await service.partyStatement(TENANT, { partyCode: 'C-7', side: 'payable', from: '2026-10-01', to: '2026-11-01' });
    expect(report.accountCodes).toEqual(['3101']);
    const table = partyStatementTable(report);
    expect(table.title).toBe('صورت‌حساب تأمین‌کننده C-7');
    expect(table.rows.map((row) => row.cells[6]).slice(0, 4)).toEqual([0n, 300000n, 200000n, 200000n]);
    // 1405/07/09 is 31 days before 1405/08/10: the open 2,000 is in the 31-60 bucket.
    expect(table.rows.slice(5).map((row) => row.cells[6])).toEqual([0n, 200000n, 0n, 0n]);
  });

  it('shows an advance (overpayment) as a negative line under the buckets', async () => {
    const { service } = setup({
      opening: '0.00',
      lines: [line(1, '2026-10-01', '0.00', '500.00')],
      ageing: [age('2026-10-01', '0.00', '500.00')],
    });
    const table = partyStatementTable(await service.partyStatement(TENANT, { partyCode: 'C-7', to: '2026-11-01' }));
    const last = table.rows[table.rows.length - 1];
    expect(last.cells[3]).toBe('پیش‌دریافت');
    expect(last.cells[6]).toBe(-50000n);
  });

  it('refuses when the chart has no account on that side', async () => {
    const { service } = setup({ opening: '0.00', lines: [], ageing: [] });
    (service as unknown as { accounting: { findAllAccounts: jest.Mock } }).accounting.findAllAccounts.mockResolvedValue([accounts[1]]);
    await expect(service.partyStatement(TENANT, { partyCode: 'C-7', to: '2026-11-01' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('party-statement export', () => {
  it('needs a party code', async () => {
    const exporter = new ReportExportService({} as FinancialReportsService);
    await expect(exporter.export(TENANT, 'party-statement', {})).rejects.toBeInstanceOf(BadRequestException);
  });
});
