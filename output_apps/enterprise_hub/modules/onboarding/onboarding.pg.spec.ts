/**
 * Tenant RLS and save/resume spec for the setup-wizard progress (T96), run against a real
 * PostgreSQL as a NOSUPERUSER NOBYPASSRLS role with the real OnboardingRepository and
 * OnboardingService under TenantScope (Lessons 5 and 7).
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { OnboardingRepository } from './repositories/onboarding.repository';
import { OnboardingService } from './services/onboarding.service';
import { OnboardingStep, OnboardingStepStatus } from './enums/onboarding-step.enum';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { TenantsService } from '../tenants/services/tenants.service';
import { TenantEntity } from '../tenants/entities/tenant.entity';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const ROLE_NAME = `rx_onboarding_${process.pid}`;
const ROLE_PW = 'onboarding-rls-test';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T_OLD = '33333333-3333-4333-8333-333333333333';

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

describePg('Onboarding progress (NOSUPERUSER NOBYPASSRLS)', () => {
  const db = `onboarding_${process.pid}`;
  let adminDs: DataSource;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let service: OnboardingService;

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
    for (const [id, name] of [[T1, 'یک'], [T2, 'دو']]) {
      await ownerDs.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)`, [id, `شرکت ${name}`, `onb-${id.slice(0, 4)}`]);
    }

    appDs = await new DataSource(dsOptions(db, ROLE_NAME, ROLE_PW)).initialize();
    const tenants = new TenantsService(new TenantsRepository(appDs.getRepository(TenantEntity)));
    service = new OnboardingService(new OnboardingRepository(new TenantScope(appDs)), tenants);
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

  it('the table has FORCE RLS and the app role is not a superuser', async () => {
    const [{ relforcerowsecurity }] = await ownerDs.query(`SELECT relforcerowsecurity FROM pg_class WHERE relname = 'tenant_onboarding_progress'`);
    expect(relforcerowsecurity).toBe(true);
    const [{ rolsuper, rolbypassrls }] = await ownerDs.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`, [ROLE_NAME]);
    expect([rolsuper, rolbypassrls]).toEqual([false, false]);
  });

  it('saves and resumes progress per tenant, and one tenant never sees the other', async () => {
    const first = await service.get(T1);
    expect(first.firstVisit).toBe(true);
    expect(first.steps.chart).toBe('pending');

    await service.saveProfile(T1, { name: 'شرکت نوین', economicCode: '411234567890' });
    await service.setStep(T1, OnboardingStep.FISCAL_YEAR, OnboardingStepStatus.SKIPPED);
    await service.update(T1, { firstVisitHandled: true });

    const resumed = await service.get(T1);
    expect(resumed).toMatchObject({ companyName: 'شرکت نوین', economicCode: '411234567890', firstVisit: false });
    expect(resumed.steps.profile).toBe('done');
    expect(resumed.steps.fiscal_year).toBe('skipped');

    const other = await service.get(T2);
    expect(other.steps.profile).toBe('pending');
    expect(other.economicCode).toBeNull();
    expect(other.firstVisit).toBe(true);
    expect(other.companyName).toBe('شرکت دو');
  });

  it('without a tenant scope the app role sees no row and cannot insert one', async () => {
    expect(await appDs.query(`SELECT 1 FROM tenant_onboarding_progress`)).toHaveLength(0);
    await expect(appDs.query(`INSERT INTO tenant_onboarding_progress (tenant_id) VALUES ($1)`, [T_OLD])).rejects.toThrow();
  });

  it('a scope for tenant 1 cannot write the row of tenant 2', async () => {
    await expect(
      appDs.transaction(async (m) => {
        await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [T1]);
        await m.query(`INSERT INTO tenant_onboarding_progress (tenant_id) VALUES ($1)`, [T2]);
      }),
    ).rejects.toThrow();
    const updated = await appDs.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [T1]);
      return m.query(`UPDATE tenant_onboarding_progress SET dismissed = true WHERE tenant_id = $1 RETURNING 1`, [T2]);
    });
    expect(updated[0]).toHaveLength(0);
    expect((await service.get(T2)).dismissed).toBe(false);
  });

  it('two concurrent step updates both survive', async () => {
    await Promise.all([
      service.setStep(T2, OnboardingStep.CHART, OnboardingStepStatus.DONE),
      service.setStep(T2, OnboardingStep.USERS, OnboardingStepStatus.SKIPPED),
      service.setStep(T2, OnboardingStep.MOADIAN, OnboardingStepStatus.DONE),
    ]);
    const state = await service.get(T2);
    expect([state.steps.chart, state.steps.users, state.steps.moadian]).toEqual(['done', 'skipped', 'done']);
  });

  it('the database refuses a malformed economic code', async () => {
    await expect(
      ownerDs.query(`UPDATE tenant_onboarding_progress SET economic_code = 'abc' WHERE tenant_id = $1`, [T1]),
    ).rejects.toThrow(/CHK_tenant_onboarding_economic_code/);
  });
});
