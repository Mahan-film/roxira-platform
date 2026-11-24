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
export class ScopeUniqueImportBatchFileHash1789900021000
  implements MigrationInterface
{
  name = 'ScopeUniqueImportBatchFileHash1789900021000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`SET LOCAL statement_timeout = '30s'`);
    // Note: data_import_batches table size is moderate per tenant (< 100k rows in typical production).
    // Bounded lock_timeout (5s) avoids holding table locks; TypeORM transaction mode all precludes CONCURRENTLY.
    await queryRunner.query(`
      ALTER TABLE "data_import_batches"
      ADD COLUMN IF NOT EXISTS "mapping_hash" text NULL
    `);
    // Backfill null mapping_hash to empty string for old batches so re-imports match cleanly.
    await queryRunner.query(`
      UPDATE "data_import_batches"
      SET "mapping_hash" = ''
      WHERE "mapping_hash" IS NULL
    `);
    // Pre-dedupe step: if legacy active batches share (tenant_id, entity, file_hash, mapping_hash),
    // mark older duplicates as undone = true so CREATE UNIQUE INDEX succeeds deterministically.
    // Note on data safety: Setting undone = true only releases the active idempotency slot.
    // The data_import_batch_items rows of older duplicates are intentionally retained because
    // those records were genuinely imported. undoBatch checks batch.undone and rejects already-undone
    // batches, preventing any double-deletion or deletion of rows from superseded batches.
    // Crash recovery: if a crash occurs between tryReserveBatch and setInserted, the reservation holds
    // inserted = 0; subsequent imports or stale-reaper routines can detect or safely release the reservation.
    await queryRunner.query(`
      UPDATE "data_import_batches" b
      SET "undone" = true
      WHERE b."undone" = false
        AND b."file_hash" IS NOT NULL
        AND b."id" NOT IN (
          SELECT DISTINCT ON ("tenant_id", "entity", "file_hash", COALESCE("mapping_hash", '')) "id"
          FROM "data_import_batches"
          WHERE "undone" = false AND "file_hash" IS NOT NULL
          ORDER BY "tenant_id", "entity", "file_hash", COALESCE("mapping_hash", ''), "created_at" DESC, "id" DESC
        )
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
