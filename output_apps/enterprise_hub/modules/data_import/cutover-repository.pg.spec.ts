/**
 * Real PostgreSQL FORCE RLS + uniqueness + atomic transaction rollback spec for CutoverRepository (#1217 Part 1).
 * Connects as a NOSUPERUSER NOBYPASSRLS role (`rx_cutover_rls_app`).
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AuditLogEntity } from '../access/entities/audit-log.entity';
import { PeriodLockEntity } from '../accounting/entities/period-lock.entity';
import { CutoverEntity } from './entities/cutover.entity';
import { CutoverRepository } from './repositories/cutover.repository';

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
  entities: [path.join(__dirname, '../**/*.entity.ts')],
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

describePg('CutoverRepository FORCE RLS, unique active index & atomic rollback on PostgreSQL (#1217)', () => {
  const dbName = `rx_cutover_rls_${process.pid}_${Date.now()}`;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let cutoverRepo: CutoverRepository;

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

    ownerDs = new DataSource(baseOptions(dbName, ADMIN_USER));
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
  }, 180_000);

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (ownerDs?.isInitialized) await ownerDs.destroy();
    await adminQuery(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  it('enables FORCE RLS and creates UQ_data_import_cutovers_one_active_per_tenant', async () => {
    const rlsRows = (await appDs.query(
      `SELECT relrowsecurity AS rls, relforcerowsecurity AS force_rls
       FROM pg_class WHERE relname = 'data_import_cutovers'`,
    )) as Array<{ rls: boolean; force_rls: boolean }>;
    expect(rlsRows).toEqual([{ rls: true, force_rls: true }]);

    const indexes = (await appDs.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'data_import_cutovers'`,
    )) as Array<{ indexname: string }>;
    expect(indexes.map((i) => i.indexname)).toContain(
      'UQ_data_import_cutovers_one_active_per_tenant',
    );
  });

  it('enforces tenant isolation, unique active cutover per tenant, and atomic rollback under NOSUPERUSER NOBYPASSRLS', async () => {
    // Mid-way failure rolls back both PeriodLockEntity and CutoverEntity cleanly (0 orphans).
    await expect(
      cutoverRepo.runInTenantTransaction(TENANT_A, async (manager) => {
        const lock = await manager.save(
          manager.create(PeriodLockEntity, {
            tenantId: TENANT_A,
            periodStart: '1970-01-01',
            periodEnd: '2025-12-31',
            reason: 'cutover-rollback-test',
            lockedBy: 'user-owner-1',
          }),
        );
        await cutoverRepo.createCutover(
          TENANT_A,
          {
            cutoverDate: '2026-01-01',
            preCutoverLockDate: '2025-12-31',
            periodLockId: lock.id,
            openingJournalEntryId: 42,
            legacyNumberPrefix: 'LEGACY-',
            executedBy: 'user-owner-1',
          },
          manager,
        );
        throw new Error('simulated mid-way failure');
      }),
    ).rejects.toThrow('simulated mid-way failure');

    expect(await cutoverRepo.findActive(TENANT_A)).toBeNull();
    const locksAfterRollback = await scope.run(TENANT_A, (m) =>
      m.getRepository(PeriodLockEntity).find({ where: { tenantId: TENANT_A } }),
    );
    expect(locksAfterRollback).toHaveLength(0);
    const auditsAfterRollback = await scope.run(TENANT_A, (m) =>
      m.getRepository(AuditLogEntity).find({ where: { tenantId: TENANT_A } }),
    );
    expect(auditsAfterRollback).toHaveLength(0);

    // Concurrent go-live for the same tenant: advisory lock + unique partial index allow strictly one.
    const results = await Promise.allSettled([
      cutoverRepo.runInTenantTransaction(TENANT_A, async (manager) => {
        await cutoverRepo.acquireTenantCutoverLock(TENANT_A, manager);
        if (await cutoverRepo.findActive(TENANT_A, manager)) {
          throw new Error('ALREADY_ACTIVE');
        }
        await new Promise((r) => setTimeout(r, 50));
        return cutoverRepo.createCutover(
          TENANT_A,
          {
            cutoverDate: '2026-01-01',
            preCutoverLockDate: '2025-12-31',
            periodLockId: 101,
            openingJournalEntryId: 201,
            legacyNumberPrefix: 'LEGACY-',
            executedBy: 'user-owner-1',
          },
          manager,
        );
      }),
      cutoverRepo.runInTenantTransaction(TENANT_A, async (manager) => {
        await cutoverRepo.acquireTenantCutoverLock(TENANT_A, manager);
        if (await cutoverRepo.findActive(TENANT_A, manager)) {
          throw new Error('ALREADY_ACTIVE');
        }
        return cutoverRepo.createCutover(
          TENANT_A,
          {
            cutoverDate: '2026-01-01',
            preCutoverLockDate: '2025-12-31',
            periodLockId: 102,
            openingJournalEntryId: 202,
            legacyNumberPrefix: 'LEGACY-',
            executedBy: 'user-owner-2',
          },
          manager,
        );
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    // Direct DB unique partial index also rejects a second active cutover even without findActive.
    await expect(
      cutoverRepo.createCutover(TENANT_A, {
        cutoverDate: '2026-02-01',
        preCutoverLockDate: '2026-01-31',
        periodLockId: 103,
        openingJournalEntryId: 203,
        legacyNumberPrefix: 'LEGACY-',
        executedBy: 'user-owner-1',
      }),
    ).rejects.toThrow(/UQ_data_import_cutovers_one_active_per_tenant|duplicate key/i);

    // Tenant B is isolated and can create its own active cutover.
    expect(await cutoverRepo.findActive(TENANT_B)).toBeNull();
    const cutoverB = await cutoverRepo.createCutover(TENANT_B, {
      cutoverDate: '2026-03-01',
      preCutoverLockDate: '2026-02-28',
      periodLockId: 301,
      openingJournalEntryId: 401,
      legacyNumberPrefix: 'OLD-',
      executedBy: 'user-owner-b',
    });
    expect(cutoverB.tenantId).toBe(TENANT_B);
    expect(await cutoverRepo.list(TENANT_A)).toHaveLength(1);
    expect(await cutoverRepo.list(TENANT_B)).toHaveLength(1);

    // Unscoped query sees 0 rows under FORCE RLS.
    const unscoped = (await appDs.query(
      `SELECT count(*)::int AS n FROM "data_import_cutovers"`,
    )) as Array<{ n: number }>;
    expect(unscoped[0].n).toBe(0);
  });
});
