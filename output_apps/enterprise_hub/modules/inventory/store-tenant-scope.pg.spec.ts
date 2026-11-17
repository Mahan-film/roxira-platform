/**
 * T209: runs as a NOSUPERUSER NOBYPASSRLS role with two tenants and proves that
 * `InventoryRepository.findStoreById` goes through TenantScope: tenant B cannot read tenant A's store.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { FifoBatchEntity } from './entities/fifo-batch.entity';
import { StockItemEntity } from './entities/stock-item.entity';
import { StoreEntity } from './entities/store.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import { InventoryRepository } from './repositories/inventory.repository';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const ADMIN_USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const APP_ROLE = 'rx_t209_inv_app';
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

describePg('InventoryRepository.findStoreById (NOSUPERUSER NOBYPASSRLS, two tenants)', () => {
  const dbName = `rx_t209_inv_${process.pid}_${Date.now()}`;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let repo: InventoryRepository;

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
    appDs = new DataSource(
      options(dbName, APP_ROLE, [WarehouseEntity, StockItemEntity, FifoBatchEntity, StoreEntity]),
    );
    await appDs.initialize();
    // No TenantScope is injected on purpose: the repository must scope the query itself.
    repo = new InventoryRepository(
      appDs.getRepository(WarehouseEntity),
      appDs.getRepository(StockItemEntity),
      appDs.getRepository(FifoBatchEntity),
      appDs,
    );
  }, 180_000);

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (ownerDs?.isInitialized) await ownerDs.destroy();
    await adminQuery(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  it('returns the own tenant store and null for another tenant', async () => {
    const [{ id }] = (await ownerDs.query(
      `INSERT INTO erp_stores (tenant_id, code, name) VALUES ($1, 'S1', 'Store A') RETURNING id`,
      [TENANT_A],
    )) as Array<{ id: number }>;

    expect((await repo.findStoreById(TENANT_A, id))?.name).toBe('Store A');
    expect(await repo.findStoreById(TENANT_B, id)).toBeNull();
  });

  it('a bare connection without app.tenant_id sees no store rows (RLS), the scoped path still works', async () => {
    const [{ id }] = (await ownerDs.query(
      `INSERT INTO erp_stores (tenant_id, code, name) VALUES ($1, 'S2', 'Store A2') RETURNING id`,
      [TENANT_A],
    )) as Array<{ id: number }>;

    expect(await appDs.query(`SELECT id FROM erp_stores WHERE id = $1`, [id])).toEqual([]);
    expect((await repo.findStoreById(TENANT_A, id))?.id).toBe(id);
  });
});
