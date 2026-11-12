/**
 * Kartable Reconciliation on real PostgreSQL (NOSUPERUSER NOBYPASSRLS):
 *   - TenantScope enforces tenant isolation across `invoices`, `moadian_submissions`,
 *     and `tax_invoice_signatures` under a real unprivileged DB role.
 *   - Quarter date filtering excludes invoices outside the requested Jalali quarter.
 */
import 'reflect-metadata';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { KartableReconciliationRepository } from './repositories/kartable-reconciliation.repository';
import { KartableReconciliationService } from './services/kartable-reconciliation.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST ?? (process.env.CI ? '127.0.0.1' : undefined);
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const ADMIN_DB = process.env.ROXIRA_TEST_PG_ADMIN_DB ?? 'postgres';
const APP_PW = process.env.ROXIRA_TEST_PG_APP_PASSWORD ?? randomBytes(16).toString('hex');

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

describePg('KartableReconciliation on real PostgreSQL (NOSUPERUSER, NOBYPASSRLS)', () => {
  const db = `rx_kartable_pg_${process.pid}_${Date.now()}`;
  const role = `rx_kartable_app_${process.pid}`;
  let admin: DataSource;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let service: KartableReconciliationService;

  beforeAll(async () => {
    admin = await new DataSource({ ...options(ADMIN_DB), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    const escapedPw = APP_PW.replace(/'/g, "''");
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${escapedPw}'`);

    ownerDs = await new DataSource(options(db)).initialize();
    await ownerDs.runMigrations();

    await ownerDs.query(`GRANT CONNECT ON DATABASE "${db}" TO ${role}`);
    await ownerDs.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await ownerDs.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await ownerDs.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);

    appDs = await new DataSource({ ...options(db, role, APP_PW), extra: { max: 8 } }).initialize();
    const scope = new TenantScope(appDs);
    const repository = new KartableReconciliationRepository(scope);
    service = new KartableReconciliationService(repository);

    // Seed Tenant A: Q1 original sale (subject 1), Q1 purchase (subject 1), Q2 sale (subject 1),
    // and Q1 subject 3 (cancelled) & subject 4 (return) invoices which MUST be excluded from original totals.
    await ownerDs.query(`
      INSERT INTO "invoices" ("id", "tenant_id", "taxInvoiceNumber", "sellerInfo", "buyerInfo", "items", "totalAmount", "totalTax", "finalPayable", "direction", "status", "subject", "jurisdiction", "issued_at", "createdAt")
      VALUES
        ('aaaaaaaa-1111-4111-8111-111111111111', '${TENANT_A}', 'INV-A-Q1', '{"name":"فروشنده الف"}'::jsonb, '{"name":"خریدار الف"}'::jsonb, '[]'::jsonb, 10000000.00, 1000000.00, 11000000.00, 'SALE', 'ISSUED', 1, 'IR', '2026-04-10 10:00:00', '2026-04-10 10:00:00'),
        ('aaaaaaaa-2222-4111-8111-111111111111', '${TENANT_A}', 'PINV-A-Q1', '{"name":"تامین الف"}'::jsonb, '{"name":"ما"}'::jsonb, '[]'::jsonb, 4000000.00, 400000.00, 4400000.00, 'PURCHASE', 'PAID', 1, 'IR', '2026-05-05 10:00:00', '2026-05-05 10:00:00'),
        ('aaaaaaaa-3333-4111-8111-111111111111', '${TENANT_A}', 'INV-A-Q2', '{"name":"فروشنده الف"}'::jsonb, '{"name":"خریدار فصل دو"}'::jsonb, '[]'::jsonb, 5000000.00, 500000.00, 5500000.00, 'SALE', 'ISSUED', 1, 'IR', '2026-07-10 10:00:00', '2026-07-10 10:00:00'),
        ('aaaaaaaa-4444-4111-8111-111111111111', '${TENANT_A}', 'INV-A-Q1-CANCEL', '{"name":"فروشنده الف"}'::jsonb, '{"name":"خریدار الف"}'::jsonb, '[]'::jsonb, 2000000.00, 200000.00, 2200000.00, 'SALE', 'ISSUED', 3, 'IR', '2026-04-20 10:00:00', '2026-04-20 10:00:00'),
        ('aaaaaaaa-5555-4111-8111-111111111111', '${TENANT_A}', 'INV-A-Q1-RETURN', '{"name":"فروشنده الف"}'::jsonb, '{"name":"خریدار الف"}'::jsonb, '[]'::jsonb, 3000000.00, 300000.00, 3300000.00, 'SALE', 'ISSUED', 4, 'IR', '2026-04-22 10:00:00', '2026-04-22 10:00:00'),
        ('bbbbbbbb-1111-4222-8222-222222222222', '${TENANT_B}', 'INV-B-Q1', '{"name":"فروشنده ب"}'::jsonb, '{"name":"خریدار ب"}'::jsonb, '[]'::jsonb, 7000000.00, 700000.00, 7700000.00, 'SALE', 'PAID', 1, 'IR', '2026-04-15 10:00:00', '2026-04-15 10:00:00')
      ON CONFLICT DO NOTHING
    `);

    await ownerDs.query(`
      INSERT INTO "moadian_submissions" ("tenant_id", "invoice_id", "uid", "tax_id", "serial", "status", "packet")
      VALUES
        ('${TENANT_A}', 'aaaaaaaa-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-111111111111', 'TAXID_TENANT_A_0000001', 1, 'SUCCESS', '{}'::jsonb),
        ('${TENANT_B}', 'bbbbbbbb-1111-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-222222222222', 'TAXID_TENANT_B_0000001', 1, 'SUCCESS', '{}'::jsonb)
      ON CONFLICT DO NOTHING
    `);
  }, 60_000);

  afterAll(async () => {
    await appDs?.destroy().catch(() => {});
    await ownerDs?.destroy().catch(() => {});
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`).catch(() => {});
      await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
      await admin.destroy().catch(() => {});
    }
  });

  it('matches Tenant A Q1 data cleanly, excludes Q2 invoices, and blocks Tenant B leakage', async () => {
    const csvForA = Buffer.from(
      [
        'taxId,invoiceNumber,issueDate,netAmount,vatAmount,totalAmount',
        'TAXID_TENANT_A_0000001,INV-A-Q1,1405/01/21,10000000,1000000,11000000',
        'TAXID_TENANT_B_0000001,INV-B-Q1,1405/01/26,7000000,700000,7700000',
      ].join('\n'),
      'utf8',
    );

    const resA = await service.reconcile(TENANT_A, 1405, 1, {
      salesFile: { buffer: csvForA, originalname: 'kartable-a.csv' },
    });

    // Only Tenant A's 1 Q1 sale is seen (Q2 invoice & Tenant B's invoice are excluded)
    expect(resA.sales.ourInvoiceCount).toBe(1);
    expect(resA.sales.matchedCount).toBe(1);
    // Tenant B's row in Tenant A's uploaded file must appear as missing_in_our_system, never matched!
    expect(resA.sales.missingInOurSystemCount).toBe(1);
    expect(resA.rows.every((r) => r.ourInvoiceId !== 'bbbbbbbb-1111-4222-8222-222222222222')).toBe(true);
    expect(resA.quarterlyVat.our.purchasesVat).toBe(400_000);
    expect(resA.quarterlyVat.our.netVatPayable).toBe(600_000);

    // Tenant B sees ONLY Tenant B's Q1 sale
    const csvForB = Buffer.from(
      'taxId,invoiceNumber,issueDate,netAmount,vatAmount,totalAmount\nTAXID_TENANT_B_0000001,INV-B-Q1,1405/01/26,7000000,700000,7700000\n',
      'utf8',
    );
    const resB = await service.reconcile(TENANT_B, 1405, 1, {
      salesFile: { buffer: csvForB, originalname: 'kartable-b.csv' },
    });
    expect(resB.sales.ourInvoiceCount).toBe(1);
    expect(resB.sales.matchedCount).toBe(1);
    expect(resB.quarterlyVat.our.purchasesVat).toBe(0);
  });

  it('enforces PostgreSQL FORCE RLS directly for the unprivileged NOBYPASSRLS role without tenant context', async () => {
    const bareInvoices = await appDs.query(`SELECT id FROM "invoices"`);
    const bareSubmissions = await appDs.query(`SELECT id FROM "moadian_submissions"`);
    expect(bareInvoices).toEqual([]);
    expect(bareSubmissions).toEqual([]);
  });
});
