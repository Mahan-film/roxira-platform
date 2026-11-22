import 'reflect-metadata';
import { EntitlementService } from './services/entitlement.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
  TEST_T2 as T2,
} from '../../test/support/test-pg';

describePg('EntitlementService & Usage Metering on PostgreSQL (T145)', () => {
  let testDb: TestDatabaseContext;
  let service: EntitlementService;

  beforeAll(async () => {
    testDb = await createTestDatabase('entitlement_meter');
    service = new EntitlementService(testDb.scope);
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('runs under NOSUPERUSER NOBYPASSRLS roxira_app and enforces FORCE RLS across tenants', async () => {
    const [roleRow] = await testDb.app.query(
      `SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(roleRow.current_user).toBe('roxira_app');
    expect(roleRow.rolsuper).toBe(false);
    expect(roleRow.rolbypassrls).toBe(false);

    await service.setPlan(T1, 'starter', { ai_messages: 3 }, 1);
    await service.setPlan(T2, 'growth', { ai_messages: 10 }, 1);

    await service.consume(T1, 'ai_messages', 2, new Date('2026-11-10T10:00:00Z'));

    const t1Check = await service.check(T1, 'ai_messages', 1, new Date('2026-11-10T10:00:00Z'));
    expect(t1Check.used).toBe(2);
    expect(t1Check.limit).toBe(3);
    expect(t1Check.allowed).toBe(true);

    // T2 counter is isolated under FORCE RLS
    const t2Check = await service.check(T2, 'ai_messages', 1, new Date('2026-11-10T10:00:00Z'));
    expect(t2Check.used).toBe(0);
    expect(t2Check.limit).toBe(10);
  });

  it('enforces limit and resets on monthly rollover', async () => {
    await service.setPlan(T1, 'starter', { ocr_pages: 2 }, 15);

    const nov14 = new Date('2026-11-14T12:00:00Z'); // period 2026-10
    const nov15 = new Date('2026-11-15T00:00:00Z'); // period 2026-11 (rollover!)

    await service.consume(T1, 'ocr_pages', 2, nov14);
    await expect(service.consume(T1, 'ocr_pages', 1, nov14)).rejects.toThrow(/limit reached/i);

    // After rollover day (15th), fresh period allows consumption again
    const rolled = await service.consume(T1, 'ocr_pages', 1, nov15);
    expect(rolled.periodKey).toBe('2026-11');
    expect(rolled.used).toBe(1);
    expect(rolled.remaining).toBe(1);
  });

  it('is atomic under concurrent consume calls', async () => {
    await service.setPlan(T2, 'starter', { voice_minutes: 5 }, 1);
    const ts = new Date('2026-12-05T12:00:00Z');

    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => service.consume(T2, 'voice_minutes', 1, ts)),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(succeeded).toHaveLength(5);
    expect(rejected).toHaveLength(7);

    const finalCheck = await service.check(T2, 'voice_minutes', 1, ts);
    expect(finalCheck.used).toBe(5);
    expect(finalCheck.allowed).toBe(false);
  });

  it('seeds branches capacity meter from pre-existing tenant_branches rows', async () => {
    await testDb.scope.within(T1, undefined, async (manager) => {
      await manager.query(
        `INSERT INTO tenant_branches (tenant_id, name) VALUES ($1, 'HQ'), ($1, 'West')`,
        [T1],
      );
    });
    await service.setPlan(T1, 'starter', { branches: 2 }, 1);

    const checkBefore = await service.check(T1, 'branches', 1);
    expect(checkBefore.used).toBe(2);
    expect(checkBefore.limit).toBe(2);
    expect(checkBefore.allowed).toBe(false);

    await expect(service.consume(T1, 'branches', 1)).rejects.toThrow(/limit reached/i);

    await service.release(T1, 'branches', 1);
    const consumed = await service.consume(T1, 'branches', 1);
    expect(consumed.used).toBe(2);
    expect(consumed.remaining).toBe(0);
  });
});
