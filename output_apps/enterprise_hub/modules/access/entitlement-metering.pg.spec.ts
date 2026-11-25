import 'reflect-metadata';
import { EntitlementService } from './services/entitlement.service';
import { StructureRepository } from './repositories/structure.repository';
import { StructureService } from './services/structure.service';
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
    // Ensure T1 exists in tenants (FK_tenant_branches_tenant requires this)
    await testDb.owner.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Test T1', 'test-t1-branches') ON CONFLICT (id) DO NOTHING`,
      [T1],
    );
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

    // Simulate StructureService.deleteBranch: delete the branch first, then release.
    // Must seed used=1 (post-delete count), NOT 0 (no double-decrement off-by-one).
    await testDb.scope.within(T1, undefined, async (manager) => {
      await manager.query(
        `DELETE FROM tenant_branches WHERE tenant_id = $1 AND name = 'West'`,
        [T1],
      );
    });
    await service.release(T1, 'branches', 1);
    const checkAfterDelete = await service.check(T1, 'branches', 1);
    expect(checkAfterDelete.used).toBe(1);
    expect(checkAfterDelete.allowed).toBe(true);

    const consumed = await service.consume(T1, 'branches', 1);
    expect(consumed.used).toBe(2);
    expect(consumed.remaining).toBe(0);
  });

  it('enforces branch limit atomically under concurrent StructureService.createBranch calls and rolls back failed inserts', async () => {
    await testDb.owner.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Test T2', 'test-t2-branches') ON CONFLICT (id) DO NOTHING`,
      [T2],
    );
    await testDb.scope.within(T2, undefined, async (manager) => {
      await manager.query(`DELETE FROM tenant_branches WHERE tenant_id = $1`, [T2]);
      await manager.query(`DELETE FROM usage_counters WHERE tenant_id = $1 AND meter = 'branches'`, [T2]);
      await manager.query(`INSERT INTO tenant_branches (tenant_id, name) VALUES ($1, 'Existing')`, [T2]);
    });
    await service.setPlan(T2, 'starter', { branches: 3 }, 1);

    const structureRepo = new StructureRepository(testDb.scope);
    const auditMock = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const structure = new StructureService(structureRepo, auditMock, service);
    const ctx = { tenantId: T2, userId: '00000000-0000-4000-8000-000000000001' } as any;

    // 5 concurrent createBranch calls with 1 pre-existing branch and limit 3 -> exactly 2 succeed
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => structure.createBranch(ctx, { name: `Concurrent-${i}` })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(3);

    const postConcurrent = await service.check(T2, 'branches', 1);
    expect(postConcurrent.used).toBe(3);
    expect(postConcurrent.allowed).toBe(false);

    // Delete one branch, then trigger a DB insert failure inside createBranch -> counter must roll back to 2
    const branches = await structureRepo.listBranches(T2);
    await structure.deleteBranch(ctx, branches[0].id);
    expect((await service.check(T2, 'branches', 1)).used).toBe(2);

    const spy = jest.spyOn(structureRepo, 'createBranch').mockRejectedValueOnce(new Error('Simulated DB error'));
    await expect(structure.createBranch(ctx, { name: 'ShouldRollback' })).rejects.toThrow('Simulated DB error');
    spy.mockRestore();

    const afterRollback = await service.check(T2, 'branches', 1);
    expect(afterRollback.used).toBe(2);
    expect(afterRollback.allowed).toBe(true);
  });
});
