import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountType, ReportLine } from './enums/accounting.enum';
import { AccountingRepository } from './repositories/accounting.repository';
import { FiscalYearRepository } from './repositories/fiscal-year.repository';
import { AgeingLineRow, LedgerReportRepository } from './repositories/ledger-report.repository';
import { FinancialReportsService } from './services/financial-reports.service';

const TENANT = '00000000-0000-0000-0000-000000000001';

const accounts = [
  { id: 1, code: '13', name: 'حساب‌ها و اسناد دریافتنی', accountType: AccountType.ASSET, parentCode: null },
  { id: 2, code: '1301', name: 'حساب‌های دریافتنی تجاری', accountType: AccountType.ASSET, parentCode: '13' },
  { id: 3, code: '1101', name: 'صندوق', accountType: AccountType.ASSET, parentCode: null },
  { id: 4, code: '3101', name: 'حساب‌های پرداختنی تجاری', accountType: AccountType.LIABILITY, parentCode: null },
  { id: 5, code: '1990', name: 'طلب از شرکا', accountType: AccountType.ASSET, parentCode: null, reportLine: ReportLine.RECEIVABLE },
];

function setup(rows: AgeingLineRow[] = []) {
  const ageingLines = jest.fn().mockResolvedValue(rows);
  const service = new FinancialReportsService(
    { findAllAccounts: jest.fn().mockResolvedValue(accounts) } as unknown as AccountingRepository,
    {} as FiscalYearRepository,
    { ageingLines } as unknown as LedgerReportRepository,
  );
  return { service, ageingLines };
}

const row = (day: string, debit: string, credit: string, partyCode: string | null = 'C1'): AgeingLineRow => ({
  accountCode: '1301',
  accountName: 'حساب‌های دریافتنی تجاری',
  partyCode,
  day,
  debit,
  credit,
});

describe('FinancialReportsService.ageing', () => {
  it('selects receivable accounts by statement line (set or inferred) and ages exact amounts', async () => {
    const { service, ageingLines } = setup([
      row('2026-06-01', '1000000.50', '0.00'),
      row('2026-10-15', '250.25', '0.00'),
      row('2026-10-20', '0.00', '400.00'),
    ]);
    const report = await service.ageing(TENANT, { to: '2026-11-01' });
    expect(ageingLines).toHaveBeenCalledWith(TENANT, { accountIds: [1, 2, 5], to: '2026-11-01', partyCode: undefined });
    expect(report.accountCodes).toEqual(['13', '1301', '1990']);
    expect(report.side).toBe('receivable');
    // 1,000,000.50 - 400 left in the 91+ bucket (153 days), 250.25 in 0-30.
    expect(report.rows[0].amounts).toEqual([25025n, 0n, 0n, 99960050n]);
    expect(report.totals.balance).toBe(99985075n);
  });

  it('selects payable accounts for side=payable and passes the party filter', async () => {
    const { service, ageingLines } = setup();
    const report = await service.ageing(TENANT, { side: 'payable', to: '2026-11-01', partyCode: 'S9' });
    expect(ageingLines).toHaveBeenCalledWith(TENANT, { accountIds: [4], to: '2026-11-01', partyCode: 'S9' });
    expect(report.rows).toEqual([]);
  });

  it('limits to an account subtree', async () => {
    const { service, ageingLines } = setup();
    await service.ageing(TENANT, { accountCode: '13', to: '2026-11-01' });
    expect(ageingLines.mock.calls[0][1].accountIds).toEqual([1, 2]);
  });

  it('rejects an unknown account, a bad day and bad edges', async () => {
    const { service } = setup();
    await expect(service.ageing(TENANT, { accountCode: '99' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.ageing(TENANT, { to: '2026-02-30' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.ageing(TENANT, { to: '2026-11-01', edges: [60, 30] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('does not query when no account matches', async () => {
    const { service, ageingLines } = setup();
    (service as unknown as { accounting: { findAllAccounts: jest.Mock } }).accounting.findAllAccounts.mockResolvedValue([
      accounts[2],
    ]);
    const report = await service.ageing(TENANT, { to: '2026-11-01' });
    expect(ageingLines).not.toHaveBeenCalled();
    expect(report.rows).toEqual([]);
  });
});
