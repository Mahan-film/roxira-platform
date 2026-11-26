/**
 * T226 (R19): Real PostgreSQL + FORCE RLS verification for control accounts (`system_posted_only`)
 * and server-side adjustment period enforcement (`fin_fiscal_years.adjustment_period_open`).
 *
 * Runs against `roxira_app` (NOSUPERUSER NOBYPASSRLS) via `createTestDatabase` (Lessons 5-6).
 * Opt-in like all *.pg.spec.ts: skipped unless ROXIRA_TEST_PG_HOST is set.
 */
import 'reflect-metadata';
import { CalendarService } from '../calendar/calendar.service';
import { CurrencyService } from '../currency/services/currency.service';
import { createTestDatabase, describePg, TEST_T1 as T1, TEST_T2 as T2, TestDatabaseContext } from '../../test/support/test-pg';
import { ControlAccountPostingException } from './exceptions/ledger.exceptions';
import { AccountingRepository } from './repositories/accounting.repository';
import { FiscalYearRepository } from './repositories/fiscal-year.repository';
import { LedgerReportRepository } from './repositories/ledger-report.repository';
import { AccountingService } from './services/accounting.service';
import { ChartTemplateService } from './services/chart-template.service';
import { FiscalYearService } from './services/fiscal-year.service';

const currencyStub = {
  convert: (v: number) => v,
  round: (v: number) => v,
} as unknown as CurrencyService;

describePg('Control accounts & server-side adjustment period on PostgreSQL (roxira_app FORCE RLS)', () => {
  let testDb: TestDatabaseContext;
  let accounting: AccountingService;
  let fiscalYears: FiscalYearService;
  let yearT1Id: number;

  beforeAll(async () => {
    testDb = await createTestDatabase('ctrl_acct');
    const repo = new AccountingRepository(testDb.scope);
    const fyRepo = new FiscalYearRepository(testDb.app);
    const ledgerReports = new LedgerReportRepository(testDb.scope);
    accounting = new AccountingService(repo, currencyStub);
    fiscalYears = new FiscalYearService(repo, fyRepo, ledgerReports, accounting, new CalendarService());

    await new ChartTemplateService(repo).apply(T1, 'iran-trading');
    await new ChartTemplateService(repo).apply(T2, 'iran-trading');

    const fy1 = await fiscalYears.create(T1, {
      name: '1405',
      startDate: '2026-03-21',
      endDate: '2027-03-20',
    });
    yearT1Id = fy1.id;
    await fiscalYears.create(T2, {
      name: '1405',
      startDate: '2026-03-21',
      endDate: '2027-03-20',
    });
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('persists system_posted_only=true on AR, AP, inventory, and fixed assets under roxira_app', async () => {
    const accounts = await accounting.listAccounts(T1);
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    expect(byCode.get('1020')?.systemPostedOnly).toBe(true);
    expect(byCode.get('2010')?.systemPostedOnly).toBe(true);
    expect(byCode.get('1030')?.systemPostedOnly).toBe(true);
    expect(byCode.get('1110')?.systemPostedOnly).toBe(true);
    expect(byCode.get('1120')?.systemPostedOnly).toBe(true);
    expect(byCode.get('1011')?.systemPostedOnly).toBe(false);
    expect(byCode.get('5020')?.systemPostedOnly).toBe(false);
  });

  it('blocks manual postings to control accounts when adjustment period is closed, and allows system postings', async () => {
    await expect(
      accounting.createJournalEntry(
        T1,
        {
          entryNumber: 'PG-MAN-BLOCK-1',
          date: '2026-05-01T12:00:00.000Z',
          description: 'manual AR attempt',
          lines: [
            { accountCode: '1020', debit: '1000.00', credit: '0.00' },
            { accountCode: '4020', debit: '0.00', credit: '1000.00' },
          ],
        },
        undefined,
        { isSystem: false, actorRole: 'accountant' },
      ),
    ).rejects.toThrow(ControlAccountPostingException);

    const sysEntry = await accounting.createJournalEntry(
      T1,
      {
        entryNumber: 'PG-SYS-OK-1',
        date: '2026-05-01T12:00:00.000Z',
        description: 'system subledger AR posting',
        lines: [
          { accountCode: '1020', debit: '1000.00', credit: '0.00' },
          { accountCode: '4020', debit: '0.00', credit: '1000.00' },
        ],
      },
      undefined,
      { isSystem: true },
    );
    expect(sysEntry.entryNumber).toBe('PG-SYS-OK-1');
  });

  it('allows authorized roles only while the tenant adjustment period is open (tenant-isolated under RLS)', async () => {
    const opened = await fiscalYears.setAdjustmentPeriod(T1, 'admin-1', yearT1Id, true);
    expect(opened.adjustmentPeriodOpen).toBe(true);

    // Tenant 1 authorized role succeeds inside its open adjustment period
    const adj = await accounting.createJournalEntry(
      T1,
      {
        entryNumber: 'PG-ADJ-OK-1',
        date: '2026-05-02T12:00:00.000Z',
        description: 'adjustment journal on inventory',
        lines: [
          { accountCode: '1030', debit: '2500.00', credit: '0.00' },
          { accountCode: '3010', debit: '0.00', credit: '2500.00' },
        ],
      },
      undefined,
      { isSystem: false, actorRole: 'accountant' },
    );
    expect(adj.entryNumber).toBe('PG-ADJ-OK-1');

    // Tenant 1 unauthorized role is still denied
    await expect(
      accounting.createJournalEntry(
        T1,
        {
          entryNumber: 'PG-ADJ-DENY-SALES',
          date: '2026-05-02T12:00:00.000Z',
          description: 'sales role attempt',
          lines: [
            { accountCode: '1030', debit: '100.00', credit: '0.00' },
            { accountCode: '3010', debit: '0.00', credit: '100.00' },
          ],
        },
        undefined,
        { isSystem: false, actorRole: 'sales' },
      ),
    ).rejects.toThrow(ControlAccountPostingException);

    // Tenant 2's adjustment period is still closed -> tenant 2 cannot ride on tenant 1's open period
    await expect(
      accounting.createJournalEntry(
        T2,
        {
          entryNumber: 'PG-T2-BLOCK-1',
          date: '2026-05-02T12:00:00.000Z',
          description: 'cross-tenant check',
          lines: [
            { accountCode: '1030', debit: '100.00', credit: '0.00' },
            { accountCode: '3010', debit: '0.00', credit: '100.00' },
          ],
        },
        undefined,
        { isSystem: false, actorRole: 'owner' },
      ),
    ).rejects.toThrow(ControlAccountPostingException);

    // Closing Tenant 1 adjustment period immediately blocks manual control-account posting again
    const closed = await fiscalYears.setAdjustmentPeriod(T1, 'admin-1', yearT1Id, false);
    expect(closed.adjustmentPeriodOpen).toBe(false);

    await expect(
      accounting.createJournalEntry(
        T1,
        {
          entryNumber: 'PG-ADJ-CLOSED-BLOCK',
          date: '2026-05-03T12:00:00.000Z',
          description: 'blocked after close',
          lines: [
            { accountCode: '2010', debit: '0.00', credit: '100.00' },
            { accountCode: '5020', debit: '100.00', credit: '0.00' },
          ],
        },
        undefined,
        { isSystem: false, actorRole: 'owner' },
      ),
    ).rejects.toThrow(ControlAccountPostingException);
  });
});
