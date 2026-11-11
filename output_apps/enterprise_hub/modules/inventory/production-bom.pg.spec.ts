/**
 * Tenant RLS isolation spec for Production BOM and Production Orders (T83 / #764).
 * Exercises BomRepository and ProductionOrderRepository as a NOSUPERUSER NOBYPASSRLS
 * role under TenantScope (Lessons 5/7).
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { BomHeaderEntity } from './entities/bom-header.entity';
import { BomItemEntity } from './entities/bom-item.entity';
import { ProductionOrderEntity, ProductionOrderStatus } from './entities/production-order.entity';
import { BomRepository } from './repositories/bom.repository';
import { ProductionOrderRepository } from './repositories/production-order.repository';
import { TenantScope } from '../access/services/tenant-scope';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const ROLE_NAME = `rx_prod_bom_${process.pid}`;
const ROLE_PW = 'prod-bom-rls-test';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const dsOptions = (database: string, username = OWNER, password = OWNER_PW) => ({
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

describePg('Production BOM & Orders RLS isolation (NOSUPERUSER NOBYPASSRLS)', () => {
  const db = `prod_bom_${process.pid}`;
  let adminDs: DataSource;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let bomRepo: BomRepository;
  let orderRepo: ProductionOrderRepository;

  beforeAll(async () => {
    adminDs = await new DataSource({ ...dsOptions('postgres'), entities: [], migrations: [] }).initialize();
    await adminDs.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await adminDs.query(`CREATE DATABASE "${db}"`);
    await adminDs.query(`DROP ROLE IF EXISTS "${ROLE_NAME}"`);
    await adminDs.query(`CREATE ROLE "${ROLE_NAME}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${ROLE_PW}'`);

    ownerDs = await new DataSource(dsOptions(db)).initialize();
    await ownerDs.runMigrations();

    await ownerDs.query(
      `GRANT CONNECT ON DATABASE "${db}" TO "${ROLE_NAME}";
       GRANT USAGE ON SCHEMA public TO "${ROLE_NAME}";
       GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${ROLE_NAME}";
       GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${ROLE_NAME}";`,
    );

    appDs = await new DataSource(dsOptions(db, ROLE_NAME, ROLE_PW)).initialize();
    scope = new TenantScope(appDs);
    bomRepo = new BomRepository(scope);
    orderRepo = new ProductionOrderRepository(scope);
  });

  afterAll(async () => {
    await appDs?.destroy();
    await ownerDs?.destroy();
    if (adminDs) {
      await adminDs.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
      await adminDs.query(`DROP ROLE IF EXISTS "${ROLE_NAME}"`);
      await adminDs.destroy();
    }
  });

  it('proves Tenant 1 BOMs cannot be read or modified by Tenant 2', async () => {
    // 1. Tenant 1 creates a BOM
    const t1Bom = await bomRepo.createBom(T1, {
      bomCode: 'BOM-RLS-01',
      name: 'فرمول ساخت اختصاصی مستأجر ۱',
      finishedItemSku: 'FG-RLS-01',
      outputQuantity: 1,
      items: [
        {
          componentSku: 'RAW-RLS-01',
          quantity: 2,
          wastePercent: 5,
        },
      ],
    });
    expect(t1Bom.id).toBeDefined();
    expect(t1Bom.tenantId).toBe(T1);

    // 2. Tenant 1 reads its BOM
    const t1List = await bomRepo.list(T1, 'FG-RLS-01');
    expect(t1List).toHaveLength(1);
    expect(t1List[0].bomCode).toBe('BOM-RLS-01');

    // 3. Tenant 2 cannot see Tenant 1 BOM
    const t2List = await bomRepo.list(T2, 'FG-RLS-01');
    expect(t2List).toHaveLength(0);

    const t2Read = await bomRepo.findById(T2, t1Bom.id);
    expect(t2Read).toBeNull();

    // 4. Tenant 2 cannot delete Tenant 1 BOM
    await bomRepo.deleteById(T2, t1Bom.id);
    const stillInT1 = await bomRepo.findById(T1, t1Bom.id);
    expect(stillInT1).not.toBeNull();
  });

  it('proves Tenant 1 production orders cannot be read or modified by Tenant 2', async () => {
    // 1. Tenant 1 creates a production order
    const t1Bom = await bomRepo.findByCode(T1, 'BOM-RLS-01');
    expect(t1Bom).not.toBeNull();

    const t1Order = await orderRepo.create(T1, {
      orderNumber: 'PO-RLS-001',
      bomId: t1Bom!.id,
      finishedSku: 'FG-RLS-01',
      plannedQuantity: 10,
    });
    expect(t1Order.id).toBeDefined();
    expect(t1Order.tenantId).toBe(T1);

    // 2. Tenant 1 reads order
    const t1Read = await orderRepo.findByNumber(T1, 'PO-RLS-001');
    expect(t1Read).not.toBeNull();
    expect(t1Read?.orderNumber).toBe('PO-RLS-001');

    // 3. Tenant 2 cannot see Tenant 1 order
    const t2Read = await orderRepo.findByNumber(T2, 'PO-RLS-001');
    expect(t2Read).toBeNull();

    const t2List = await orderRepo.list(T2);
    expect(t2List).toHaveLength(0);

    // 4. Tenant 2 cannot modify Tenant 1 order status (fail-closed)
    await expect(
      orderRepo.updateStatus(T2, t1Order.id, ProductionOrderStatus.CANCELLED),
    ).rejects.toThrow();

    const stillInT1 = await orderRepo.findById(T1, t1Order.id);
    expect(stillInT1?.status).toBe(ProductionOrderStatus.DRAFT);
  });
});
