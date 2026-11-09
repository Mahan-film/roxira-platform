import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { CurrencyService } from '../currency/services/currency.service';
import { AccountingRepository } from './repositories/accounting.repository';
import { FiscalYearRepository } from './repositories/fiscal-year.repository';
import { LedgerReportRepository } from './repositories/ledger-report.repository';
import { AccountingService } from './services/accounting.service';
import { ChartTemplateService } from './services/chart-template.service';
import { FiscalYearService } from './services/fiscal-year.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
  TEST_T2 as T2,
} from '../../test/support/test-pg';

describePg('Fiscal close on PostgreSQL', () => {
  let testDb: TestDatabaseContext;
  let accounting: AccountingService;
  let templates: ChartTemplateService;
  let years: FiscalYearService;

  const balances = async (tenant: string): Promise<Record<string, string>> => {
    const rows: Array<{ code: string; balance: string }> = await testDb.rawQuery(
      `SELECT code, balance FROM fin_chart_of_accounts WHERE tenant_id = $1 AND balance <> 0`,
      [tenant],
    );
    return Object.fromEntries(rows.map((r) => [r.code, r.balance]));
  };
  const post = (tenant: string, entryNumber: string, date: string, lines: object[]) =>
    accounting.createJournalEntry(tenant, { entryNumber, date, description: 'test', lines } as never);

  beforeAll(async () => {
    testDb = await createTestDatabase('fy');
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    const repo = new AccountingRepository(testDb.scope);
    accounting = new AccountingService(repo, currency);
    templates = new ChartTemplateService(repo);
    years = new FiscalYearService(repo, new FiscalYearRepository(testDb.app), new LedgerReportRepository(testDb.scope), accounting);
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('applies the template additively and refuses postings to header accounts', async () => {
    await post(T1, 'SEED', '2026-04-01', [
      { accountCode: '1010', debit: '1000.00' },
      { accountCode: '3010', credit: '1000.00' },
    ]);
    const first = await templates.apply(T1, 'iran-trading');
    expect(first.added).toBeGreaterThan(40);
    expect(first.classified).toBe(11);
    expect(await templates.apply(T1, 'iran-trading')).toEqual({ added: 0, classified: 0 });
    await expect(
      post(T1, 'HDR', '2026-04-02', [
        { accountCode: '10', debit: '1.00' },
        { accountCode: '3010', credit: '1.00' },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    const accounts = await accounting.listAccounts(T1);
    expect(accounts.find((a) => a.code === '1012')).toMatchObject({ level: 'MOEIN', parentCode: '10', reportLine: 'BANK' });
  });

  it('closes a year, carries permanent balances and reopens by reversal', async () => {
    await post(T1, 'SALE', '2026-05-01', [
      { accountCode: '1010', debit: '500.25' },
      { accountCode: '4010', credit: '500.25' },
    ]);
    await post(T1, 'RENT', '2026-06-01', [
      { accountCode: '5020', debit: '200.10' },
      { accountCode: '1010', credit: '200.10' },
    ]);
    const before = await balances(T1);
    const y1 = await years.create(T1, { name: '1405', startDate: '2026-03-21', endDate: '2027-03-20' });
    await expect(years.close(T1, 'u', y1.id, {})).rejects.toBeInstanceOf(BadRequestException);

    const result = await years.close(T1, 'u', y1.id, {
      nextYear: { name: '1406', startDate: '2027-03-21', endDate: '2028-03-19' },
    });
    expect(result.entryNumbers).toEqual([
      `FC-${y1.id}-1-1`, `FC-${y1.id}-1-2`, `FC-${y1.id}-1-3`, `FO-${y1.id}-1`,
    ]);
    expect(await balances(T1)).toEqual({ '1010': '1300.15', '3010': '-1000.00', '3040': '-300.15' });

    // The closed year is locked and system entries cannot be reversed one by one.
    await expect(
      post(T1, 'LATE', '2026-07-01', [
        { accountCode: '1010', debit: '1.00' },
        { accountCode: '4010', credit: '1.00' },
      ]),
    ).rejects.toMatchObject({ status: 423 });
    const opening = await accounting.findJournalEntryByNumber(T1, `FO-${y1.id}-1`);
    await expect(accounting.reverseJournalEntry(T1, opening!.id)).rejects.toBeInstanceOf(BadRequestException);

    await years.reopen(T1, 'u', y1.id, { reason: 'audit adjustment' });
    expect(await balances(T1)).toEqual(before);

    // A second close after the reopen gets fresh numbers and lands on the same balances.
    const again = await years.close(T1, 'u', y1.id, {});
    expect(again.entryNumbers[0]).toBe(`FC-${y1.id}-2-1`);
    expect(await balances(T1)).toEqual({ '1010': '1300.15', '3010': '-1000.00', '3040': '-300.15' });
  }, 60000);

  it('keeps tenants apart and enforces RLS for a role that cannot bypass it', async () => {
    expect(await years.list(T2)).toEqual([]);
    await testDb.owner.query(`CREATE ROLE rx_fy_app LOGIN`);
    await testDb.owner.query(`GRANT SELECT ON fin_fiscal_years TO rx_fy_app`);
    const rows = await testDb.owner.transaction(async (m) => {
      await m.query(`SET LOCAL ROLE rx_fy_app`);
      const none = await m.query(`SELECT id FROM fin_fiscal_years`);
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [T2]);
      const other = await m.query(`SELECT id FROM fin_fiscal_years`);
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [T1]);
      const own = await m.query(`SELECT id FROM fin_fiscal_years`);
      return { none, other, own };
    });
    expect(rows.none).toEqual([]);
    expect(rows.other).toEqual([]);
    expect(rows.own.length).toBe(2);
  });

  it('reverts the migration cleanly', async () => {
    await testDb.owner.query(`REVOKE ALL ON fin_fiscal_years FROM rx_fy_app`);
    await testDb.owner.query(`DROP ROLE rx_fy_app`);
    // Later migrations stack on top of this one, so revert down to it by name, not by count.
    while ((await testDb.owner.query(`SELECT 1 FROM migrations WHERE name = 'AddChartHierarchyAndFiscalYears1789370000000'`)).length > 0) {
      await testDb.owner.undoLastMigration();
    }
    const [{ exists }] = await testDb.owner.query(`SELECT to_regclass('fin_fiscal_years') IS NOT NULL AS "exists"`);
    expect(exists).toBe(false);
    await testDb.owner.runMigrations();
  });
});
