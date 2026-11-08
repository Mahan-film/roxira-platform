/**
 * Real PostgreSQL FORCE RLS integration test for Data Import & Damages:
 * - Connects as a NOSUPERUSER NOBYPASSRLS role (`rx_data_import_rls_app`).
 * - Verifies all 4 tables (`damage_calculations`, `data_import_batch_items`, `data_import_batches`, `data_import_mapping_memory`)
 *   have `relrowsecurity = true` and `relforcerowsecurity = true`.
 * - Exercises the real `DataImportBatchRepository`, `ImportMappingMemoryRepository`, and `DamagesRepository`
 *   methods across two tenants and proves strict isolation.
 */
import 'reflect-metadata';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { DATA_IMPORT_AND_DAMAGES_RLS_TABLES } from '../../migrations/1789900001000-EnableRlsDataImportAndDamages';
import { TenantScope } from '../access/services/tenant-scope';
import { DamageCalculationEntity } from '../damages/entities/damage-calculation.entity';
import { DamageCalculationMethod } from '../damages/enums/calculation-method.enum';
import { DamagesRepository } from '../damages/repositories/damages.repository';
import { DataImportBatchItemEntity } from './entities/data-import-batch-item.entity';
import { DataImportBatchEntity } from './entities/data-import-batch.entity';
import { ImportMappingMemoryEntity } from './entities/import-mapping-memory.entity';
import { DataImportBatchRepository } from './repositories/data-import-batch.repository';
import { ImportMappingMemoryRepository } from './repositories/import-mapping-memory.repository';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const ADMIN_USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const APP_ROLE = 'rx_data_import_rls_app';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const baseOptions = (database: string, username: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  database,
  entities: [
    DataImportBatchEntity,
    DataImportBatchItemEntity,
    ImportMappingMemoryEntity,
    DamageCalculationEntity,
  ],
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

describePg('Data Import & Damages FORCE RLS on PostgreSQL (NOSUPERUSER NOBYPASSRLS)', () => {
  const dbName = `rx_data_import_rls_${process.pid}_${Date.now()}`;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let batchRepo: DataImportBatchRepository;
  let memoryRepo: ImportMappingMemoryRepository;
  let damagesRepo: DamagesRepository;

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

    batchRepo = new DataImportBatchRepository(
      appDs.getRepository(DataImportBatchEntity),
      appDs.getRepository(DataImportBatchItemEntity),
      scope,
    );
    memoryRepo = new ImportMappingMemoryRepository(
      appDs.getRepository(ImportMappingMemoryEntity),
      scope,
    );
    damagesRepo = new DamagesRepository(
      appDs.getRepository(DamageCalculationEntity),
      scope,
    );
  }, 180_000);

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (ownerDs?.isInitialized) await ownerDs.destroy();
    await adminQuery(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  it('enables and forces RLS on all 4 data_import and damages tables', async () => {
    const rows = (await appDs.query(
      `SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [DATA_IMPORT_AND_DAMAGES_RLS_TABLES],
    )) as Array<{ table_name: string; rls: boolean; force_rls: boolean }>;

    expect(rows).toEqual(
      DATA_IMPORT_AND_DAMAGES_RLS_TABLES.map((table_name) => ({
        table_name,
        rls: true,
        force_rls: true,
      })),
    );
  });

  it('isolates DataImportBatchRepository across tenants under NOSUPERUSER NOBYPASSRLS', async () => {
    const batchIdA = randomUUID();
    const batchIdB = randomUUID();

    await batchRepo.createBatch(TENANT_A, {
      id: batchIdA,
      entity: 'crm_leads',
      fileName: 'leads-a.csv',
      inserted: 2,
    });
    await batchRepo.addItems(TENANT_A, batchIdA, 'crm_leads', [
      { ownerId: 101, rowNumber: 1 },
      { ownerId: 102, rowNumber: 2 },
    ]);

    await batchRepo.createBatch(TENANT_B, {
      id: batchIdB,
      entity: 'crm_leads',
      fileName: 'leads-b.csv',
      inserted: 1,
    });
    await batchRepo.addItems(TENANT_B, batchIdB, 'crm_leads', [
      { ownerId: 201, rowNumber: 1 },
    ]);

    expect((await batchRepo.findBatch(TENANT_A, batchIdA))?.fileName).toBe('leads-a.csv');
    expect(await batchRepo.findBatch(TENANT_B, batchIdA)).toBeNull();
    expect((await batchRepo.listBatches(TENANT_A)).map((b) => b.id)).toEqual([batchIdA]);
    expect((await batchRepo.listBatches(TENANT_B)).map((b) => b.id)).toEqual([batchIdB]);
    expect(await batchRepo.findItems(TENANT_A, batchIdA)).toHaveLength(2);
    expect(await batchRepo.findItems(TENANT_B, batchIdA)).toEqual([]);

    // Tenant B cannot modify or delete Tenant A's batch or items
    await batchRepo.markUndone(TENANT_B, batchIdA);
    await batchRepo.removeItems(TENANT_B, batchIdA);
    await batchRepo.removeBatch(TENANT_B, batchIdA);
    expect((await batchRepo.findBatch(TENANT_A, batchIdA))?.undone).toBe(false);
    expect(await batchRepo.findItems(TENANT_A, batchIdA)).toHaveLength(2);
  });

  it('isolates ImportMappingMemoryRepository across tenants under NOSUPERUSER NOBYPASSRLS', async () => {
    await memoryRepo.upsert(TENANT_A, 'sig-leads', 'crm_leads', { نام: 'name', تلفن: 'phone' });
    await memoryRepo.upsert(TENANT_A, 'sig-leads', 'crm_leads', { نام: 'name', موبایل: 'phone' });

    const memA = await memoryRepo.find(TENANT_A, 'sig-leads');
    expect(memA?.uses).toBe(2);
    expect(await memoryRepo.find(TENANT_B, 'sig-leads')).toBeNull();

    // Tenant B clear does not affect Tenant A
    await memoryRepo.clear(TENANT_B);
    expect((await memoryRepo.find(TENANT_A, 'sig-leads'))?.uses).toBe(2);
  });

  it('isolates DamagesRepository across tenants under NOSUPERUSER NOBYPASSRLS', async () => {
    const calcA = await damagesRepo.create(TENANT_A, {
      principalAmount: 10_000_000,
      dueDate: '2025-01-01',
      paymentDate: '2026-01-01',
      calculationMethod: DamageCalculationMethod.CPI_INDEX,
      delayedDays: 365,
      damageAmount: 3_500_000,
      totalPayable: 13_500_000,
      legalBasis: 'ماده ۵۲۲ قانون آیین دادرسی مدنی',
      contractReferenceNumber: 'CNT-A-001',
    });

    const [calcB] = await damagesRepo.createMany(TENANT_B, [
      {
        principalAmount: 20_000_000,
        dueDate: '2025-06-01',
        paymentDate: '2026-01-01',
        calculationMethod: DamageCalculationMethod.ANNUAL_RATE,
        delayedDays: 214,
        damageAmount: 2_100_000,
        totalPayable: 22_100_000,
        legalBasis: 'نرخ قراردادی',
        contractReferenceNumber: 'CNT-B-001',
      },
    ]);

    expect((await damagesRepo.findById(TENANT_A, calcA.id))?.contractReferenceNumber).toBe(
      'CNT-A-001',
    );
    expect(await damagesRepo.findById(TENANT_B, calcA.id)).toBeNull();

    const [rowsA, countA] = await damagesRepo.findAndCount(TENANT_A, {});
    expect(countA).toBe(1);
    expect(rowsA[0].id).toBe(calcA.id);

    const [rowsB, countB] = await damagesRepo.findAndCount(TENANT_B, {});
    expect(countB).toBe(1);
    expect(rowsB[0].id).toBe(calcB.id);

    for (const table of DATA_IMPORT_AND_DAMAGES_RLS_TABLES) {
      const unscoped = await appDs.query(`SELECT count(*)::int AS n FROM "${table}"`);
      expect(unscoped[0].n).toBe(0);
    }
  });
});
