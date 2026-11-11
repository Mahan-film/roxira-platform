/**
 * Tenant isolation for User Login Schedules under FORCE ROW LEVEL SECURITY (T76 / #738).
 * Proves that a non-superuser role (NOSUPERUSER NOBYPASSRLS) operating through TenantScope
 * can only read, write, and delete schedules within its own tenant boundary (Lesson 5/7).
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { UserLoginScheduleEntity } from './entities/user-login-schedule.entity';
import { LoginSchedulesRepository } from './repositories/login-schedules.repository';
import { TenantScope } from './services/tenant-scope';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const ROLE_NAME = `rx_login_sched_${process.pid}`;
const ROLE_PW = 'login-schedules-rls-test';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

describePg('UserLoginScheduleEntity RLS isolation (NOSUPERUSER NOBYPASSRLS)', () => {
  const db = `login_sched_${process.pid}`;
  let adminDs: DataSource;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let repo: LoginSchedulesRepository;

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
       GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${ROLE_NAME}";`,
    );

    appDs = await new DataSource(dsOptions(db, ROLE_NAME, ROLE_PW)).initialize();
    scope = new TenantScope(appDs);
    repo = new LoginSchedulesRepository(scope);
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

  it('saves schedule in Tenant 1 and prevents Tenant 2 from reading or modifying it', async () => {
    // 1. Tenant 1 saves a schedule for U1
    const t1Schedule = await repo.saveSchedule(T1, U1, {
      timezone: 'Asia/Tehran',
      enforceSchedule: true,
      windows: [{ dayOfWeek: 6, startMinute: 480, endMinute: 1020 }],
    });
    expect(t1Schedule).toBeDefined();
    expect(t1Schedule.tenantId).toBe(T1);
    expect(t1Schedule.userId).toBe(U1);

    // 2. Tenant 1 reads its own schedule
    const readByT1 = await repo.findByTenantUser(T1, U1);
    expect(readByT1).toBeDefined();
    expect(readByT1?.userId).toBe(U1);
    expect(readByT1?.windows).toHaveLength(1);

    // 3. Tenant 2 cannot see Tenant 1 schedule even when directly queried by primary key id (FORCE RLS)
    const readByT2Scope = await scope.within(T2, undefined, async (em) => {
      return em.getRepository(UserLoginScheduleEntity).findOne({ where: { id: t1Schedule.id } });
    });
    expect(readByT2Scope).toBeNull();

    // Querying without setting app.tenant_id as the unprivileged role gives 0 rows
    const rawCount = await appDs.query('SELECT count(*) FROM user_login_schedules');
    expect(Number(rawCount[0].count)).toBe(0);

    // 4. Tenant 2 cannot delete Tenant 1 schedule
    await repo.removeSchedule(T2, U1);
    const stillExistsInT1 = await repo.findByTenantUser(T1, U1);
    expect(stillExistsInT1).not.toBeNull();

    // 5. Tenant 1 deletes its schedule
    await repo.removeSchedule(T1, U1);
    const deletedInT1 = await repo.findByTenantUser(T1, U1);
    expect(deletedInT1).toBeNull();
  });
});
