/**
 * Tenant RLS isolation spec for Price Tiers & Commission Policies (T74 / #731).
 * Exercises PriceTiersRepository and CommissionPoliciesRepository as a NOSUPERUSER NOBYPASSRLS
 * role under TenantScope (Lessons 5/7).
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { CustomerGroup } from '../parties/enums/customer-group.enum';
import { PriceTierEntity } from './entities/price-tier.entity';
import { SalesCommissionPolicyEntity } from './entities/sales-commission-policy.entity';
import { CommissionPoliciesRepository } from './repositories/commission-policies.repository';
import { PriceTiersRepository } from './repositories/price-tiers.repository';
import { TenantScope } from '../access/services/tenant-scope';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const ROLE_NAME = `rx_price_tiers_${process.pid}`;
const ROLE_PW = 'price-tiers-rls-test';

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

describePg('PriceTiers & Commission Policies RLS isolation (NOSUPERUSER NOBYPASSRLS)', () => {
  const db = `price_tiers_${process.pid}`;
  let adminDs: DataSource;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let priceTiersRepo: PriceTiersRepository;
  let commissionRepo: CommissionPoliciesRepository;

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
    priceTiersRepo = new PriceTiersRepository(scope);
    commissionRepo = new CommissionPoliciesRepository(scope);
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

  it('proves Tenant 1 price tiers cannot be read or modified by Tenant 2', async () => {
    // 1. Tenant 1 sets a price tier
    const t1Tier = await priceTiersRepo.create(T1, {
      sku: 'SKU-RLS-01',
      customerGroup: CustomerGroup.WHOLESALE,
      unitPrice: 50000000n,
      discountPercent: 10,
      effectiveFrom: '2026-11-01',
    });
    expect(t1Tier.id).toBeDefined();
    expect(t1Tier.tenantId).toBe(T1);

    // 2. Tenant 1 reads its own tier
    const t1List = await priceTiersRepo.list(T1, 'SKU-RLS-01');
    expect(t1List).toHaveLength(1);
    expect(t1List[0].sku).toBe('SKU-RLS-01');

    // 3. Tenant 2 cannot see Tenant 1 tier
    const t2List = await priceTiersRepo.list(T2, 'SKU-RLS-01');
    expect(t2List).toHaveLength(0);

    // 4. Tenant 2 cannot delete Tenant 1 tier
    await priceTiersRepo.deleteById(T2, t1Tier.id);
    const stillInT1 = await priceTiersRepo.list(T1, 'SKU-RLS-01');
    expect(stillInT1).toHaveLength(1);

    // 5. Tenant 1 deletes its tier
    await priceTiersRepo.deleteById(T1, t1Tier.id);
    const deletedInT1 = await priceTiersRepo.list(T1, 'SKU-RLS-01');
    expect(deletedInT1).toHaveLength(0);
  });

  it('proves Tenant 1 commission policies cannot be read or modified by Tenant 2', async () => {
    // 1. Tenant 1 sets commission policy
    const t1Policy = await commissionRepo.upsert(T1, 'hardware', 5.5, true);
    expect(t1Policy.id).toBeDefined();

    // 2. Tenant 1 reads policy
    const t1List = await commissionRepo.list(T1);
    const hardwarePolicy = t1List.find((p) => p.category === 'hardware');
    expect(hardwarePolicy).toBeDefined();
    expect(Number(hardwarePolicy?.commissionRate)).toBe(5.5);

    // 3. Tenant 2 cannot read policy
    const t2List = await commissionRepo.list(T2);
    expect(t2List.find((p) => p.category === 'hardware')).toBeUndefined();

    // 4. Tenant 2 cannot delete Tenant 1 policy
    await commissionRepo.deleteById(T2, t1Policy.id);
    const stillInT1 = await commissionRepo.list(T1);
    expect(stillInT1.find((p) => p.category === 'hardware')).toBeDefined();

    // 5. Tenant 1 deletes its policy
    await commissionRepo.deleteById(T1, t1Policy.id);
    const deletedInT1 = await commissionRepo.list(T1);
    expect(deletedInT1.find((p) => p.category === 'hardware')).toBeUndefined();
  });
});
