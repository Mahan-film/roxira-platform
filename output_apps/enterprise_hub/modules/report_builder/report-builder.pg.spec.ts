/**
 * Report Builder & Combined Reports on real PostgreSQL (NOSUPERUSER, NOBYPASSRLS, FORCE RLS):
 *   - Read-only transaction enforcement (`SET TRANSACTION READ ONLY`)
 *   - 5-second statement timeout enforcement (`SET LOCAL statement_timeout = '5000ms'`)
 *   - Cross-domain combined report queries
 *   - Cross-tenant RLS isolation on datasets and saved report templates
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55471 npx jest modules/report_builder/report-builder.pg.spec.ts --runInBand
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { AuditService } from '../access/services/audit.service';
import { TenantScope } from '../access/services/tenant-scope';
import { ReportBuilderRepository } from './repositories/report-builder.repository';
import { ReportBuilderService } from './services/report-builder.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'report-builder-test-only';

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

describePg('Report Builder on PostgreSQL (NOSUPERUSER NOBYPASSRLS, FORCE RLS)', () => {
  const db = `rx_report_builder_${process.pid}_${Date.now()}`;
  const role = `rx_rb_app_${process.pid}`;
  let admin: DataSource;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let repo: ReportBuilderRepository;
  let service: ReportBuilderService;

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
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

    scope = new TenantScope(appDs);
    repo = new ReportBuilderRepository(scope);
    const audit = { record: async (): Promise<void> => undefined } as unknown as AuditService;
    service = new ReportBuilderService(repo, audit);

    // Seed test data for Tenant A
    await ownerDs.query(`
      INSERT INTO "fin_chart_of_accounts" ("id", "tenant_id", "code", "name", "account_type")
      VALUES
        (1001, '${TENANT_A}', '1010', 'صندوق مرکزی', 'ASSET'),
        (1002, '${TENANT_A}', '4010', 'درآمد فروش', 'REVENUE')
      ON CONFLICT DO NOTHING
    `);
    await ownerDs.query(`
      INSERT INTO "fin_journal_entries" ("id", "tenant_id", "entry_number", "date", "description", "status")
      VALUES (2001, '${TENANT_A}', 'JV-A1', '2026-11-01', 'ثبت سند آزمایشی', 'POSTED')
      ON CONFLICT DO NOTHING
    `);
    await ownerDs.query(`
      INSERT INTO "fin_journal_entry_lines" ("id", "tenant_id", "journal_entry_id", "account_id", "debit", "credit", "description")
      VALUES
        (3001, '${TENANT_A}', 2001, 1001, 5000000, 0, 'واریز اولیه'),
        (3002, '${TENANT_A}', 2001, 1002, 0, 5000000, 'درآمد متناظر')
      ON CONFLICT DO NOTHING
    `);
    await ownerDs.query(`
      INSERT INTO "invoices" ("id", "tenant_id", "taxInvoiceNumber", "sellerInfo", "buyerInfo", "items", "totalAmount", "finalPayable", "status")
      VALUES ('33333333-3333-4333-8333-333333333333', '${TENANT_A}', 'INV-A1', '{}'::jsonb, '{"name": "شرکت مشتری"}'::jsonb, '[]'::jsonb, 5000000, 5000000, 'PAID')
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

  it('runs query inside a read-only transaction and forbids writes', async () => {
    // Attempting a write query via executeReadOnlyQuery must fail due to READ ONLY transaction
    await expect(
      repo.executeReadOnlyQuery(
        TENANT_A,
        `INSERT INTO "fin_chart_of_accounts" ("tenant_id", "code", "name", "account_type")
         VALUES ($1, '9999', 'حساب تستی', 'ASSET')`,
        [TENANT_A],
      ),
    ).rejects.toThrow(/read-only transaction/i);
  });

  it('enforces 5-second statement timeout on slow / runaway queries', async () => {
    await expect(
      repo.executeReadOnlyQuery(
        TENANT_A,
        `SELECT pg_sleep(6)`,
        [],
      ),
    ).rejects.toThrow(/statement_timeout|canceling statement due to statement timeout/i);
  }, 15_000);

  it('executes whitelisted accounting ledger query and returns formatted rows', async () => {
    const res = await service.executeQuery(TENANT_A, {
      dataset: 'accounting_ledger',
      columns: ['entry_number', 'account_code', 'account_name', 'debit', 'status'],
      filters: [{ column: 'account_code', op: 'eq', value: '1010' }],
    });

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].entry_number).toBe('JV-A1');
    expect(res.rows[0].account_code).toBe('1010');
    expect(Number(res.rows[0].debit)).toBe(5000000);
  });

  it('executes combined sales and accounting query linking invoice to journal entry', async () => {
    const res = await service.executeQuery(TENANT_A, {
      dataset: 'combined_sales_accounting',
      columns: ['invoice_number', 'invoice_amount', 'customer_name'],
    });

    expect(res.rows.length).toBeGreaterThanOrEqual(1);
    expect(res.rows[0].invoice_number).toBe('INV-A1');
    expect(res.rows[0].customer_name).toBe('شرکت مشتری');
  });

  it('saves, lists, and isolates report templates across tenants with FORCE RLS', async () => {
    const template = await service.saveTemplate(TENANT_A, 'u-admin-1', {
      name: 'گزارش ماهانه صندوق',
      description: 'فیلتر روی حساب ۱۰۱۰',
      dataset: 'accounting_ledger',
      config: {
        dataset: 'accounting_ledger',
        columns: ['entry_number', 'debit', 'credit'],
      },
    });

    expect(template.id).toBeDefined();

    const listA = await service.listTemplates(TENANT_A);
    expect(listA.some((t) => t.id === template.id)).toBe(true);

    // Tenant B cannot see Tenant A templates
    const listB = await service.listTemplates(TENANT_B);
    expect(listB.some((t) => t.id === template.id)).toBe(false);

    // Cross-tenant RLS isolation on ledger rows
    const resB = await service.executeQuery(TENANT_B, {
      dataset: 'accounting_ledger',
    });
    expect(resB.rows.length).toBe(0);
  });
});
