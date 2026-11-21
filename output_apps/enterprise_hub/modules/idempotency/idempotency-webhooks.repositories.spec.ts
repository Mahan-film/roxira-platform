import { EntityManager } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { IdempotencyKeyStatus } from './entities/idempotency-key.entity';
import { IdempotencyRepository } from './repositories/idempotency.repository';
import { WebhookDeliveryStatus } from '../webhooks/entities/webhook-delivery.entity';
import { WebhooksRepository } from '../webhooks/repositories/webhooks.repository';

const T1 = '11111111-1111-4111-8111-111111111111';
const SUB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('IdempotencyRepository & WebhooksRepository (TenantScope enforcement)', () => {
  const makeScope = (manager: Partial<EntityManager>) => {
    const within = jest.fn(
      async <T>(_tenantId: string, _outer: EntityManager | undefined, fn: (m: EntityManager) => Promise<T>) =>
        fn(manager as EntityManager),
    );
    return { within } as unknown as TenantScope & { within: jest.Mock };
  };

  describe('IdempotencyRepository', () => {
    it('runs tryAcquire inside TenantScope, returns acquired record with DB-generated UUID, and never swallows DB errors', async () => {
      const generatedUuid = '55555555-5555-4555-8555-555555555555';
      const deleteQb = {
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      const insertQb = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          raw: [
            {
              id: generatedUuid,
              tenant_id: T1,
              scope_hash: 'scope-abc',
              idempotency_key: 'k-999',
              fingerprint: 'fp-1',
              status: IdempotencyKeyStatus.IN_PROGRESS,
              response_status: null,
              response_body: null,
              created_at: new Date(),
              expires_at: new Date(Date.now() + 86_400_000),
            },
          ],
        }),
      };

      let callIdx = 0;
      const scope = makeScope({
        createQueryBuilder: jest.fn(() => (callIdx++ === 0 ? deleteQb : insertQb)) as any,
      });

      const repo = new IdempotencyRepository(scope);
      const result = await repo.tryAcquire({
        tenantId: T1,
        scopeHash: 'scope-abc',
        idempotencyKey: 'k-999',
        fingerprint: 'fp-1',
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      expect(scope.within).toHaveBeenCalledWith(T1, undefined, expect.any(Function));
      expect(result.acquired).toBe(true);
      if (result.acquired) {
        expect(result.record.id).toBe(generatedUuid);
        expect(result.record.status).toBe(IdempotencyKeyStatus.IN_PROGRESS);
      }
    });

    it('propagates database errors instead of swallowing them into an in-memory Map', async () => {
      const scope = {
        within: jest.fn().mockRejectedValue(new Error('permission denied for table sys_idempotency_keys')),
      } as unknown as TenantScope;

      const repo = new IdempotencyRepository(scope);
      await expect(repo.findActive(T1, 'scope-abc', 'k-999')).rejects.toThrow(/permission denied/);
    });
  });

  describe('WebhooksRepository', () => {
    it('encrypts secret on write with AES-256-GCM and decrypts with tenantId AAD', async () => {
      const plainSecret = 'mock-webhook-secret-value-test-key';
      let capturedEntity: any = null;
      const subOrmRepo = {
        create: jest.fn((v) => {
          capturedEntity = { id: SUB_ID, ...v };
          return capturedEntity;
        }),
        save: jest.fn(async (e) => e),
      };

      const scope = makeScope({
        getRepository: jest.fn(() => subOrmRepo) as any,
      });

      const repo = new WebhooksRepository(scope);
      const created = await repo.createSubscription(T1, {
        url: 'https://hooks.example.com/events',
        secret: plainSecret,
        eventTypes: ['invoice.posted'],
      });

      // Ciphertext is stored, never plaintext
      expect(created.secretEncrypted).toBeDefined();
      expect(created.secretEncrypted).not.toBe(plainSecret);
      expect(created.secretEncrypted.startsWith('v1.')).toBe(true);

      // Decryption unseals exact original plaintext
      const decrypted = repo.decryptSubscriptionSecret(created);
      expect(decrypted).toBe(plainSecret);

      // AAD verification: decrypting under another tenant fails authentication
      expect(() => repo.decryptSubscriptionSecret({ ...created, tenantId: '99999999-9999-4999-8999-999999999999' })).toThrow();
    });

    it('routes subscription create/listActiveByEvent and delivery updates through TenantScope without Map fallback', async () => {
      const savedSub = {
        id: SUB_ID,
        tenantId: T1,
        url: 'https://hooks.example.com/events',
        secretEncrypted: 'v1.iv.tag.ct',
        eventTypes: ['invoice.posted', 'journal.posted'],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const subOrmRepo = {
        create: jest.fn((v) => v),
        save: jest.fn().mockResolvedValue(savedSub),
        find: jest.fn().mockResolvedValue([savedSub]),
      };
      const delOrmRepo = {
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      const scope = makeScope({
        getRepository: jest.fn((entity: any) =>
          entity.name === 'WebhookSubscriptionEntity' ? subOrmRepo : delOrmRepo,
        ) as any,
      });

      const repo = new WebhooksRepository(scope);
      const created = await repo.createSubscription(T1, {
        url: savedSub.url,
        secretEncrypted: savedSub.secretEncrypted,
        eventTypes: savedSub.eventTypes,
      });
      expect(created.id).toBe(SUB_ID);
      expect(scope.within).toHaveBeenCalledWith(T1, undefined, expect.any(Function));

      const matched = await repo.listActiveByEvent(T1, 'invoice.posted');
      expect(matched).toHaveLength(1);
      const unmatched = await repo.listActiveByEvent(T1, 'period.locked');
      expect(unmatched).toHaveLength(0);

      const updated = await repo.updateDeliveryAttempt(T1, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', {
        status: WebhookDeliveryStatus.SUCCESS,
        attempts: 3,
        lastStatusCode: 200,
      });
      expect(updated).toBe(true);
    });
  });
});
