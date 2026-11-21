/**
 * Real PostgreSQL FORCE RLS integration test for Cutover Wizard (T327 R32):
 * - Connects as a NOSUPERUSER NOBYPASSRLS role (`rx_cutover_rls_app`).
 * - Verifies `data_import_cutovers` has `relrowsecurity = true` and `relforcerowsecurity = true`.
 * - Proves strict tenant isolation under `TenantScope` for `CutoverRepository`.
 * - Verifies unscoped queries as `rx_cutover_rls_app` return 0 rows (default deny).
 */
import 'reflect-metadata';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { CutoverEntity } from './entities/cutover.entity';
import { CutoverRepository } from './repositories/cutover.repository';
import { CutoverWizardService } from './services/cutover-wizard.service';
import { ImportTieOutEngine } from './analysis/import-tie-out.engine';
import { EffectiveTieOutConfigRegistry } from './analysis/effective-tie-out-config.registry';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const ADMIN_USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const APP_ROLE = 'rx_cutover_rls_app';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const baseOptions = (database: string, username: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  database,
  entities: [CutoverEntity],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

const adminQuery = async (sql: string) => {
  const admin = new DataSource({
    ...baseOptions('postgres', ADMIN_USER),
    entities: [],
    migrations: [],
  });
  await admin.initialize();
  try {
    await admin.query(sql);
  } finally {
    await admin.destroy();
  }
};

describePg('Cutover Wizard FORCE RLS on PostgreSQL (NOSUPERUSER NOBYPASSRLS)', () => {
  const dbName = `rx_cutover_rls_${process.pid}_${Date.now()}`;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let cutoverRepo: CutoverRepository;
  let wizardService: CutoverWizardService;

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

    ownerDs = new DataSource({
      ...baseOptions(dbName, ADMIN_USER),
      entities: [path.join(__dirname, '../**/*.entity.ts')],
    });
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

    appDs = new DataSource(baseOptions(dbName, APP_ROLE));
    await appDs.initialize();
    scope = new TenantScope(appDs);

    cutoverRepo = new CutoverRepository(appDs.getRepository(CutoverEntity), scope);
    const tieOutEngine = new ImportTieOutEngine(new EffectiveTieOutConfigRegistry());
    wizardService = new CutoverWizardService(
      tieOutEngine,
      {} as any,
      cutoverRepo,
    );
  }, 180_000);

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (ownerDs?.isInitialized) await ownerDs.destroy();
    await adminQuery(`DROP DATABASE IF EXISTS "${dbName}"`);
  });

  it('verifies data_import_cutovers has relrowsecurity and relforcerowsecurity enabled', async () => {
    const res = await ownerDs.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = 'data_import_cutovers'
    `);
    expect(res).toHaveLength(1);
    expect(res[0].relrowsecurity).toBe(true);
    expect(res[0].relforcerowsecurity).toBe(true);
  });

  it('isolates CutoverRepository across tenants under NOSUPERUSER NOBYPASSRLS', async () => {
    const cutoverA = await cutoverRepo.createCutover(TENANT_A, {
      id: randomUUID(),
      cutoverDate: '2026-03-21',
      preCutoverLockDate: '2026-03-20',
      periodLockId: 101,
      openingJournalEntryId: 501,
      legacyNumberPrefix: 'LEGACY-',
      isGoLiveActive: true,
    });

    const cutoverB = await cutoverRepo.createCutover(TENANT_B, {
      id: randomUUID(),
      cutoverDate: '2026-04-01',
      preCutoverLockDate: '2026-03-31',
      periodLockId: 102,
      openingJournalEntryId: 502,
      legacyNumberPrefix: 'OLD-',
      isGoLiveActive: true,
    });

    // Tenant A only sees their own active cutover
    const activeA = await cutoverRepo.findActive(TENANT_A);
    expect(activeA?.id).toBe(cutoverA.id);
    expect(activeA?.cutoverDate).toBe('2026-03-21');
    expect(activeA?.preCutoverLockDate).toBe('2026-03-20');
    expect(activeA?.legacyNumberPrefix).toBe('LEGACY-');

    // Tenant B only sees their own active cutover
    const activeB = await cutoverRepo.findActive(TENANT_B);
    expect(activeB?.id).toBe(cutoverB.id);
    expect(activeB?.cutoverDate).toBe('2026-04-01');
    expect(activeB?.preCutoverLockDate).toBe('2026-03-31');
    expect(activeB?.legacyNumberPrefix).toBe('OLD-');

    // List all scoped per tenant
    const listA = await cutoverRepo.listAll(TENANT_A);
    expect(listA.map((c) => c.id)).toEqual([cutoverA.id]);

    const listB = await cutoverRepo.listAll(TENANT_B);
    expect(listB.map((c) => c.id)).toEqual([cutoverB.id]);

    // Service getCutoverStatus respects tenant RLS isolation
    const statusA = await wizardService.getCutoverStatus(TENANT_A);
    expect(statusA.isGoLiveActive).toBe(true);
    expect(statusA.cutoverDate).toBe('2026-03-21');
    expect(statusA.legacyNumberPrefix).toBe('LEGACY-');

    const statusB = await wizardService.getCutoverStatus(TENANT_B);
    expect(statusB.isGoLiveActive).toBe(true);
    expect(statusB.cutoverDate).toBe('2026-04-01');
    expect(statusB.legacyNumberPrefix).toBe('OLD-');

    // Default deny: Unscoped query under NOSUPERUSER role returns 0 rows
    const unscoped = await appDs.query(
      `SELECT count(*)::int AS n FROM "data_import_cutovers"`,
    );
    expect(unscoped[0].n).toBe(0);
  });
});
