import { QueryRunner } from 'typeorm';
import { CreateIdempotencyKeysAndWebhookSubscriptions1789900027000 } from '../../migrations/1789900027000-CreateIdempotencyKeysAndWebhookSubscriptions';

describe('CreateIdempotencyKeysAndWebhookSubscriptions1789900027000', () => {
  it('creates all 3 tenant tables with FORCE RLS, scope_hash/status lock, encrypted secret column, composite FK, and retention expiry', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return [];
      }),
    } as unknown as QueryRunner;

    const migration = new CreateIdempotencyKeysAndWebhookSubscriptions1789900027000();
    await migration.up(runner);

    const joined = queries.join('\n');
    expect(joined).toContain('SET LOCAL lock_timeout');
    expect(joined).toContain('CREATE TABLE IF NOT EXISTS "sys_idempotency_keys"');
    expect(joined).toContain('"scope_hash" character varying(64) NOT NULL');
    expect(joined).toContain('"status" character varying(16) NOT NULL DEFAULT \'IN_PROGRESS\'');
    expect(joined).toContain('"response_body" text');
    expect(joined).toContain('UQ_sys_idempotency_keys_tenant_scope_key');
    expect(joined).toContain('CREATE TABLE IF NOT EXISTS "sys_webhook_subscriptions"');
    expect(joined).toContain('"secret_encrypted" text NOT NULL');
    expect(joined).toContain('UQ_sys_webhook_subscriptions_tenant_id');
    expect(joined).not.toContain('"secret" character varying');
    expect(joined).toContain('CREATE TABLE IF NOT EXISTS "sys_webhook_deliveries"');
    expect(joined).toContain('FK_sys_webhook_deliveries_tenant_subscription');
    expect(joined).toContain('REFERENCES "sys_webhook_subscriptions" ("tenant_id", "id")');
    expect(joined).toContain('"payload_sha256" character varying(64) NOT NULL');
    expect(joined).toContain('"expires_at" TIMESTAMP WITH TIME ZONE NOT NULL');
    expect(joined).toContain('ENABLE ROW LEVEL SECURITY');
    expect(joined).toContain('FORCE ROW LEVEL SECURITY');
  });

  it('disables RLS and drops all 3 tables cleanly on down()', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return [];
      }),
    } as unknown as QueryRunner;

    const migration = new CreateIdempotencyKeysAndWebhookSubscriptions1789900027000();
    await migration.down(runner);

    const joined = queries.join('\n');
    expect(joined).toContain('DROP TABLE IF EXISTS "sys_webhook_deliveries"');
    expect(joined).toContain('DROP TABLE IF EXISTS "sys_webhook_subscriptions"');
    expect(joined).toContain('DROP TABLE IF EXISTS "sys_idempotency_keys"');
  });
});
