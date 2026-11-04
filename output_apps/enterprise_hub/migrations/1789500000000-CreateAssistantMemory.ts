import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Episodic memory of the assistant: facts a user explicitly confirmed in a conversation.
 * Bitemporal: valid_from/valid_to say when the fact is true in the business; recorded_at /
 * superseded_at say when we knew it, so "what did we believe on date X" is answerable.
 * A fact is never updated in place; a correction closes the old row and inserts a new one.
 * tenant_id is mandatory and the table has FORCE RLS (AGENTS.md section 4). Additive and reversible.
 */
export class CreateAssistantMemory1789500000000 implements MigrationInterface {
  name = 'CreateAssistantMemory1789500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "assistant_memory_facts" (
        "id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "subject" character varying(200) NOT NULL,
        "fact" character varying(1000) NOT NULL,
        "confirmed_by" uuid NOT NULL,
        "confirmed_at" timestamptz NOT NULL DEFAULT now(),
        "source_conversation_id" character varying(64),
        "valid_from" timestamptz NOT NULL DEFAULT now(),
        "valid_to" timestamptz,
        "recorded_at" timestamptz NOT NULL DEFAULT now(),
        "superseded_at" timestamptz,
        "superseded_by" uuid,
        CONSTRAINT "CHK_assistant_memory_valid_range" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from")
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_assistant_memory_tenant_subject" ON "assistant_memory_facts" ("tenant_id", "subject")`,
    );
    await enableTenantRls(q, 'assistant_memory_facts');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'assistant_memory_facts');
    await q.query(`DROP TABLE IF EXISTS "assistant_memory_facts"`);
  }
}
