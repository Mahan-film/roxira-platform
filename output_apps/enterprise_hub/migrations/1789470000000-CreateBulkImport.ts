import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bulk (streaming) import: one job per uploaded source file, and the rows it staged before anybody
 * reviews them. Both tables carry `tenant_id`, every repository query filters on it, and row-level
 * security enforces it again. Additive; nothing existing is touched. Staged cells are stored as a JSON array in a text column (no jsonb parse cost on a 10-million-row load; they are only read back page by page). Staged rows are removed when a job
 * is posted, cancelled or expires.
 */
export class CreateBulkImport1789470000000 implements MigrationInterface {
  name = 'CreateBulkImport1789470000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "bulk_import_jobs" (
        "id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "created_by" character varying(64),
        "file_name" character varying(300) NOT NULL,
        "size_bytes" bigint NOT NULL,
        "object_key" text NOT NULL,
        "multipart_id" text,
        "driver" character varying(8) NOT NULL,
        "part_bytes" bigint NOT NULL,
        "status" character varying(16) NOT NULL,
        "bytes_read" bigint NOT NULL DEFAULT 0,
        "rows_staged" bigint NOT NULL DEFAULT 0,
        "tables" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "checkpoint" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "notes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "review" jsonb,
        "post_progress" jsonb,
        "batch_id" uuid,
        "error" text,
        "attempts" integer NOT NULL DEFAULT 0,
        "source_removed" boolean NOT NULL DEFAULT false,
        "rows_removed" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "started_at" TIMESTAMP WITH TIME ZONE,
        "finished_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "CHK_bulk_import_jobs_status" CHECK ("status" IN
          ('uploading','queued','running','pausing','paused','cancelling','cancelled','failed','ready','posting','posted','expired')),
        CONSTRAINT "CHK_bulk_import_jobs_size" CHECK ("size_bytes" > 0)
      )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bulk_import_jobs_tenant" ON "bulk_import_jobs" ("tenant_id", "created_at" DESC)`,
    );
    await q.query(`
      CREATE TABLE IF NOT EXISTS "bulk_import_rows" (
        "tenant_id" uuid NOT NULL,
        "job_id" uuid NOT NULL,
        "table_idx" integer NOT NULL,
        "row_no" bigint NOT NULL,
        "cells" text NOT NULL,
        PRIMARY KEY ("job_id", "table_idx", "row_no"),
        CONSTRAINT "FK_bulk_import_rows_job" FOREIGN KEY ("job_id") REFERENCES "bulk_import_jobs"("id") ON DELETE CASCADE
      )`);
    const tenantMatch = `"tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid`;
    for (const table of ['bulk_import_jobs', 'bulk_import_rows']) {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await q.query(`DROP POLICY IF EXISTS "${table}_tenant" ON "${table}"`);
      await q.query(`CREATE POLICY "${table}_tenant" ON "${table}" USING (${tenantMatch}) WITH CHECK (${tenantMatch})`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "bulk_import_rows"`);
    await q.query(`DROP TABLE IF EXISTS "bulk_import_jobs"`);
  }
}
