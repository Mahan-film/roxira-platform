import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Posting rules engine tables (issue #230): the tenant's role -> account mapping per document type
 * and one idempotency row per posted source document. Both carry `tenant_id`, FORCE row-level
 * security, and are reached only through PostingRulesRepository. Purely additive.
 */
const TABLES = ['fin_posting_role_maps', 'fin_posting_sources'];

export class CreatePostingRules1789510000000 implements MigrationInterface {
  name = 'CreatePostingRules1789510000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE IF NOT EXISTS "fin_posting_role_maps" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "doc_type" character varying(48) NOT NULL,
        "role" character varying(48) NOT NULL,
        "account_code" character varying(32) NOT NULL,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now()
      )`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_posting_role_maps" ON "fin_posting_role_maps" ("tenant_id", "doc_type", "role")`,
    );
    await q.query(
      `CREATE TABLE IF NOT EXISTS "fin_posting_sources" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "source_type" character varying(48) NOT NULL,
        "source_id" character varying(64) NOT NULL,
        "doc_type" character varying(48) NOT NULL,
        "entry_id" integer,
        "entry_number" character varying(64),
        "reversal_entry_id" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now()
      )`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_posting_sources" ON "fin_posting_sources" ("tenant_id", "source_type", "source_id", "doc_type")`,
    );
    for (const table of TABLES) await enableTenantRls(q, table);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [...TABLES].reverse()) await disableTenantRls(q, table);
    await q.query(`DROP TABLE IF EXISTS "fin_posting_sources"`);
    await q.query(`DROP TABLE IF EXISTS "fin_posting_role_maps"`);
  }
}
