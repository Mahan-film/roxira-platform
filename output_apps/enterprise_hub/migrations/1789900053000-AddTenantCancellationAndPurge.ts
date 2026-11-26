import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Task T148: Data export after cancellation and tenant purge lifecycle.
 * Adds cancellation and purge columns to "tenants":
 * - status: 'active' | 'suspended' | 'cancelled_readonly' | 'purged' (default: 'active')
 * - delete_after: timestamp with time zone (retention period end)
 * - cancelled_at: timestamp with time zone (cancellation timestamp)
 * - cancellation_reason: text
 * - purged_at: timestamp with time zone (purge completion timestamp)
 *
 * Adds index on (status, delete_after) for efficient purge job scheduling.
 */
export class AddTenantCancellationAndPurge1789900053000 implements MigrationInterface {
  name = 'AddTenantCancellationAndPurge1789900053000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenants"
        ADD COLUMN IF NOT EXISTS "status" character varying(32) NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS "delete_after" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "cancellation_reason" text NULL,
        ADD COLUMN IF NOT EXISTS "purged_at" TIMESTAMP WITH TIME ZONE NULL;
    `);

    // Backfill existing rows to 'active' if null
    await queryRunner.query(`
      UPDATE "tenants" SET "status" = 'active' WHERE "status" IS NULL;
    `);

    // Status check constraint
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'CHK_tenants_status'
        ) THEN
          ALTER TABLE "tenants"
            ADD CONSTRAINT "CHK_tenants_status"
            CHECK ("status" IN ('active', 'suspended', 'cancelled_readonly', 'purged'));
        END IF;
      END $$;
    `);

    // Index for purge job to discover expired cancelled tenants
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tenants_status_delete_after"
        ON "tenants" ("status", "delete_after")
        WHERE "delete_after" IS NOT NULL;
    `);

    // Allow DELETE on posted journal entries/lines ONLY when transaction-local
    // roxira.tenant_purge = 'on' is set inside TenantCancellationService.purgeTenant.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fin_guard_posted_entry() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' AND current_setting('roxira.tenant_purge', true) = 'on' THEN
          RETURN OLD;
        END IF;
        IF OLD.status = 'POSTED' THEN
          RAISE EXCEPTION 'posted journal entry % is immutable; post a reversing entry', OLD.id
            USING ERRCODE = 'RX001';
        END IF;
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fin_guard_posted_lines() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' AND current_setting('roxira.tenant_purge', true) = 'on' THEN
          RETURN OLD;
        END IF;
        IF EXISTS (
          SELECT 1 FROM fin_journal_entries e
           WHERE e.id = OLD.journal_entry_id AND e.status = 'POSTED'
        ) THEN
          RAISE EXCEPTION 'lines of posted journal entry % are immutable', OLD.journal_entry_id
            USING ERRCODE = 'RX001';
        END IF;
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Preserve any non-default cancellation/purge metadata before dropping columns
    // so rollback never silently deletes data.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "_rollback_backup_1789900053000_tenants_cancellation" (
        "tenant_id" uuid PRIMARY KEY,
        "status" character varying(32),
        "delete_after" TIMESTAMP WITH TIME ZONE,
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "cancellation_reason" text,
        "purged_at" TIMESTAMP WITH TIME ZONE,
        "backed_up_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      INSERT INTO "_rollback_backup_1789900053000_tenants_cancellation" (
        "tenant_id", "status", "delete_after", "cancelled_at", "cancellation_reason", "purged_at"
      )
      SELECT "id", "status", "delete_after", "cancelled_at", "cancellation_reason", "purged_at"
      FROM "tenants"
      WHERE "status" <> 'active'
         OR "delete_after" IS NOT NULL
         OR "cancelled_at" IS NOT NULL
         OR "cancellation_reason" IS NOT NULL
         OR "purged_at" IS NOT NULL
      ON CONFLICT ("tenant_id") DO UPDATE SET
        "status" = EXCLUDED."status",
        "delete_after" = EXCLUDED."delete_after",
        "cancelled_at" = EXCLUDED."cancelled_at",
        "cancellation_reason" = EXCLUDED."cancellation_reason",
        "purged_at" = EXCLUDED."purged_at",
        "backed_up_at" = NOW();
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tenants_status_delete_after";`);
    await queryRunner.query(`ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "CHK_tenants_status";`);
    await queryRunner.query(`
      ALTER TABLE "tenants"
        DROP COLUMN IF EXISTS "purged_at",
        DROP COLUMN IF EXISTS "cancellation_reason",
        DROP COLUMN IF EXISTS "cancelled_at",
        DROP COLUMN IF EXISTS "delete_after",
        DROP COLUMN IF EXISTS "status";
    `);
  }
}
