import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import {
  WebhookDeliveryEntity,
  WebhookDeliveryStatus,
} from '../entities/webhook-delivery.entity';
import { WebhookSubscriptionEntity } from '../entities/webhook-subscription.entity';

const WEBHOOK_SEAL_VERSION = 'v1';

function getMasterKey(): Buffer {
  const envKey =
    process.env.WEBHOOK_ENC_KEY ||
    process.env.TOTP_ENC_KEY ||
    process.env.JWT_SECRET ||
    process.env.JWT_SECRET_KEY;
  if (!envKey) {
    throw new Error(
      'Webhook encryption key is missing. Set WEBHOOK_ENC_KEY, TOTP_ENC_KEY, or JWT_SECRET in environment.',
    );
  }
  return createHash('sha256').update(envKey).digest();
}

/**
 * Seals a webhook signing secret with AES-256-GCM using `tenantId` as AAD.
 * Output format: `v1.<iv_base64url>.<tag_base64url>.<ciphertext_base64url>`.
 */
export function sealWebhookSecret(
  plaintext: string,
  tenantId: string,
  masterKey = getMasterKey(),
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(Buffer.from(tenantId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    WEBHOOK_SEAL_VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Opens a sealed webhook signing secret, verifying AES-256-GCM authentication and `tenantId` AAD.
 */
export function openWebhookSecret(
  sealed: string,
  tenantId: string,
  masterKey = getMasterKey(),
): string {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== WEBHOOK_SEAL_VERSION) {
    throw new Error('Unsupported sealed webhook secret format');
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ct = Buffer.from(ctB64, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAAD(Buffer.from(tenantId, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export interface CreateWebhookSubscriptionInput {
  url: string;
  secret?: string;
  secretEncrypted?: string;
  eventTypes: string[];
  isActive?: boolean;
}

export interface CreateWebhookDeliveryInput {
  subscriptionId: string;
  eventId: string;
  eventType: string;
  payloadSha256: string;
  status?: WebhookDeliveryStatus;
  attempts?: number;
  nextAttemptAt?: Date | null;
  lastStatusCode?: number | null;
  lastError?: string | null;
  expiresAt: Date;
}

export interface UpdateWebhookDeliveryAttemptInput {
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt?: Date | null;
  lastStatusCode?: number | null;
  lastError?: string | null;
}

/**
 * Tenant-scoped persistence for `sys_webhook_subscriptions` and `sys_webhook_deliveries`.
 *
 * Every read/write executes inside `TenantScope` (FORCE RLS) using DB-generated UUID primary keys,
 * with zero in-memory Map fallbacks and zero swallowed errors.
 */
@Injectable()
export class WebhooksRepository {
  constructor(private readonly scope: TenantScope) {}

  createSubscription(
    tenantId: string,
    input: CreateWebhookSubscriptionInput,
    manager?: EntityManager,
  ): Promise<WebhookSubscriptionEntity> {
    let secretEncrypted = input.secretEncrypted;
    if (input.secret) {
      // Encrypt plaintext secret on write using AES-256-GCM with tenantId as AAD
      secretEncrypted = sealWebhookSecret(input.secret, tenantId);
    } else if (!secretEncrypted) {
      // Auto-generate 32-byte secret and encrypt
      const generated = randomBytes(32).toString('hex');
      secretEncrypted = sealWebhookSecret(generated, tenantId);
    } else if (!secretEncrypted.startsWith(`${WEBHOOK_SEAL_VERSION}.`)) {
      throw new Error(`Invalid sealed webhook secret format: expected '${WEBHOOK_SEAL_VERSION}.' prefix`);
    }

    return this.scope.within(tenantId, manager, async (m) => {
      const repo = m.getRepository(WebhookSubscriptionEntity);
      const entity = repo.create({
        tenantId,
        url: input.url,
        secretEncrypted,
        eventTypes: input.eventTypes,
        isActive: input.isActive ?? true,
      });
      return repo.save(entity);
    });
  }

  decryptSubscriptionSecret(entity: WebhookSubscriptionEntity): string {
    return openWebhookSecret(entity.secretEncrypted, entity.tenantId);
  }

  findSubscriptionById(
    tenantId: string,
    id: string,
    manager?: EntityManager,
  ): Promise<WebhookSubscriptionEntity | null> {
    return this.scope.within(tenantId, manager, (m) =>
      m.getRepository(WebhookSubscriptionEntity).findOne({ where: { tenantId, id } }),
    );
  }

  listSubscriptions(
    tenantId: string,
    manager?: EntityManager,
  ): Promise<WebhookSubscriptionEntity[]> {
    return this.scope.within(tenantId, manager, (m) =>
      m.getRepository(WebhookSubscriptionEntity).find({
        where: { tenantId },
        order: { createdAt: 'DESC' },
      }),
    );
  }

  async listActiveByEvent(
    tenantId: string,
    eventType: string,
    manager?: EntityManager,
  ): Promise<WebhookSubscriptionEntity[]> {
    const active = await this.scope.within(tenantId, manager, (m) =>
      m.getRepository(WebhookSubscriptionEntity).find({
        where: { tenantId, isActive: true },
        order: { createdAt: 'ASC' },
      }),
    );
    return active.filter(
      (s) => Array.isArray(s.eventTypes) && (s.eventTypes.includes(eventType) || s.eventTypes.includes('*')),
    );
  }

  async setSubscriptionActive(
    tenantId: string,
    id: string,
    isActive: boolean,
    manager?: EntityManager,
  ): Promise<WebhookSubscriptionEntity | null> {
    return this.scope.within(tenantId, manager, async (m) => {
      const repo = m.getRepository(WebhookSubscriptionEntity);
      const existing = await repo.findOne({ where: { tenantId, id } });
      if (!existing) return null;
      existing.isActive = isActive;
      existing.updatedAt = new Date();
      return repo.save(existing);
    });
  }

  async deleteSubscription(
    tenantId: string,
    id: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    return this.scope.within(tenantId, manager, async (m) => {
      const res = await m.getRepository(WebhookSubscriptionEntity).delete({ tenantId, id });
      return (res.affected ?? 0) > 0;
    });
  }

  createDelivery(
    tenantId: string,
    input: CreateWebhookDeliveryInput,
    manager?: EntityManager,
  ): Promise<WebhookDeliveryEntity> {
    return this.scope.within(tenantId, manager, async (m) => {
      const repo = m.getRepository(WebhookDeliveryEntity);
      const entity = repo.create({
        tenantId,
        subscriptionId: input.subscriptionId,
        eventId: input.eventId,
        eventType: input.eventType,
        payloadSha256: input.payloadSha256,
        status: input.status ?? WebhookDeliveryStatus.PENDING,
        attempts: input.attempts ?? 0,
        nextAttemptAt: input.nextAttemptAt ?? null,
        lastStatusCode: input.lastStatusCode ?? null,
        lastError: input.lastError ?? null,
        expiresAt: input.expiresAt,
      });
      return repo.save(entity);
    });
  }

  async updateDeliveryAttempt(
    tenantId: string,
    id: string,
    update: UpdateWebhookDeliveryAttemptInput,
    manager?: EntityManager,
  ): Promise<boolean> {
    return this.scope.within(tenantId, manager, async (m) => {
      const res = await m.getRepository(WebhookDeliveryEntity).update(
        { id, tenantId },
        {
          status: update.status,
          attempts: update.attempts,
          nextAttemptAt: update.nextAttemptAt ?? null,
          lastStatusCode: update.lastStatusCode ?? null,
          lastError: update.lastError ?? null,
        },
      );
      return (res.affected ?? 0) === 1;
    });
  }

  listDeliveries(
    tenantId: string,
    subscriptionId?: string,
    limit = 50,
    manager?: EntityManager,
  ): Promise<WebhookDeliveryEntity[]> {
    const capped = Math.min(Math.max(limit, 1), 200);
    return this.scope.within(tenantId, manager, (m) =>
      m.getRepository(WebhookDeliveryEntity).find({
        where: subscriptionId ? { tenantId, subscriptionId } : { tenantId },
        order: { createdAt: 'DESC' },
        take: capped,
      }),
    );
  }

  async purgeExpiredDeliveries(
    tenantId: string,
    now = new Date(),
    manager?: EntityManager,
  ): Promise<number> {
    return this.scope.within(tenantId, manager, async (m) => {
      const res = await m
        .createQueryBuilder()
        .delete()
        .from(WebhookDeliveryEntity)
        .where('tenant_id = :tenantId AND expires_at <= :now', { tenantId, now })
        .execute();
      return res.affected ?? 0;
    });
  }
}
