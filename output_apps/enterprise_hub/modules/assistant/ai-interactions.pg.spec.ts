import 'reflect-metadata';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1,
  TEST_T2,
} from '../../test/support/test-pg';
import { AiInteractionRepository } from './repositories/ai-interaction.repository';

describePg('ai_interactions table and RLS on real PostgreSQL', () => {
  let testDb: TestDatabaseContext;
  let repo: AiInteractionRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase('ai_interactions');
    repo = new AiInteractionRepository(testDb.scope);
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('records an interaction and enforces tenant isolation under roxira_app role', async () => {
    const interaction1 = await repo.record(TEST_T1, {
      questionHash: 'hash-tenant1-question',
      toolsAndArgs: [{ name: 'profit', arguments: { period: 'this_month' } }],
      model: 'openai/gpt-oss-120b',
      promptTokens: 120,
      completionTokens: 80,
      costMinor: 500n,
      latencyMs: 340,
      validatorVerdict: 'verified',
      customerDataFallback: false,
    });

    expect(interaction1.id).toBeDefined();
    expect(interaction1.tenantId).toBe(TEST_T1);
    expect(interaction1.model).toBe('openai/gpt-oss-120b');
    expect(interaction1.validatorVerdict).toBe('verified');

    // Tenant 1 can see its own interaction
    const t1Rows = await repo.listRecent(TEST_T1);
    expect(t1Rows.some((r) => r.id === interaction1.id)).toBe(true);

    // Tenant 2 CANNOT see Tenant 1's interaction (RLS isolation)
    const t2Rows = await repo.listRecent(TEST_T2);
    expect(t2Rows.some((r) => r.id === interaction1.id)).toBe(false);
  });

  it('purges records that have passed expires_at', async () => {
    const expiredDate = new Date(Date.now() - 1000);
    const expired = await repo.record(TEST_T1, {
      questionHash: 'hash-expired',
      toolsAndArgs: [],
      model: 'openai/gpt-oss-120b',
      validatorVerdict: 'verified',
      expiresAt: expiredDate,
    });

    const purged = await repo.purgeExpired(testDb.app);
    expect(purged).toBeGreaterThanOrEqual(1);

    const t1Rows = await repo.listRecent(TEST_T1);
    expect(t1Rows.some((r) => r.id === expired.id)).toBe(false);
  });
});
