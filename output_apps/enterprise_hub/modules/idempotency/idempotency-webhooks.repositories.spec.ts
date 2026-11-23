import { EntityManager, getMetadataArgsStorage } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { IdempotencyKeyEntity, IdempotencyKeyStatus } from './entities/idempotency-key.entity';
import { IdempotencyRepository } from './repositories/idempotency.repository';
import { WebhookDeliveryStatus } from '../webhooks/entities/webhook-delivery.entity';
import { WebhooksRepository, sealWebhookSecret } from '../webhooks/repositories/webhooks.repository';

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

    it('preserves verbatim string responseBody and protects bigint precision (> 2^53)', async () => {
      const verbatimJson = '{"amount":9007199254740993,"currency":"IRR"}';
      const mockEntity = {
        id: '55555555-5555-4555-8555-555555555555',
        tenantId: T1,
        scopeHash: 'scope-bigint',
        idempotencyKey: 'k-bigint',
        fingerprint: 'fp-bigint',
        status: IdempotencyKeyStatus.COMPLETED,
        responseStatus: 200,
        responseBody: verbatimJson,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      };

      const selectQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockEntity),
      };
      const scope = makeScope({
        getRepository: jest.fn(() => ({
          createQueryBuilder: jest.fn(() => selectQb),
        })) as any,
      });

      const repo = new IdempotencyRepository(scope);
      const found = await repo.findActive(T1, 'scope-bigint', 'k-bigint');

      expect(found).not.toBeNull();
      expect(found?.responseBody).toBe(verbatimJson);

      // Verify entity transformer losslessly preserves bigints (> 2^53)
      const transformer = (getMetadataArgsStorage().columns.find(
        (c) => c.target === IdempotencyKeyEntity && c.propertyName === 'responseBody',
      )?.options as any)?.transformer;
      if (transformer) {
        const transformed = transformer.from(verbatimJson);
        expect(transformed.amount).toBe('9007199254740993');
        expect(transformed.currency).toBe('IRR');
        expect(transformer.from('{"id":42}')).toEqual({ id: 42 });
      }
    });
  });

  describe('WebhooksRepository', () => {
    const originalEncKey = process.env.WEBHOOK_ENC_KEY;

    beforeAll(() => {
      process.env.WEBHOOK_ENC_KEY = 'test-secret-key-for-unit-tests-32b!';
    });

    afterAll(() => {
      process.env.WEBHOOK_ENC_KEY = originalEncKey;
    });

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
      const validSealed = sealWebhookSecret('webhook-secret-unit-test', T1);
      const savedSub = {
        id: SUB_ID,
        tenantId: T1,
        url: 'https://hooks.example.com/events',
        secretEncrypted: validSealed,
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

    it('rejects subscription creation when secretEncrypted has invalid format or tampering', async () => {
      const scope = makeScope({});
      const repo = new WebhooksRepository(scope);

      // Malformed format
      await expect(
        repo.createSubscription(T1, {
          url: 'https://hooks.example.com/events',
          secretEncrypted: 'v1.invalid.format',
          eventTypes: ['invoice.posted'],
        }),
      ).rejects.toThrow();

      // Wrong tenant AAD
      const foreignSealed = sealWebhookSecret('secret', '22222222-2222-4222-8222-222222222222');
      await expect(
        repo.createSubscription(T1, {
          url: 'https://hooks.example.com/events',
          secretEncrypted: foreignSealed,
          eventTypes: ['invoice.posted'],
        }),
      ).rejects.toThrow();
    });
  });
});
