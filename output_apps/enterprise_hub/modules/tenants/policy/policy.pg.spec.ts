/**
 * Tenant policy settings on a REAL PostgreSQL as a non-superuser role: migration with FORCE RLS and
 * tenant isolation end to end.
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set. Each run creates and
 * drops its own database and role. Optional: ROXIRA_TEST_PG_USER, ROXIRA_TEST_PG_PORT, ROXIRA_TEST_PG_PASSWORD.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55460 npx jest modules/tenants/policy/policy.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { AuditService } from '../../access/services/audit.service';
import { PolicyService } from './policy.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'policy-app-test-only';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const options = (database: string, username = OWNER, password = OWNER_PW) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  password,
  database,
  entities: [path.join(__dirname, '../../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('Tenant policy settings on PostgreSQL (non-superuser, FORCE RLS)', () => {
  const db = `rx_policy_${process.pid}_${Date.now()}`;
  const role = `rx_policy_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let service: PolicyService;
  const ownerActor = { userId: 'u1', roleKey: 'owner' };

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

    const audit = { record: async (): Promise<void> => undefined } as unknown as AuditService;
    service = new PolicyService(new TenantScope(app), audit);
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('returns the registry default for an unset key', async () => {
    expect(await service.get(T1, 'purchase.three_way.qty_excess_tolerance_bp')).toBe(0);
    expect(await service.get(T1, 'purchase.invoice_review.reviewer_rule')).toBe('always_differs');
  });

  it('sets a policy in tenant A without leaking it to tenant B', async () => {
    await service.set(T1, ownerActor, 'purchase.three_way.qty_excess_tolerance_bp', 250, 'x'.repeat(5));
    expect(await service.get(T1, 'purchase.three_way.qty_excess_tolerance_bp')).toBe(250);
    expect(await service.get(T2, 'purchase.three_way.qty_excess_tolerance_bp')).toBe(0);
  });

  it('hides tenant B policy rows from a non-superuser bound to tenant A', async () => {
    await service.set(T2, ownerActor, 'purchase.three_way.qty_excess_tolerance_bp', 900, 'x'.repeat(5));

    await app.transaction(async (m) => {
      await TenantScope.bind(m, T1);
      expect(await m.query(`SELECT "key" FROM "tenant_policy_settings" WHERE "tenant_id" = $1`, [T2])).toEqual([]);
      expect(
        await m.query(`UPDATE "tenant_policy_settings" SET "value" = '999'::jsonb WHERE "tenant_id" = $1 RETURNING "key"`, [T2]),
      ).toEqual([[], 0]);
    });

    const [stillThere] = await owner.query(
      `SELECT "value" FROM "tenant_policy_settings" WHERE "tenant_id" = $1 AND "key" = $2`,
      [T2, 'purchase.three_way.qty_excess_tolerance_bp'],
    );
    expect(stillThere.value).toBe(900);
  });

  it('persists control weakening warning, reason and auto-revert date (#584-6) under NOSUPERUSER NOBYPASSRLS', async () => {
    const future = new Date(Date.now() + 86400_000 * 3).toISOString();
    const view = await service.set(
      T1,
      ownerActor,
      'purchase.invoice_review.reviewer_rule',
      'creator_may_accept',
      'مجوز موقت تضعیف کنترل تفکیک وظایف',
      future,
    );

    expect(view.isWeakened).toBe(true);
    expect(view.warning).toContain('تفکیک وظایف غیرفعال شد');
    expect(view.reason).toBe('مجوز موقت تضعیف کنترل تفکیک وظایف');
    expect(view.autoRevertAt).toEqual(new Date(future));

    // Verify stored directly in Postgres under RLS
    const rows = await app.transaction(async (m) => {
      await TenantScope.bind(m, T1);
      return m.query(
        `SELECT "key", "auto_revert_at", "reason" FROM "tenant_policy_settings" WHERE "tenant_id" = $1 AND "key" = $2`,
        [T1, 'purchase.invoice_review.reviewer_rule'],
      );
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe('مجوز موقت تضعیف کنترل تفکیک وظایف');
    expect(new Date(rows[0].auto_revert_at)).toEqual(new Date(future));
  });

  it('automatically reverts an expired policy on real PostgreSQL and cleans up auto_revert_at', async () => {
    // Manually set auto_revert_at in the past via owner connection to simulate elapsed time
    await owner.query(
      `UPDATE "tenant_policy_settings"
       SET "auto_revert_at" = now() - interval '1 hour'
       WHERE "tenant_id" = $1 AND "key" = $2`,
      [T1, 'purchase.invoice_review.reviewer_rule'],
    );

    // Reading through the non-superuser service triggers the automatic reversion
    const val = await service.get(T1, 'purchase.invoice_review.reviewer_rule');
    expect(val).toBe('always_differs'); // reverted to default!

    // Check DB state: auto_revert_at is cleared and reason updated
    const [row] = await owner.query(
      `SELECT "value", "auto_revert_at", "reason" FROM "tenant_policy_settings" WHERE "tenant_id" = $1 AND "key" = $2`,
      [T1, 'purchase.invoice_review.reviewer_rule'],
    );
    expect(row.value).toBe('always_differs');
    expect(row.auto_revert_at).toBeNull();
    expect(row.reason).toContain('بازگشت خودکار به مقدار پیش‌فرض امن');
  });

  it('returns active exceptions report isolating across tenants', async () => {
    // Set a non-default tolerance on T1
    await service.set(T1, ownerActor, 'purchase.three_way.qty_excess_tolerance_bp', 150, 'تلورانس مجاز موقت');

    const exceptionsT1 = await service.getExceptions(T1);
    expect(exceptionsT1).toHaveLength(1);
    expect(exceptionsT1[0].key).toBe('purchase.three_way.qty_excess_tolerance_bp');
    expect(exceptionsT1[0].value).toBe(150);
    expect(exceptionsT1[0].isWeakened).toBe(true);

    // T2 has key set to 900 in earlier test
    const exceptionsT2 = await service.getExceptions(T2);
    expect(exceptionsT2).toHaveLength(1);
    expect(exceptionsT2[0].value).toBe(900);
  });
});
