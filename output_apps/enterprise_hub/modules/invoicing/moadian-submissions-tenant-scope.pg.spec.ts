/**
 * T209: runs as a NOSUPERUSER NOBYPASSRLS role with two tenants and proves that
 * `InvoicingRepository.findMoadianSubmissionsForInvoices` goes through TenantScope:
 * tenant B cannot read tenant A's moadian submissions.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoicingRepository } from './repositories/invoicing.repository';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const ADMIN_USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const APP_ROLE = 'rx_t209_moadian_app';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const options = (database: string, username: string, entities: unknown[]) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  database,
  entities: entities as never[],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

const adminQuery = async (sql: string) => {
  const admin = new DataSource({ ...options('postgres', ADMIN_USER, []), migrations: [] });
  await admin.initialize();
  try {
    await admin.query(sql);
  } finally {
    await admin.destroy();
  }
};

describePg('InvoicingRepository.findMoadianSubmissionsForInvoices (NOSUPERUSER NOBYPASSRLS)', () => {
  const dbName = `rx_t209_moadian_${process.pid}_${Date.now()}`;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let repo: InvoicingRepository;

  beforeAll(async () => {
    await adminQuery(`CREATE DATABASE "${dbName}"`);
    await adminQuery(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;
    `);
    ownerDs = new DataSource(
      options(dbName, ADMIN_USER, [path.join(__dirname, '../**/*.entity.ts')]),
    );
    await ownerDs.initialize();
    await ownerDs.runMigrations();
    await ownerDs.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${APP_ROLE}`);
    await ownerDs.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await ownerDs.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
    );
    await ownerDs.query(
      `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`,
    );
    appDs = new DataSource(options(dbName, APP_ROLE, [InvoiceEntity]));
    await appDs.initialize();
    // No TenantScope is injected on purpose: the repository must scope the query itself.
    repo = new InvoicingRepository(appDs.getRepository(InvoiceEntity), appDs);
  }, 180_000);

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (ownerDs?.isInitialized) await ownerDs.destroy();
    await adminQuery(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  it('returns only the calling tenant submissions', async () => {
    const invoiceA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await ownerDs.query(
      `INSERT INTO moadian_submissions (tenant_id, invoice_id, uid, tax_id, serial, status, errors, packet)
       VALUES ($1, $2, gen_random_uuid(), 'TAXIDA000000000000001', 1, 'FAILED', '[{"message":"bad"}]', '{}')`,
      [TENANT_A, invoiceA],
    );

    const own = await repo.findMoadianSubmissionsForInvoices(TENANT_A, [invoiceA]);
    expect(own.get(invoiceA)).toEqual({
      status: 'FAILED',
      errorText: 'bad',
      taxId: 'TAXIDA000000000000001',
    });
    expect((await repo.findMoadianSubmissionsForInvoices(TENANT_B, [invoiceA])).size).toBe(0);
    // A bare connection without app.tenant_id sees nothing (RLS).
    expect(await appDs.query(`SELECT 1 FROM moadian_submissions`)).toEqual([]);
  });
});
