/**
 * PostgreSQL RLS integration spec for T82 Moadian sync & invoice list column:
 * - Runs as real NOSUPERUSER NOBYPASSRLS PostgreSQL role through TenantScope
 * - Verifies `relrowsecurity` & `relforcerowsecurity` on `moadian_submissions` and `invoices`
 * - Exercises `MoadianRepository.listTenantIds`, `MoadianRepository.findNonFinalSubmissions`,
 *   and `InvoicingRepository.findMoadianSubmissionsForInvoices` with strict tenant isolation
 */
import 'reflect-metadata';
import * as crypto from 'crypto';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { InvoicingRepository } from '../invoicing/repositories/invoicing.repository';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { MoadianCredentialEntity } from './entities/moadian-credential.entity';
import { MoadianSubmissionEntity } from './entities/moadian-submission.entity';
import { MoadianSubmissionStatus } from './enums/moadian.enum';
import { MoadianRepository } from './repositories/moadian.repository';

const HOST = process.env.ROXIRA_TEST_PG_HOST ?? (process.env.CI ? '127.0.0.1' : undefined);
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const ADMIN_DB = process.env.ROXIRA_TEST_PG_ADMIN_DB ?? (OWNER === 'mac' ? 'template1' : 'postgres');
const APP_PW = crypto.randomBytes(16).toString('hex');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INV_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

describePg('T82 Moadian sync repositories on PostgreSQL (NOSUPERUSER, FORCE RLS)', () => {
  const db = `rx_moadian_sync_${process.pid}_${Date.now()}`;
  const role = `rx_moadian_app_${process.pid}`;
  let admin: DataSource;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let tenantScope: TenantScope;
  let moadianRepo: MoadianRepository;
  let invoicingRepo: InvoicingRepository;

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

    moadianRepo = new MoadianRepository(
      appDs.getRepository(MoadianCredentialEntity),
      appDs.getRepository(MoadianSubmissionEntity),
      tenantScope,
    );
    invoicingRepo = new InvoicingRepository(
      appDs.getRepository(InvoiceEntity),
      appDs,
      tenantScope,
    );

    await ownerDs.query(
      `INSERT INTO "tenants" ("id", "slug", "name", "is_active") VALUES
        ($1, 't82-a', 'Tenant A', true),
        ($2, 't82-b', 'Tenant B', true)
       ON CONFLICT DO NOTHING`,
      [TENANT_A, TENANT_B],
    );

    await moadianRepo.createSubmission(TENANT_A, {
      invoiceId: INV_A,
      uid: '11111111-aaaa-4111-8111-000000000001',
      taxId: 'TAX-A-1',
      serial: '1001',
      referenceNumber: null,
      packet: { header: {}, body: [] } as never,
      status: MoadianSubmissionStatus.ERROR,
      errors: [{ code: 'TRANSPORT', message: 'conn reset' }],
      warnings: [],
      pollCount: 0,
    });
    await moadianRepo.createSubmission(TENANT_B, {
      invoiceId: INV_B,
      uid: '22222222-bbbb-4222-8222-000000000002',
      taxId: 'TAX-B-1',
      serial: '2001',
      referenceNumber: 'REF-B-1',
      packet: { header: {}, body: [] } as never,
      status: MoadianSubmissionStatus.SENT,
      errors: [],
      warnings: [],
      pollCount: 1,
    });
  });

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (ownerDs?.isInitialized) await ownerDs.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${db}"`);
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.destroy();
    }
  });

  it('enforces FORCE RLS on moadian_submissions and invoices', async () => {
    const rlsRows: Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }> =
      await ownerDs.query(`
        SELECT relname, relrowsecurity, relforcerowsecurity
          FROM pg_class
         WHERE relname IN ('moadian_submissions', 'moadian_credentials', 'invoices')
         ORDER BY relname
      `);
    expect(rlsRows).toHaveLength(3);
    for (const row of rlsRows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('listTenantIds + findNonFinalSubmissions enumerate both tenants cleanly inside TenantScope', async () => {
    const tenantIds = await moadianRepo.listTenantIds();
    expect(tenantIds).toEqual(expect.arrayContaining([TENANT_A, TENANT_B]));

    const aSubs = await moadianRepo.findNonFinalSubmissions(TENANT_A);
    expect(aSubs.map((s) => s.invoiceId)).toEqual([INV_A]);

    const bSubs = await moadianRepo.findNonFinalSubmissions(TENANT_B);
    expect(bSubs.map((s) => s.invoiceId)).toEqual([INV_B]);
  });

  it('findMoadianSubmissionsForInvoices returns only the scoped tenant rows', async () => {
    const mapA = await invoicingRepo.findMoadianSubmissionsForInvoices(TENANT_A, [INV_A, INV_B]);
    expect(mapA.size).toBe(1);
    expect(mapA.get(INV_A)).toMatchObject({
      status: 'ERROR',
      errorText: 'conn reset',
      taxId: 'TAX-A-1',
    });
    expect(mapA.has(INV_B)).toBe(false);
  });
});
