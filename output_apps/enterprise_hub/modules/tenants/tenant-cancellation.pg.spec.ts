/**
 * Tenant cancellation and purge end-to-end spec on a REAL PostgreSQL
 * as a non-superuser role (NOSUPERUSER NOBYPASSRLS) under RLS.
 *
 * Opt-in: skipped unless ROXIRA_TEST_PG_HOST is set.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { TenantEntity } from './entities/tenant.entity';
import { TenantStatus } from './enums/tenant-status.enum';
import { TenantsRepository } from './repositories/tenants.repository';
import { TenantCancellationService } from './services/tenant-cancellation.service';
import { TenantExportRepository } from '../data_import/repositories/tenant-export.repository';
import { TenantExportService } from '../data_import/services/tenant-export.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'cancel-app-test-only';
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

describePg('Tenant cancellation, export, and purge on PostgreSQL (non-superuser, FORCE RLS)', () => {
  const db = `rx_cancel_${process.pid}_${Date.now()}`;
  const role = `rx_cancel_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let cancellationService: TenantCancellationService;
  let exportService: TenantExportService;
  let tenantsRepo: TenantsRepository;

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

    tenantsRepo = new TenantsRepository(app.getRepository(TenantEntity));
    cancellationService = new TenantCancellationService(tenantsRepo, app);
    const tenantScope = new TenantScope(app);
    const exportRepo = new TenantExportRepository(tenantScope);
    exportService = new TenantExportService(exportRepo);

    // Seed test tenants directly via owner
    await owner.query(
      `INSERT INTO "tenants" ("id", "name", "slug", "status", "created_at", "updated_at")
       VALUES ($1, 'Tenant One', 't1', 'active', NOW(), NOW()),
              ($2, 'Tenant Two', 't2', 'active', NOW(), NOW())
       ON CONFLICT ("id") DO NOTHING`,
      [T1, T2],
    );

    // Seed some test data under T1 and T2
    await owner.query(
      `INSERT INTO "erp_parties" ("tenant_id", "code", "name", "created_at", "updated_at")
       VALUES ($1, 'P1', 'Party 1', NOW(), NOW()),
              ($2, 'P2', 'Party 2', NOW(), NOW())`,
      [T1, T2],
    );
  }, 120000);

  afterAll(async () => {
    await app?.destroy().catch(() => {});
    await owner?.destroy().catch(() => {});
    if (admin) {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [db],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${db}"`);
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.destroy().catch(() => {});
    }
  });

  it('cancels tenant T1 and sets status to cancelled_readonly with retention period', async () => {
    const res = await cancellationService.cancelTenant(T1, 'End of subscription', 30);
    expect(res.status).toBe(TenantStatus.CANCELLED_READONLY);
    expect(res.isReadonly).toBe(true);
    expect(res.cancellationReason).toBe('End of subscription');
    expect(res.daysRemaining).toBe(30);

    const saved = await tenantsRepo.findById(T1);
    expect(saved?.status).toBe(TenantStatus.CANCELLED_READONLY);
    expect(saved?.deleteAfter).toBeDefined();
  });

  it('generates full ZIP archive for cancelled tenant with valid checksum', async () => {
    const { buffer, metadata, filename } = await exportService.generateFullExportZip(T1);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(filename).toContain(`tenant-export-${T1.slice(0, 8)}-`);
    expect(metadata.checksum).toHaveLength(64);
    expect(metadata.tenantId).toBe(T1);
  });

  it('purges tenant T1 data completely while keeping tenant T2 untouched', async () => {
    const purgeResult = await cancellationService.purgeTenant(T1);
    expect(purgeResult.success).toBe(true);
    expect(purgeResult.tenantId).toBe(T1);

    // Verify T1 parties are deleted
    const t1Parties = await owner.query(`SELECT * FROM "erp_parties" WHERE "tenant_id" = $1`, [T1]);
    expect(t1Parties).toHaveLength(0);

    // Verify T2 parties remain intact
    const t2Parties = await owner.query(`SELECT * FROM "erp_parties" WHERE "tenant_id" = $1`, [T2]);
    expect(t2Parties).toHaveLength(1);

    // Verify tenant record is marked purged
    const purgedTenant = await tenantsRepo.findById(T1);
    expect(purgedTenant?.status).toBe(TenantStatus.PURGED);
    expect(purgedTenant?.purgedAt).toBeDefined();
  });
});
