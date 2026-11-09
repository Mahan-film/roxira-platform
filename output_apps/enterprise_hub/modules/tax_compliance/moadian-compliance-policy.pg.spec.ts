/**
 * PostgreSQL integration specs for Moadian Compliance Policies (T31)
 * Runs under a real NOSUPERUSER NOBYPASSRLS role with FORCE RLS enabled.
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../access/services/audit.service';
import { TenantScope } from '../access/services/tenant-scope';
import { PolicyService } from '../tenants/policy/policy.service';
import { MoadianCompliancePolicyService } from './services/moadian-compliance-policy.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'compliance-policy-test-only';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

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

describePg('Moadian Compliance Policies on PostgreSQL (NOSUPERUSER, FORCE RLS)', () => {
  const db = `rx_mcp_${process.pid}_${Date.now()}`;
  const role = `rx_mcp_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let policyService: PolicyService;
  let complianceService: MoadianCompliancePolicyService;
  const ownerActor = { userId: 'u1', roleKey: 'owner' };

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_PW}'`);

    owner = await new DataSource(options(db)).initialize();
    await owner.runMigrations();

    await owner.query(`GRANT CONNECT ON DATABASE "${db}" TO ${role}`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);

    app = await new DataSource({ ...options(db, role, APP_PW), extra: { max: 8 } }).initialize();

    // Verify non-superuser status
    const [roleRow] = await app.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = CURRENT_USER`,
    );
    expect(roleRow.rolsuper).toBe(false);
    expect(roleRow.rolbypassrls).toBe(false);

    const audit = { record: async (): Promise<void> => undefined } as unknown as AuditService;
    const scope = new TenantScope(app);
    policyService = new PolicyService(scope, audit);
    complianceService = new MoadianCompliancePolicyService(scope, policyService);
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('evaluates Moadian inbox age alert against live database under tenant isolation', async () => {
    const now = new Date('2026-11-09T12:00:00.000Z');
    const dayMs = 86_400_000;

    // Seed purchase invoices for T1 using owner connection (setting tenant_id explicitly)
    await owner.query(
      `INSERT INTO "invoices" (
        "id", "tenant_id", "taxInvoiceNumber", "sellerInfo", "buyerInfo", "items", "direction",
        "status", "totalAmount", "totalDiscount", "totalTax", "finalPayable", "issued_at", "createdAt"
      ) VALUES
        ('a1111111-1111-4111-8111-111111111111', $1, 'PUR-T1-01', '{"name": "فروشنده ۱"}', '{"name": "خریدار"}', '[]', 'PURCHASE', 'ISSUED', 10000000, 0, 0, 10000000, $2, $2),
        ('a2222222-2222-4222-8222-222222222222', $1, 'PUR-T1-02', '{"name": "فروشنده ۲"}', '{"name": "خریدار"}', '[]', 'PURCHASE', 'ISSUED', 20000000, 0, 0, 20000000, $3, $3),
        ('a3333333-3333-4333-8333-333333333333', $1, 'PUR-T1-03', '{"name": "فروشنده ۳"}', '{"name": "خریدار"}', '[]', 'PURCHASE', 'ISSUED', 30000000, 0, 0, 30000000, $4, $4)`,
      [
        T1,
        new Date(now.getTime() - 5 * dayMs),  // 5 days old -> ok
        new Date(now.getTime() - 21 * dayMs), // 21 days old -> warn (>= 20)
        new Date(now.getTime() - 28 * dayMs), // 28 days old -> critical (>= 27)
      ],
    );

    // Seed a purchase invoice for T2 that should NOT leak into T1
    await owner.query(
      `INSERT INTO "invoices" (
        "id", "tenant_id", "taxInvoiceNumber", "sellerInfo", "buyerInfo", "items", "direction",
        "status", "totalAmount", "totalDiscount", "totalTax", "finalPayable", "issued_at", "createdAt"
      ) VALUES
        ('b1111111-1111-4111-8111-111111111111', $1, 'PUR-T2-01', '{"name": "فروشنده دیگر"}', '{"name": "خریدار"}', '[]', 'PURCHASE', 'ISSUED', 99000000, 0, 0, 99000000, $2, $2)`,
      [T2, new Date(now.getTime() - 29 * dayMs)],
    );

    const reportT1 = await complianceService.checkInboxAge(T1, { asOf: now });

    expect(reportT1.mode).toBe('warn');
    expect(reportT1.totalPending).toBe(3);
    expect(reportT1.warningCount).toBe(1);
    expect(reportT1.criticalCount).toBe(1);
    expect(reportT1.hasWarning).toBe(true);
    expect(reportT1.hasCritical).toBe(true);

    const alertOk = reportT1.alerts.find((a) => a.taxInvoiceNumber === 'PUR-T1-01');
    expect(alertOk?.severity).toBe('ok');

    const alertWarn = reportT1.alerts.find((a) => a.taxInvoiceNumber === 'PUR-T1-02');
    expect(alertWarn?.severity).toBe('warn');
    expect(alertWarn?.remainingDaysToAutoAccept).toBe(9);

    const alertCrit = reportT1.alerts.find((a) => a.taxInvoiceNumber === 'PUR-T1-03');
    expect(alertCrit?.severity).toBe('critical');
    expect(alertCrit?.remainingDaysToAutoAccept).toBe(2);

    // Verify T2 is strictly isolated
    const reportT2 = await complianceService.checkInboxAge(T2, { asOf: now });
    expect(reportT2.totalPending).toBe(1);
    expect(reportT2.alerts[0].taxInvoiceNumber).toBe('PUR-T2-01');
  });

  it('evaluates Article 6 Sales Cap on real PostgreSQL with WARN default and refuse mode', async () => {
    const now = new Date('2026-11-09T12:00:00.000Z'); // Autumn 1405 (Q3)

    // Seed sales invoices for T1 totaling 5,904,000,000 Rial (~82% of 7,200,000,000 Rial ceiling)
    await owner.query(
      `INSERT INTO "invoices" (
        "id", "tenant_id", "taxInvoiceNumber", "sellerInfo", "buyerInfo", "items", "direction",
        "status", "totalAmount", "totalDiscount", "totalTax", "finalPayable", "issued_at", "createdAt"
      ) VALUES
        ('c1111111-1111-4111-8111-111111111111', $1, 'SALE-T1-01', '{"name": "ما"}', '{"name": "مشتری"}', '[]', 'SALE', 'ISSUED', 5904000000, 0, 0, 5904000000, $2, $2)`,
      [T1, now],
    );

    // Initial check: utilization is 82% >= 80% default threshold
    const report1 = await complianceService.checkArticle6SalesCap(T1, { asOf: now });
    expect(report1.mode).toBe('warn');
    expect(report1.utilizationPercent).toBe(82);
    expect(report1.isWarning).toBe(true);
    expect(report1.isExceeded).toBe(false);
    expect(report1.warningMessage).toContain('میزان فروش دوره به 82٪ سقف مجاز مصوب رسیده است');
    expect(report1.allowed).toBe(true);

    // Switch mode to 'refuse' using PolicyService
    await policyService.set(
      T1,
      ownerActor,
      'moadian.article_6_cap.mode',
      'refuse',
      'تنظیم سیاست سقف ماده ۶ به حالت سخت‌گیرانه برای کنترل قطعی مالیاتی',
    );

    // Prospective invoice of 1,500,000,000 Rial pushes total to 7,404,000,000 Rial (> 7,200,000,000)
    const report2 = await complianceService.checkArticle6SalesCap(T1, {
      asOf: now,
      newSalesAmountRial: 1_500_000_000,
    });
    expect(report2.isExceeded).toBe(true);
    expect(report2.allowed).toBe(false);

    // assertCanIssueInvoice must reject with BadRequestException
    await expect(
      complianceService.assertCanIssueInvoice(T1, 1_500_000_000, { asOf: now }),
    ).rejects.toThrow(BadRequestException);
  });
});
