/**
 * T185 (R16 Test 13) — Part 1 of #914:
 * Real PostgreSQL + FORCE ROW LEVEL SECURITY verification for:
 *   - `sys_idempotency_keys` (`IdempotencyRepository`)
 *   - `sys_webhook_subscriptions` & `sys_webhook_deliveries` (`WebhooksRepository`)
 *
 * Runs as `roxira_app` (`NOSUPERUSER NOBYPASSRLS`) via `createTestDatabase` (Lessons 5-6).
 * Opt-in like all *.pg.spec.ts: skipped unless ROXIRA_TEST_PG_HOST is set.
 */
import 'reflect-metadata';
import { createHash } from 'crypto';
import {
  createTestDatabase,
  describePg,
  TEST_T1 as T1,
  TEST_T2 as T2,
  TestDatabaseContext,
} from '../../test/support/test-pg';
import { IdempotencyKeyStatus } from './entities/idempotency-key.entity';
import { IdempotencyRepository } from './repositories/idempotency.repository';
import { WebhookDeliveryStatus } from '../webhooks/entities/webhook-delivery.entity';
import { WebhooksRepository } from '../webhooks/repositories/webhooks.repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describePg('T185 Part 1: Idempotency & Webhooks tables FORCE RLS (roxira_app)', () => {
  let testDb: TestDatabaseContext;
  let idempotencyRepo: IdempotencyRepository;
  let webhooksRepo: WebhooksRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase('idem_wh_rls');
    idempotencyRepo = new IdempotencyRepository(testDb.scope);
    webhooksRepo = new WebhooksRepository(testDb.scope);
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('enables and forces RLS on all three new tables', async () => {
    const rows = await testDb.owner.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class
        WHERE relname IN ('sys_idempotency_keys', 'sys_webhook_subscriptions', 'sys_webhook_deliveries')
        ORDER BY relname`,
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.relrowsecurity).toBe(true);
      expect(r.relforcerowsecurity).toBe(true);
    }
  });

  it('enforces atomic acquire lock, non-overwrite of fingerprint/response, scope isolation, and tenant RLS on sys_idempotency_keys', async () => {
    const scopePostJournals = createHash('sha256').update('POST:/accounting/journal-entries:u1').digest('hex');
    const scopePostInvoices = createHash('sha256').update('POST:/invoicing:u1').digest('hex');
    const expiresAt = new Date(Date.now() + 86_400_000);

    // 1. First acquire wins with DB-generated UUID
    const first = await idempotencyRepo.tryAcquire({
      tenantId: T1,
      scopeHash: scopePostJournals,
      idempotencyKey: 'k-999',
      fingerprint: 'fp-original',
      expiresAt,
    });
    expect(first.acquired).toBe(true);
    if (!first.acquired) return;
    expect(first.record.id).toMatch(UUID_RE);
    expect(first.record.status).toBe(IdempotencyKeyStatus.IN_PROGRESS);

    // 2. Concurrent / duplicate acquire on same tuple does NOT overwrite fingerprint or acquire again
    const second = await idempotencyRepo.tryAcquire({
      tenantId: T1,
      scopeHash: scopePostJournals,
      idempotencyKey: 'k-999',
      fingerprint: 'fp-different-body',
      expiresAt,
    });
    expect(second.acquired).toBe(false);
    if (!second.acquired) {
      expect(second.existing.id).toBe(first.record.id);
      expect(second.existing.fingerprint).toBe('fp-original');
      expect(second.existing.status).toBe(IdempotencyKeyStatus.IN_PROGRESS);
    }

    // 3. Complete transitions IN_PROGRESS -> COMPLETED once; a second complete() is a no-op
    expect(await idempotencyRepo.complete(T1, first.record.id, 201, { id: 42 })).toBe(true);
    expect(await idempotencyRepo.complete(T1, first.record.id, 200, { id: 999 })).toBe(false);

    const active = await idempotencyRepo.findActive(T1, scopePostJournals, 'k-999');
    expect(active?.responseStatus).toBe(201);
    expect(active?.responseBody).toEqual({ id: 42 });

    // 4. Same key on a DIFFERENT endpoint scope_hash acquires independently
    const otherEndpoint = await idempotencyRepo.tryAcquire({
      tenantId: T1,
      scopeHash: scopePostInvoices,
      idempotencyKey: 'k-999',
      fingerprint: 'fp-invoice',
      expiresAt,
    });
    expect(otherEndpoint.acquired).toBe(true);

    // 5. Tenant 2 cannot see Tenant 1's key and gets 0 rows without app.tenant_id
    expect(await idempotencyRepo.findActive(T2, scopePostJournals, 'k-999')).toBeNull();
    const rawCount = await testDb.app.query('SELECT count(*) FROM sys_idempotency_keys');
    expect(Number(rawCount[0].count)).toBe(0);

    // 6. Expired key can be re-acquired cleanly and purged per tenant
    const expired = await idempotencyRepo.tryAcquire({
      tenantId: T1,
      scopeHash: scopePostJournals,
      idempotencyKey: 'k-expired',
      fingerprint: 'fp-old',
      expiresAt: new Date(Date.now() - 10_000),
    });
    expect(expired.acquired).toBe(true);
    const purgedT2 = await idempotencyRepo.purgeExpired(T2);
    expect(purgedT2).toBe(0);
    const purgedT1 = await idempotencyRepo.purgeExpired(T1);
    expect(purgedT1).toBe(1);
  });

  it('enforces FORCE RLS, DB UUIDs, and retention purge on sys_webhook_subscriptions and sys_webhook_deliveries', async () => {
    const subT1 = await webhooksRepo.createSubscription(T1, {
      url: 'https://client-a.example.com/webhooks',
      secretEncrypted: 'v1:aes256gcm:encrypted-secret-a',
      eventTypes: ['invoice.posted', 'asset.depreciated'],
    });
    expect(subT1.id).toMatch(UUID_RE);

    const subT2 = await webhooksRepo.createSubscription(T2, {
      url: 'https://client-b.example.com/webhooks',
      secretEncrypted: 'v1:aes256gcm:encrypted-secret-b',
      eventTypes: ['journal.posted'],
    });
    expect(subT2.id).toMatch(UUID_RE);

    // Tenant isolation: T2 cannot find, toggle, or delete T1's subscription
    expect(await webhooksRepo.findSubscriptionById(T2, subT1.id)).toBeNull();
    expect(await webhooksRepo.setSubscriptionActive(T2, subT1.id, false)).toBeNull();
    expect(await webhooksRepo.deleteSubscription(T2, subT1.id)).toBe(false);
    expect(await webhooksRepo.listActiveByEvent(T1, 'invoice.posted')).toHaveLength(1);
    expect(await webhooksRepo.listActiveByEvent(T2, 'invoice.posted')).toHaveLength(0);

    // Deliveries use real UUIDs, payload_sha256, and tenant-scoped retention purge
    const delActive = await webhooksRepo.createDelivery(T1, {
      subscriptionId: subT1.id,
      eventId: 'evt-1',
      eventType: 'invoice.posted',
      payloadSha256: createHash('sha256').update('{"id":1}').digest('hex'),
      status: WebhookDeliveryStatus.PENDING,
      attempts: 0,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
    expect(delActive.id).toMatch(UUID_RE);

    expect(
      await webhooksRepo.updateDeliveryAttempt(T1, delActive.id, {
        status: WebhookDeliveryStatus.SUCCESS,
        attempts: 3,
        lastStatusCode: 200,
      }),
    ).toBe(true);

    // T2 cannot read or mutate T1's delivery
    expect(await webhooksRepo.listDeliveries(T2)).toHaveLength(0);
    expect(
      await webhooksRepo.updateDeliveryAttempt(T2, delActive.id, {
        status: WebhookDeliveryStatus.FAILED,
        attempts: 9,
      }),
    ).toBe(false);

    // Expired delivery retention purge
    await webhooksRepo.createDelivery(T1, {
      subscriptionId: subT1.id,
      eventId: 'evt-old',
      eventType: 'invoice.posted',
      payloadSha256: createHash('sha256').update('{"id":0}').digest('hex'),
      status: WebhookDeliveryStatus.FAILED,
      attempts: 3,
      expiresAt: new Date(Date.now() - 5_000),
    });
    expect(await webhooksRepo.purgeExpiredDeliveries(T2)).toBe(0);
    expect(await webhooksRepo.purgeExpiredDeliveries(T1)).toBe(1);
    expect(await webhooksRepo.listDeliveries(T1)).toHaveLength(1);

    // Composite FK enforcement: a delivery in T1 CANNOT reference a subscription from T2
    await expect(
      webhooksRepo.createDelivery(T1, {
        subscriptionId: subT2.id,
        eventId: 'evt-cross-tenant',
        eventType: 'invoice.posted',
        payloadSha256: createHash('sha256').update('{"cross":true}').digest('hex'),
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toThrow();

    // Unscoped connection without app.tenant_id sees 0 rows in both tables
    const rawSubs = await testDb.app.query('SELECT count(*) FROM sys_webhook_subscriptions');
    const rawDels = await testDb.app.query('SELECT count(*) FROM sys_webhook_deliveries');
    expect(Number(rawSubs[0].count)).toBe(0);
    expect(Number(rawDels[0].count)).toBe(0);
  });
});
