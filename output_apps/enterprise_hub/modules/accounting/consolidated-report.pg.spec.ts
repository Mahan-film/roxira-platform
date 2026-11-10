import 'reflect-metadata';
import { CurrencyService } from '../currency/services/currency.service';
import { AccountingRepository } from './repositories/accounting.repository';
import { FiscalYearRepository } from './repositories/fiscal-year.repository';
import { LedgerReportRepository } from './repositories/ledger-report.repository';
import { AccountingService } from './services/accounting.service';
import { ChartTemplateService } from './services/chart-template.service';
import { FinancialReportsService } from './services/financial-reports.service';
import { FiscalYearService } from './services/fiscal-year.service';
import { ConsolidatedReportService } from './services/consolidated-report.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
} from '../../test/support/test-pg';
import { ForbiddenException } from '@nestjs/common';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const TENANT_C = '33333333-3333-4333-8333-333333333333';
const USER_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describePg('Consolidated multi-company report on PostgreSQL (T53)', () => {
  let testDb: TestDatabaseContext;
  let accounting: AccountingService;
  let years: FiscalYearService;
  let consolidatedService: ConsolidatedReportService;

  beforeAll(async () => {
    testDb = await createTestDatabase('consol_rep');
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    const repo = new AccountingRepository(testDb.scope);
    accounting = new AccountingService(repo, currency);
    const fiscal = new FiscalYearRepository(testDb.app);
    const ledger = new LedgerReportRepository(testDb.scope);
    years = new FiscalYearService(repo, fiscal, ledger, accounting);
    const reports = new FinancialReportsService(repo, fiscal, ledger);
    consolidatedService = new ConsolidatedReportService(testDb.app, reports);

    // Create tenants in tenants table
    await testDb.owner.query(
      `INSERT INTO "tenants" ("id", "name", "slug") VALUES
       ($1, 'شرکت الف', 'company-a'),
       ($2, 'شرکت ب', 'company-b'),
       ($3, 'شرکت ج', 'company-c')
       ON CONFLICT DO NOTHING`,
      [TENANT_A, TENANT_B, TENANT_C],
    );

    // Create user in users table
    await testDb.owner.query(
      `INSERT INTO "users" ("id", "phone") VALUES ($1, '09120000001') ON CONFLICT DO NOTHING`,
      [USER_1],
    );

    // Create memberships: USER_1 has active memberships in TENANT_A and TENANT_B, but not TENANT_C
    await testDb.owner.query(
      `INSERT INTO "tenant_memberships" ("id", "tenant_id", "user_id", "role_key", "status") VALUES
       (gen_random_uuid(), $1, $3, 'owner', 'ACTIVE'),
       (gen_random_uuid(), $2, $3, 'admin', 'ACTIVE')
       ON CONFLICT DO NOTHING`,
      [TENANT_A, TENANT_B, USER_1],
    );

    // Apply template and create fiscal years
    for (const t of [TENANT_A, TENANT_B, TENANT_C]) {
      await new ChartTemplateService(repo).apply(t, 'iran-trading');
      await years.create(t, { name: '1405', startDate: '2026-03-21', endDate: '2027-03-20' });
    }

    // Tenant A: 1020 debit 500,000, 4010 credit 500,000
    await accounting.createJournalEntry(TENANT_A, {
      entryNumber: 'JA-01',
      date: '2026-04-10',
      description: 'Sale in Company A',
      lines: [
        { accountCode: '1020', debit: '500000.00' },
        { accountCode: '4010', credit: '500000.00' },
      ],
    } as never);

    // Tenant B: 1020 debit 300,000, 4010 credit 300,000
    await accounting.createJournalEntry(TENANT_B, {
      entryNumber: 'JB-01',
      date: '2026-05-12',
      description: 'Sale in Company B',
      lines: [
        { accountCode: '1020', debit: '300000.00' },
        { accountCode: '4010', credit: '300000.00' },
      ],
    } as never);

    // Tenant C: 1020 debit 9,000,000, 4010 credit 9,000,000 (User 1 is not a member)
    await accounting.createJournalEntry(TENANT_C, {
      entryNumber: 'JC-01',
      date: '2026-05-20',
      description: 'Sale in Company C',
      lines: [
        { accountCode: '1020', debit: '9000000.00' },
        { accountCode: '4010', credit: '9000000.00' },
      ],
    } as never);
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('aggregates trial balance across all authorized companies of the user', async () => {
    const result = await consolidatedService.getConsolidatedReport(USER_1, {});
    expect(result.companies).toHaveLength(2);
    expect(result.companies.map((c) => c.tenantId).sort()).toEqual([TENANT_A, TENANT_B].sort());

    const row1020 = result.rows.find((r) => r.code === '1020');
    expect(row1020).toBeDefined();
    // 500,000 (Tenant A) + 300,000 (Tenant B) = 800,000
    expect(row1020!.periodDebit).toBe(800000);
    expect(row1020!.companyBreakdown[TENANT_A].periodDebit).toBe(500000);
    expect(row1020!.companyBreakdown[TENANT_B].periodDebit).toBe(300000);

    const row4010 = result.rows.find((r) => r.code === '4010');
    expect(row4010).toBeDefined();
    expect(row4010!.periodCredit).toBe(800000);
    expect(row4010!.companyBreakdown[TENANT_A].periodCredit).toBe(500000);
    expect(row4010!.companyBreakdown[TENANT_B].periodCredit).toBe(300000);

    expect(result.balanced).toBe(true);
    expect(result.totals.periodDebit).toBe(800000);
    expect(result.totals.periodCredit).toBe(800000);
  });

  it('refuses access when requesting a tenant the user is not a member of', async () => {
    await expect(
      consolidatedService.getConsolidatedReport(USER_1, { tenantIds: `${TENANT_A},${TENANT_C}` }),
    ).rejects.toThrow(ForbiddenException);
  });
});
