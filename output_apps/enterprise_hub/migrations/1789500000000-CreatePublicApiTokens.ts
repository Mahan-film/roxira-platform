import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Tenant API tokens for the public API (`/api/v1`). Only a SHA-256 hash of a token is stored; the
 * plain token is shown once at creation. FORCE RLS: every access runs inside TenantScope, and the
 * token format carries the tenant id so the guard can bind the tenant before looking the hash up.
 */
export class CreatePublicApiTokens1789500000000 implements MigrationInterface {
  name = 'CreatePublicApiTokens1789500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "public_api_tokens" (
        "id" SERIAL NOT NULL,
        "tenant_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "token_prefix" character varying(24) NOT NULL,
        "token_hash" character(64) NOT NULL,
        "scopes" text[] NOT NULL,
        "rate_limit_per_minute" integer NOT NULL DEFAULT 60,
        "created_by" character varying(64) NOT NULL,
        "expires_at" TIMESTAMP,
        "revoked_at" TIMESTAMP,
        "last_used_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_public_api_tokens_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_public_api_tokens_rate" CHECK ("rate_limit_per_minute" BETWEEN 1 AND 6000),
        CONSTRAINT "CHK_public_api_tokens_scopes" CHECK (cardinality("scopes") > 0)
      )
    `);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_public_api_tokens_hash" ON "public_api_tokens" ("tenant_id", "token_hash")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_public_api_tokens_tenant_created" ON "public_api_tokens" ("tenant_id", "created_at")`,
    );
    await enableTenantRls(q, 'public_api_tokens');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'public_api_tokens');
    await q.query(`DROP TABLE IF EXISTS "public_api_tokens"`);
  }
}
