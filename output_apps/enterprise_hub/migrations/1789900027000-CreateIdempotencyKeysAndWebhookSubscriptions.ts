import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * T185 (R16 Test 13) — Part 1 of #914:
 * Create tenant-scoped tables with FORCE ROW LEVEL SECURITY for API idempotency and signed
 * outbound webhooks:
 *
 * - `sys_idempotency_keys`:
 *     Scoped by `(tenant_id, scope_hash, idempotency_key)` where `scope_hash` binds method, path,
 *     and authenticated actor so keys never collide across endpoints/users. Includes `status`
 *     (`IN_PROGRESS` | `COMPLETED`) to lock before execution and prevent concurrent double-writes.
 * - `sys_webhook_subscriptions`:
 *     Stores HTTPS endpoint URL, AES-256-GCM encrypted signing secret (`secret_encrypted`, never
 *     plaintext), and subscribed event types.
 * - `sys_webhook_deliveries`:
 *     Stores compact delivery metadata (`event_id`, `payload_sha256`, retry status, `expires_at`
 *     for retention pruning) without persisting raw sensitive payloads indefinitely.
 */
export class CreateIdempotencyKeysAndWebhookSubscriptions1789900027000
  implements MigrationInterface
{
  name = 'CreateIdempotencyKeysAndWebhookSubscriptions1789900027000';

  private readonly tables = [
    'sys_idempotency_keys',
    'sys_webhook_subscriptions',
    'sys_webhook_deliveries',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    // 1. Idempotency keys table (atomic acquire-lock + 24 h response cache, text response_body avoids bigint loss)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sys_idempotency_keys" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "scope_hash" character varying(64) NOT NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "fingerprint" character varying(64) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'IN_PROGRESS',
        "response_status" integer,
        "response_body" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_sys_idempotency_keys" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sys_idempotency_keys_tenant_scope_key" UNIQUE ("tenant_id", "scope_hash", "idempotency_key"),
        CONSTRAINT "CHK_sys_idempotency_keys_status" CHECK ("status" IN ('IN_PROGRESS', 'COMPLETED'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sys_idempotency_keys_tenant_expires"
        ON "sys_idempotency_keys" ("tenant_id", "expires_at")
    `);

    // 2. Outbound webhook subscriptions table (encrypted signing secret at rest)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sys_webhook_subscriptions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "url" character varying(1024) NOT NULL,
        "secret_encrypted" text NOT NULL,
        "event_types" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sys_webhook_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sys_webhook_subscriptions_tenant_id" UNIQUE ("tenant_id", "id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sys_webhook_subscriptions_tenant_active"
        ON "sys_webhook_subscriptions" ("tenant_id", "is_active")
    `);

    // 3. Webhook delivery logs table (hash + retention expiry, composite FK with tenant_id)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sys_webhook_deliveries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "subscription_id" uuid NOT NULL,
        "event_id" character varying(64) NOT NULL,
        "event_type" character varying(64) NOT NULL,
        "payload_sha256" character varying(64) NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'PENDING',
        "attempts" integer NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMP WITH TIME ZONE,
        "last_status_code" integer,
        "last_error" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_sys_webhook_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sys_webhook_deliveries_tenant_subscription" FOREIGN KEY ("tenant_id", "subscription_id")
          REFERENCES "sys_webhook_subscriptions" ("tenant_id", "id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sys_webhook_deliveries_tenant_created"
        ON "sys_webhook_deliveries" ("tenant_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sys_webhook_deliveries_tenant_expires"
        ON "sys_webhook_deliveries" ("tenant_id", "expires_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sys_webhook_deliveries_tenant_subscription"
        ON "sys_webhook_deliveries" ("tenant_id", "subscription_id")
    `);

    for (const table of this.tables) {
      await enableTenantRls(queryRunner, table);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    for (const table of [...this.tables].reverse()) {
      await disableTenantRls(queryRunner, table);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "sys_webhook_deliveries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sys_webhook_subscriptions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sys_idempotency_keys"`);
  }
}
