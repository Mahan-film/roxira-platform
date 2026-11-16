import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * AI interactions audit log table (T108 & Amendments 1 & 2).
 * Records every LLM interaction, question hash, tools and arguments, model, token usage,
 * cost, latency, validator verdict, and customer data fallback status.
 * tenant_id is mandatory and the table has FORCE RLS (AGENTS.md section 4).
 * Retention is governed by expires_at (90 days from creation) and cleaned up via periodic purge.
 */
export class CreateAiInteractions1789900005500 implements MigrationInterface {
  name = 'CreateAiInteractions1789900005500';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_interactions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid,
        "question_hash" character varying(64) NOT NULL,
        "tools_and_args" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "model" character varying(128) NOT NULL,
        "prompt_tokens" integer NOT NULL DEFAULT 0,
        "completion_tokens" integer NOT NULL DEFAULT 0,
        "total_tokens" integer NOT NULL DEFAULT 0,
        "cost_minor" bigint NOT NULL DEFAULT 0,
        "latency_ms" integer NOT NULL DEFAULT 0,
        "validator_verdict" character varying(32) NOT NULL,
        "customer_data_fallback" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '90 days')
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_interactions_tenant_created" ON "ai_interactions" ("tenant_id", "created_at")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_interactions_expires_at" ON "ai_interactions" ("expires_at")`,
    );
    await enableTenantRls(q, 'ai_interactions');
    await q.query(`ALTER TABLE "ai_interactions" FORCE ROW LEVEL SECURITY`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'ai_interactions');
    await q.query(`DROP TABLE IF EXISTS "ai_interactions"`);
  }
}
