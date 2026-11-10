import 'reflect-metadata';
import { CurrencyService } from '../currency/services/currency.service';
import { AccountingRepository } from './repositories/accounting.repository';
import { FiscalYearRepository } from './repositories/fiscal-year.repository';
import { AccountBudgetRepository } from './repositories/account-budget.repository';
import { LedgerReportRepository } from './repositories/ledger-report.repository';
import { AccountingService } from './services/accounting.service';
import { ChartTemplateService } from './services/chart-template.service';
import { FiscalYearService } from './services/fiscal-year.service';
import { BudgetVsActualService } from './services/budget-vs-actual.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
} from '../../test/support/test-pg';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

describePg('Budget vs Actual report on PostgreSQL (T52)', () => {
  let testDb: TestDatabaseContext;
  let accounting: AccountingService;
  let years: FiscalYearService;
  let budgetService: BudgetVsActualService;
  let yearA: number;

  beforeAll(async () => {
    testDb = await createTestDatabase('budget_rep');
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    const repo = new AccountingRepository(testDb.scope);
    accounting = new AccountingService(repo, currency);
    const fiscal = new FiscalYearRepository(testDb.app);
    const ledger = new LedgerReportRepository(testDb.scope);
    years = new FiscalYearService(repo, fiscal, ledger, accounting);
    const budgetRepo = new AccountBudgetRepository(testDb.scope);
    budgetService = new BudgetVsActualService(testDb.scope, budgetRepo, fiscal);

    // Apply template and create fiscal year for Tenant A
    await new ChartTemplateService(repo).apply(TENANT_A, 'iran-trading');
    yearA = (await years.create(TENANT_A, { name: '1405', startDate: '2026-03-21', endDate: '2027-03-20' })).id;

    // Apply template and create fiscal year for Tenant B
    await new ChartTemplateService(repo).apply(TENANT_B, 'iran-trading');
    await years.create(TENANT_B, { name: '1405', startDate: '2026-03-21', endDate: '2027-03-20' });

    // Set budget in Tenant A: 5020 (Office expense) budget = 500,000 rials
    await budgetService.setBudget(TENANT_A, {
      fiscalYearId: yearA,
      accountCode: '5020',
      budgetAmount: '500000.00',
    });

    // Set budget in Tenant A: 5110 (COGS) budget = 1,000,000 rials
    await budgetService.setBudget(TENANT_A, {
      fiscalYearId: yearA,
      accountCode: '5110',
      budgetAmount: '1000000.00',
    });

    // Post an actual entry in Tenant A: 300,000 rials to 5020
    await accounting.createJournalEntry(TENANT_A, {
      entryNumber: 'J-B01',
      date: '2026-05-10',
      description: 'Office expense payment',
      lines: [
        { accountCode: '5020', debit: '300000.00' },
        { accountCode: '1012', credit: '300000.00' },
      ],
    } as never);

    // Post an actual entry in Tenant A: 1,200,000 rials to 5110 (over budget!)
    await accounting.createJournalEntry(TENANT_A, {
      entryNumber: 'J-B02',
      date: '2026-06-15',
      description: 'COGS',
      lines: [
        { accountCode: '5110', debit: '1200000.00' },
        { accountCode: '1030', credit: '1200000.00' },
      ],
    } as never);
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('computes exact budget vs actual, variance and percentage for Tenant A', async () => {
    const report = await budgetService.getBudgetVsActual(TENANT_A, { fiscalYearId: yearA });
    expect(report.fiscalYearId).toBe(yearA);
    expect(report.fiscalYearName).toBe('1405');

    const row5020 = report.rows.find((r) => r.accountCode === '5020');
    expect(row5020).toBeDefined();
    expect(row5020!.budgetAmount).toBe(500000);
    expect(row5020!.actualAmount).toBe(300000);
    expect(row5020!.varianceAmount).toBe(200000); // 500k - 300k
    expect(row5020!.variancePercent).toBe(40); // 200k / 500k = 40%
    expect(row5020!.utilizationPercent).toBe(60); // 300k / 500k = 60%

    const row5110 = report.rows.find((r) => r.accountCode === '5110');
    expect(row5110).toBeDefined();
    expect(row5110!.budgetAmount).toBe(1000000);
    expect(row5110!.actualAmount).toBe(1200000);
    expect(row5110!.varianceAmount).toBe(-200000); // negative variance: over budget
    expect(row5110!.variancePercent).toBe(-20);
    expect(row5110!.utilizationPercent).toBe(120);

    // Totals
    expect(report.totalBudget).toBe(1500000);
    expect(report.totalActual).toBe(1500000);
    expect(report.totalVariance).toBe(0);
    expect(report.overallUtilizationPercent).toBe(100);
  });

  it('isolates budgets across tenants (Tenant B cannot see Tenant A budgets)', async () => {
    const yearsB = await years.list(TENANT_B);
    const fyB = yearsB[0].id;
    const reportB = await budgetService.getBudgetVsActual(TENANT_B, { fiscalYearId: fyB });
    expect(reportB.rows).toHaveLength(0);
    expect(reportB.totalBudget).toBe(0);
  });
});
