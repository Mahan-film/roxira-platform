import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Scope data-import batch file-hash idempotency by (tenant_id, entity, file_hash, mapping_hash)
 * and enforce it with a unique partial index on active (undone = false) batches (#1216).
 *
 * Note: TypeORM's repo-wide `migration:run` executes in transaction mode `"all"` (which rejects
 * `transaction = false` with ForbiddenTransactionModeOverrideError; see 1789210000000), and
 * PostgreSQL forbids `CREATE/DROP INDEX CONCURRENTLY` inside a transaction block. We therefore
 * bound lock acquisition with `SET LOCAL lock_timeout` and `IF NOT EXISTS` inside the standard
 * transaction.
 */
export class ScopeUniqueImportBatchFileHash1789900019000
  implements MigrationInterface
{
  name = 'ScopeUniqueImportBatchFileHash1789900019000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`SET LOCAL statement_timeout = '30s'`);
    await queryRunner.query(`
      ALTER TABLE "data_import_batches"
      ADD COLUMN IF NOT EXISTS "mapping_hash" text NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_data_import_batches_active_idempotency"
      ON "data_import_batches" ("tenant_id", "entity", "file_hash", COALESCE("mapping_hash", ''))
      WHERE "file_hash" IS NOT NULL AND "undone" = false
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_data_import_batches_tenant_file_hash"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_data_import_batches_active_idempotency"
    `);
    await queryRunner.query(`
      ALTER TABLE "data_import_batches"
      DROP COLUMN IF EXISTS "mapping_hash"
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_data_import_batches_tenant_file_hash"
      ON "data_import_batches" ("tenant_id", "file_hash")
    `);
  }
}
