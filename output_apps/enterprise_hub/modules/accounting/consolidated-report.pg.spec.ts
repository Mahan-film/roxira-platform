import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrencyService } from '../currency/services/currency.service';
import { AccountingRepository } from './repositories/accounting.repository';
import { FiscalYearRepository } from './repositories/fiscal-year.repository';
import { LedgerReportRepository } from './repositories/ledger-report.repository';
import { AccountingService } from './services/accounting.service';
import { ChartTemplateService } from './services/chart-template.service';
import { FinancialReportsService } from './services/financial-reports.service';
import { FiscalYearService } from './services/fiscal-year.service';
import { ConsolidatedReportService } from './services/consolidated-report.service';
import { MembershipEntity } from '../access/entities/membership.entity';
import { EntitlementEntity } from '../access/entities/entitlement.entity';
import { RefreshTokenEntity } from '../auth/entities/refresh-token.entity';
import { TenantEntity } from '../tenants/entities/tenant.entity';
import { MembershipsRepository } from '../access/repositories/memberships.repository';
import { RolesRepository } from '../access/repositories/roles.repository';
import { EntitlementsRepository } from '../access/repositories/entitlements.repository';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { SessionCheckRepository } from '../access/repositories/session-check.repository';
import { AccessService } from '../access/services/access.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
} from '../../test/support/test-pg';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const TENANT_C = '33333333-3333-4333-8333-333333333333';
const USER_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_SALES_IN_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_SUSPENDED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_EMPTY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describePg('Consolidated multi-company report on PostgreSQL (T53 / #713)', () => {
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

    const membershipsRepo = new MembershipsRepository(testDb.app.getRepository(MembershipEntity));
    const rolesRepo = new RolesRepository(testDb.scope);
    const entitlementsRepo = new EntitlementsRepository(testDb.app.getRepository(EntitlementEntity));
    const tenantsRepo = new TenantsRepository(testDb.app.getRepository(TenantEntity));
    const sessionCheckRepo = new SessionCheckRepository(testDb.app.getRepository(RefreshTokenEntity));
    const configService = { get: (_k: string, def?: string) => def ?? 'true' } as unknown as ConfigService;
    const accessService = new AccessService(
      membershipsRepo,
      rolesRepo,
      entitlementsRepo,
      tenantsRepo,
      sessionCheckRepo,
      configService,
    );

    consolidatedService = new ConsolidatedReportService(
      membershipsRepo,
      accessService,
      testDb.scope,
      reports,
    );

    // Create tenants in tenants table
    await testDb.owner.query(
      `INSERT INTO "tenants" ("id", "name", "slug") VALUES
       ($1, 'شرکت الف', 'company-a'),
       ($2, 'شرکت ب', 'company-b'),
       ($3, 'شرکت ج', 'company-c')
       ON CONFLICT DO NOTHING`,
      [TENANT_A, TENANT_B, TENANT_C],
    );

    // Create users in users table
    await testDb.owner.query(
      `INSERT INTO "users" ("id", "phone") VALUES
       ($1, '09120000001'),
       ($2, '09120000002'),
       ($3, '09120000003'),
       ($4, '09120000004')
       ON CONFLICT DO NOTHING`,
      [USER_1, USER_SALES_IN_A, USER_SUSPENDED, USER_EMPTY],
    );

    // Create memberships:
    // USER_1: owner in TENANT_A, admin in TENANT_B (both have accounting:read)
    // USER_SALES_IN_A: sales in TENANT_A (no accounting:read), accountant in TENANT_B (has accounting:read)
    // USER_SUSPENDED: SUSPENDED membership in TENANT_A
    await testDb.owner.query(
      `INSERT INTO "tenant_memberships" ("id", "tenant_id", "user_id", "role_key", "status") VALUES
       (gen_random_uuid(), $1, $3, 'owner', 'ACTIVE'),
       (gen_random_uuid(), $2, $3, 'admin', 'ACTIVE'),
       (gen_random_uuid(), $1, $4, 'sales', 'ACTIVE'),
       (gen_random_uuid(), $2, $4, 'accountant', 'ACTIVE'),
       (gen_random_uuid(), $1, $5, 'owner', 'SUSPENDED')
       ON CONFLICT DO NOTHING`,
      [TENANT_A, TENANT_B, USER_1, USER_SALES_IN_A, USER_SUSPENDED],
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
    const result = await consolidatedService.getConsolidatedReport(USER_1, { asOfDate: '2026-12-31' });
    expect(result.companies).toHaveLength(2);
    expect(result.companies.map((c) => c.tenantId).sort()).toEqual([TENANT_A, TENANT_B].sort());

    const row1020 = result.rows.find((r) => r.code === '1020');
    expect(row1020).toBeDefined();
    // 500,000 (Tenant A) + 300,000 (Tenant B) = 800,000
    expect(row1020!.periodDebit).toBe(800000);
    expect(row1020!.companyBreakdown[TENANT_A].periodDebit).toBe(500000);
    expect(row1020!.companyBreakdown[TENANT_B].periodDebit).toBe(300000);
    expect(row1020!.companyAmounts[TENANT_A].debit).toBe(500000);
    expect(row1020!.companyAmounts[TENANT_B].debit).toBe(300000);
    expect(row1020!.companyAmounts[TENANT_A].balance).toBe(500000);

    const row4010 = result.rows.find((r) => r.code === '4010');
    expect(row4010).toBeDefined();
    expect(row4010!.periodCredit).toBe(800000);
    expect(row4010!.companyBreakdown[TENANT_A].periodCredit).toBe(500000);
    expect(row4010!.companyBreakdown[TENANT_B].periodCredit).toBe(300000);

    expect(result.balanced).toBe(true);
    expect(result.totals.periodDebit).toBe(800000);
    expect(result.totals.periodCredit).toBe(800000);
  });

  it('deduplicates tenantIds so repeat entries do not inflate totals or rows', async () => {
    // Passing duplicate TENANT_A, TENANT_A must dedupe and return only one instance of TENANT_A
    const result = await consolidatedService.getConsolidatedReport(USER_1, {
      asOfDate: '2026-12-31',
      tenantIds: [TENANT_A, TENANT_A],
    });
    expect(result.companies).toHaveLength(1);
    expect(result.companies[0].tenantId).toBe(TENANT_A);
    expect(result.participatingTenants).toHaveLength(1);
    expect(result.participatingTenants[0].tenantId).toBe(TENANT_A);

    const row1020 = result.rows.find((r) => r.code === '1020');
    expect(row1020).toBeDefined();
    // Exactly 500,000 from Tenant A (not double-counted to 1,000,000)
    expect(row1020!.periodDebit).toBe(500000);
    expect(result.totals.periodDebit).toBe(500000);
  });

  it('does not leak unauthorized Tenant C when tenantIds is omitted', async () => {
    const result = await consolidatedService.getConsolidatedReport(USER_1, { asOfDate: '2026-12-31' });
    const tenantIds = result.companies.map((c) => c.tenantId);
    expect(tenantIds).not.toContain(TENANT_C);
    expect(result.participatingTenants.map((t) => t.tenantId)).not.toContain(TENANT_C);
  });

  it('refuses access when requesting a tenant the user is not a member of', async () => {
    await expect(
      consolidatedService.getConsolidatedReport(USER_1, {
        asOfDate: '2026-12-31',
        tenantIds: [TENANT_A, TENANT_C],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses access when user has a role without accounting:read in one of the requested tenants', async () => {
    // USER_SALES_IN_A has 'sales' role in TENANT_A (no accounting:read)
    await expect(
      consolidatedService.getConsolidatedReport(USER_SALES_IN_A, {
        asOfDate: '2026-12-31',
        tenantIds: [TENANT_A, TENANT_B],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('filters out non-accounting tenants and only returns authorized tenants when tenantIds omitted', async () => {
    // USER_SALES_IN_A omitted tenantIds: only TENANT_B (accountant role) should be returned
    const result = await consolidatedService.getConsolidatedReport(USER_SALES_IN_A, { asOfDate: '2026-12-31' });
    expect(result.companies).toHaveLength(1);
    expect(result.companies[0].tenantId).toBe(TENANT_B);
  });

  it('excludes suspended memberships and fails closed if requested', async () => {
    // USER_SUSPENDED has SUSPENDED membership in TENANT_A
    await expect(
      consolidatedService.getConsolidatedReport(USER_SUSPENDED, { asOfDate: '2026-12-31' }),
    ).rejects.toThrow(NotFoundException);

    await expect(
      consolidatedService.getConsolidatedReport(USER_SUSPENDED, {
        asOfDate: '2026-12-31',
        tenantIds: [TENANT_A],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when user has no active memberships', async () => {
    await expect(
      consolidatedService.getConsolidatedReport(USER_EMPTY, { asOfDate: '2026-12-31' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('validates date range: throws BadRequestException when from > to', async () => {
    await expect(
      consolidatedService.getConsolidatedReport(USER_1, {
        from: '2026-12-31',
        to: '2026-01-01',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('validates date presence: throws BadRequestException when both to and asOfDate are missing', async () => {
    await expect(
      consolidatedService.getConsolidatedReport(USER_1, {}),
    ).rejects.toThrow(BadRequestException);
  });
});
