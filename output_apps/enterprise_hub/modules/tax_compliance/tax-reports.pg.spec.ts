/**
 * Tax Compliance & Cheques Reports on real PostgreSQL:
 *   - Tax Inspector Package (بسته ممیز مالیاتی)
 *   - Quarterly Tax Comparison (گزارش مقایسه‌ای فصلی مالیات)
 *   - Year-End Tax Rollover (تطبیق مالیاتی پایان سال و چک‌لیست)
 *   - Cheque Maturity Report (گزارش تحلیلی سررسید چک‌ها)
 *
 * Runs under a real NOSUPERUSER NOBYPASSRLS PostgreSQL role through TenantScope.
 *
 * ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55471 npx jest modules/tax_compliance/tax-reports.pg.spec.ts --runInBand
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { ChequesRepository } from '../cheques/repositories/cheques.repository';
import { ChequeMaturityReportService } from '../cheques/services/cheque-maturity-report.service';
import { StatutoryRepository } from '../hr/statutory/statutory.repository';
import { TaxInspectorRepository } from './reports/tax-inspector.repository';
import { TaxInspectorService } from './reports/tax-inspector.service';
import { QuarterlyTaxComparisonService } from './reports/quarterly-tax-comparison.service';
import { YearEndTaxRolloverService } from './reports/year-end-tax-rollover.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST ?? (process.env.CI ? '127.0.0.1' : undefined);
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const ADMIN_DB = process.env.ROXIRA_TEST_PG_ADMIN_DB ?? (OWNER === 'mac' ? 'template1' : 'postgres');
const APP_PW = 'tax-reports-test-only';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const options = (database: string, username = OWNER, password = OWNER_PW) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  password,
  database,
  entities: [path.join(__dirname, '../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('Tax Compliance and Cheque Reports on real PostgreSQL (NOSUPERUSER, NOBYPASSRLS)', () => {
  const db = `rx_tax_reports_${process.pid}_${Date.now()}`;
  const role = `rx_tax_app_${process.pid}`;
  let admin: DataSource;
  let ownerDs: DataSource;
  let appDs: DataSource;

  let tenantScope: TenantScope;
  let inspectorRepo: TaxInspectorRepository;
  let inspectorService: TaxInspectorService;
  let comparisonService: QuarterlyTaxComparisonService;
  let rolloverService: YearEndTaxRolloverService;
  let chequesRepo: ChequesRepository;
  let chequeMaturityService: ChequeMaturityReportService;

  beforeAll(async () => {
    admin = await new DataSource({ ...options(ADMIN_DB), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_PW}'`);

    ownerDs = await new DataSource(options(db)).initialize();
    await ownerDs.runMigrations();

    await ownerDs.query(`GRANT CONNECT ON DATABASE "${db}" TO ${role}`);
    await ownerDs.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await ownerDs.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await ownerDs.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);

    appDs = await new DataSource({ ...options(db, role, APP_PW), extra: { max: 8 } }).initialize();
    tenantScope = new TenantScope(appDs);

    let statutoryRepo: StatutoryRepository;
    inspectorRepo = new TaxInspectorRepository(appDs, tenantScope);
    inspectorService = new TaxInspectorService(inspectorRepo);
    comparisonService = new QuarterlyTaxComparisonService(inspectorRepo);
    statutoryRepo = new StatutoryRepository(tenantScope);
    rolloverService = new YearEndTaxRolloverService(inspectorRepo, statutoryRepo);

    chequesRepo = new ChequesRepository(tenantScope);
    chequeMaturityService = new ChequeMaturityReportService(chequesRepo);

    // Seed test data for Tenant A:
    // 1. Chart of Accounts (Cash 1010, VAT Payable 2002, Revenue 4010)
    await ownerDs.query(`
      INSERT INTO "fin_chart_of_accounts" ("id", "tenant_id", "code", "name", "account_type")
      VALUES
        (1001, '${TENANT_A}', '1010', 'صندوق مرکزی', 'ASSET'),
        (1002, '${TENANT_A}', '4010', 'درآمد فروش', 'REVENUE'),
        (1003, '${TENANT_A}', '2002', 'مالیات بر ارزش افزوده پرداختنی', 'LIABILITY')
      ON CONFLICT DO NOTHING
    `);

    // 2. Statutory parameter for corporate tax rate (Art. 105: 25%)
    await ownerDs.query(`
      INSERT INTO "statutory_parameters" ("tenant_id", "country", "fiscal_year", "param_key", "effective_from", "version", "value", "source", "source_kind", "verified", "created_by")
      VALUES ('${TENANT_A}', 'IR', 1404, 'corporate_tax_rate', '2025-03-21', 1, '"0.25"', 'ماده ۱۰۵ ق.م.م', 'OFFICIAL', true, 'seed')
      ON CONFLICT DO NOTHING
    `);

    // 3. Journal Entry & lines (Date in 1404: 2025-05-10)
    await ownerDs.query(`
      INSERT INTO "fin_journal_entries" ("id", "tenant_id", "entry_number", "permanent_number", "date", "description", "status")
      VALUES (2001, '${TENANT_A}', 'JV-101', '1', '2025-05-10', 'فروش کالا', 'POSTED')
      ON CONFLICT DO NOTHING
    `);
    await ownerDs.query(`
      INSERT INTO "fin_journal_entry_lines" ("id", "tenant_id", "journal_entry_id", "account_id", "debit", "credit", "description")
      VALUES
        (3001, '${TENANT_A}', 2001, 1001, 10900000.00, 0, 'واریز وجه نقد فاکتور'),
        (3002, '${TENANT_A}', 2001, 1002, 0, 10000000.00, 'درآمد خالص فروش'),
        (3003, '${TENANT_A}', 2001, 1003, 0, 900000.00, 'مالیات بر ارزش افزوده فروش')
      ON CONFLICT DO NOTHING
    `);

    // 4. Invoice for Tenant A (issuedAt: 2025-05-10 in 1404 Farvardin-Khordad Q1)
    await ownerDs.query(`
      INSERT INTO "invoices" ("id", "tenant_id", "taxInvoiceNumber", "sellerInfo", "buyerInfo", "items", "totalAmount", "totalTax", "finalPayable", "direction", "status", "subject", "jurisdiction", "issued_at", "createdAt")
      VALUES (
        '44444444-4444-4444-8444-444444444444',
        '${TENANT_A}',
        'INV-A-101',
        '{"name": "فروشنده"}'::jsonb,
        '{"name": "مشتری البرز"}'::jsonb,
        '[]'::jsonb,
        10000000.00,
        900000.00,
        10900000.00,
        'SALE',
        'PAID',
        1,
        'IR',
        '2025-05-10 10:00:00',
        '2025-05-10 10:00:00'
      )
      ON CONFLICT DO NOTHING
    `);

    // 5. Moadian submission for the invoice
    await ownerDs.query(`
      INSERT INTO "moadian_submissions" ("tenant_id", "invoice_id", "uid", "tax_id", "serial", "status", "packet")
      VALUES (
        '${TENANT_A}',
        '44444444-4444-4444-8444-444444444444',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'TAXID1234567890123456',
        1,
        'SUCCESS',
        '{}'::jsonb
      )
      ON CONFLICT DO NOTHING
    `);

    // 6. Capture document (purchase) in 1404 Q1
    await ownerDs.query(`
      INSERT INTO "capture_documents" (
        "id", "tenant_id", "status", "source_kind", "source_sha256", "extracted", "edited", "created_by"
      ) VALUES (
        '55555555-5555-5555-8555-555555555555',
        '${TENANT_A}',
        'posted',
        'pdf',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        '{}'::jsonb,
        '{"kind": "purchase", "date": "2025-05-15", "total": "2000000", "tax": "180000"}'::jsonb,
        'seed'
      )
      ON CONFLICT DO NOTHING
    `);

    // 7. Cheques for Tenant A (including settled amount on CHQ-101 and full-ISO date test)
    await ownerDs.query(`
      INSERT INTO "fin_cheques" ("tenant_id", "direction", "cheque_number", "bank_name", "amount", "settled_amount", "issue_date", "due_date", "party_name", "party_code", "status", "sayad_registration_status")
      VALUES
        ('${TENANT_A}', 'received', 'CHQ-101', 'بانک ملت', 5000000.00, 1000000.00, '2026-10-01', '2026-11-05', 'مشتری الف', 'P-1', 'registered', 'registered'),
        ('${TENANT_A}', 'received', 'CHQ-102', 'بانک صادرات', 12000000.00, 0, '2026-10-05', '2026-11-15', 'مشتری ب', 'P-2', 'registered', 'registered'),
        ('${TENANT_A}', 'issued', 'CHQ-103', 'بانک ملی', 8000000.00, 0, '2026-10-10', '2026-12-01', 'تأمین‌کننده ج', 'S-1', 'registered', 'unknown')
      ON CONFLICT DO NOTHING
    `);
  }, 240_000);

  afterAll(async () => {
    await appDs?.destroy();
    await ownerDs?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('generates Tax Inspector Package with accurate reconciliations under NOSUPERUSER role', async () => {
    const pkg = await inspectorService.generatePackage(TENANT_A, 1404);

    expect(pkg.year).toBe(1404);
    expect(pkg.tenantId).toBe(TENANT_A);
    expect(pkg.salesReconciliation.invoicedSalesCount).toBe(1);
    expect(pkg.salesReconciliation.invoicedSalesTotalMinor).toBe('1000000000'); // 10,000,000.00 net sales
    expect(pkg.salesReconciliation.outputVatMinor).toBe('90000000'); // 900,000.00 VAT
    expect(pkg.salesReconciliation.ledgerRevenueMinor).toBe('1000000000'); // 10,000,000.00 net revenue
    expect(pkg.salesReconciliation.salesToLedgerDiscrepancyMinor).toBe('0');
    expect(pkg.salesReconciliation.moadianTransmittedCount).toBe(1);
    expect(pkg.salesReconciliation.moadianTransmittedTotalMinor).toBe('1000000000'); // Net sales = Net Moadian
    expect(pkg.salesReconciliation.salesToMoadianDiscrepancyMinor).toBe('0');
    expect(pkg.purchasesReconciliation.deductiblePurchasesMinor).toBe('200000000'); // From capture_documents
    expect(pkg.purchasesReconciliation.inputVatCreditMinor).toBe('18000000'); // From capture_documents
    expect(pkg.vatSummary.inputVatCreditMinor).toBe('18000000');
    expect(pkg.booksAudit.isBalanced).toBe(true);
    expect(pkg.booksAudit.postedVouchersCount).toBe(1);
  });

  it('generates Quarterly Tax Comparison across all 4 quarters', async () => {
    const comparison = await comparisonService.generateComparison(TENANT_A, 1404);

    expect(comparison.year).toBe(1404);
    expect(comparison.quarters.length).toBe(4);
    // Q1 contains our invoice from 2025-05-10
    expect(comparison.quarters[0].quarter).toBe(1);
    expect(comparison.quarters[0].invoicedSalesMinor).toBe('1000000000');
    expect(comparison.yearTotal.invoicedSalesMinor).toBe('1000000000');
  });

  it('assesses Year-End Tax Rollover and tax calculation', async () => {
    const rollover = await rolloverService.assessRollover(TENANT_A, {
      year: 1404,
      nonDeductibleExpensesMinor: '1000000.00', // 1,000,000.00 rials
      taxExemptIncomeMinor: '0',
    });

    expect(rollover.year).toBe(1404);
    expect(rollover.taxReconciliation.accountingRevenueMinor).toBe('1000000000');
    // Profit before tax = 10,000,000.00. Taxable profit = 10,000,000.00 + 1,000,000.00 = 11,000,000.00
    expect(rollover.taxReconciliation.taxableProfitMinor).toBe('1100000000');
    expect(rollover.taxReconciliation.taxRatePercent).toBe(25);
    // 25% tax = 2,750,000.00 = 275000000 minor units
    expect(rollover.taxReconciliation.estimatedCorporateTaxMinor).toBe('275000000');
  });

  it('generates Cheque Maturity Report with aging buckets and statistics', async () => {
    // Test with full ISO datetime string
    const report = await chequeMaturityService.generateReport(TENANT_A, {
      asOfDate: '2026-11-08T15:30:00.000Z',
      direction: 'all',
    });

    expect(report.summary.totalCount).toBe(3);
    // Unpaid remainder: (4M + 12M + 8M) * 100 = 24M rial = 2,400,000,000 minor units
    expect(report.summary.totalAmountMinor).toBe('2400000000');
    expect(report.summary.overdueCount).toBe(1); // CHQ-101 (due 2026-11-05) is 3 days overdue
    expect(report.summary.overdueAmountMinor).toBe('400000000');
    expect(report.summary.upcomingCount).toBe(2);

    expect(report.buckets.overdue_1_30.count).toBe(1);
    expect(report.buckets.due_1_7.count).toBe(1); // CHQ-102 (due 2026-11-15 is 7 days)
    expect(report.buckets.due_1_7.items[0].chequeNumber).toBe('CHQ-102');

    expect(report.byBank.length).toBe(3);
  });

  it('enforces strict cross-tenant isolation (Tenant B sees zero rows)', async () => {
    const pkgB = await inspectorService.generatePackage(TENANT_B, 1404);
    expect(pkgB.salesReconciliation.invoicedSalesCount).toBe(0);
    expect(pkgB.salesReconciliation.invoicedSalesTotalMinor).toBe('0');
    expect(pkgB.booksAudit.totalVouchersCount).toBe(0);

    const chequeReportB = await chequeMaturityService.generateReport(TENANT_B, {
      asOfDate: '2026-11-08',
    });
    expect(chequeReportB.summary.totalCount).toBe(0);
    expect(chequeReportB.summary.totalAmountMinor).toBe('0');
  });
});
