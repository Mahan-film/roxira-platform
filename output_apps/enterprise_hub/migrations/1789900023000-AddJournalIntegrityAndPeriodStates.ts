import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * T178: Journal integrity (per-entity gapless GL audit number + SHA-256 hash chain),
 * period states (OPEN, SOFT_LOCKED, ADJUSTMENT, HARD_CLOSED), control-account flag,
 * and master-data change log.
 *
 * Revert: `down()` drops triggers, functions, tables, indexes, and columns in reverse order.
 */
export class AddJournalIntegrityAndPeriodStates1789900023000 implements MigrationInterface {
  name = 'AddJournalIntegrityAndPeriodStates1789900023000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`SET LOCAL lock_timeout = '2s'`);

    // 1. Journal integrity columns on fin_journal_entries
    await q.query(
      `ALTER TABLE "fin_journal_entries" ADD COLUMN IF NOT EXISTS "gl_audit_number" bigint`,
    );
    await q.query(
      `ALTER TABLE "fin_journal_entries" ADD COLUMN IF NOT EXISTS "prev_chain_hash" varchar(64)`,
    );
    await q.query(
      `ALTER TABLE "fin_journal_entries" ADD COLUMN IF NOT EXISTS "chain_hash" varchar(64)`,
    );
    await q.query(
      `ALTER TABLE "fin_journal_entries" ADD COLUMN IF NOT EXISTS "posted_at_utc" timestamptz`,
    );
    await q.query(
      `ALTER TABLE "fin_journal_entries" ADD COLUMN IF NOT EXISTS "accounting_period_id" integer`,
    );
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_journal_entries_tenant_gl_audit_number"
        ON "fin_journal_entries" ("tenant_id", "gl_audit_number")
        WHERE "gl_audit_number" IS NOT NULL
    `);

    // 2. Per-entity GL sequencer state
    await q.query(`
      CREATE TABLE IF NOT EXISTS "fin_gl_sequencers" (
        "tenant_id" uuid NOT NULL,
        "last_audit_number" bigint NOT NULL DEFAULT 0,
        "head_hash" varchar(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fin_gl_sequencers" PRIMARY KEY ("tenant_id")
      )
    `);
    await enableTenantRls(q, 'fin_gl_sequencers');

    // 3. Allow one-time hash-chain seal on POSTED entries when chain_hash is still NULL;
    //    forbid any other mutation to POSTED entries or any change once sealed.
    await q.query(`
      CREATE OR REPLACE FUNCTION fin_guard_posted_entry() RETURNS trigger AS $$
      BEGIN
        IF OLD.status = 'POSTED' THEN
          IF TG_OP = 'UPDATE'
             AND OLD.chain_hash IS NULL
             AND NEW.chain_hash IS NOT NULL
             AND NEW.gl_audit_number IS NOT NULL
             AND NEW.prev_chain_hash IS NOT NULL
             AND NEW.posted_at_utc IS NOT NULL
             AND NEW.id IS NOT DISTINCT FROM OLD.id
             AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
             AND NEW.entry_number IS NOT DISTINCT FROM OLD.entry_number
             AND NEW.date IS NOT DISTINCT FROM OLD.date
             AND NEW.description IS NOT DISTINCT FROM OLD.description
             AND NEW.status IS NOT DISTINCT FROM OLD.status
             AND NEW.reverses_entry_id IS NOT DISTINCT FROM OLD.reverses_entry_id
             AND NEW.entry_type IS NOT DISTINCT FROM OLD.entry_type
             AND NEW.permanent_number IS NOT DISTINCT FROM OLD.permanent_number
             AND NEW.permanent_fiscal_year_id IS NOT DISTINCT FROM OLD.permanent_fiscal_year_id
             AND NEW.accounting_period_id IS NOT DISTINCT FROM OLD.accounting_period_id THEN
            RETURN NEW;
          END IF;
          RAISE EXCEPTION 'posted journal entry % is immutable; post a reversing entry', OLD.id
            USING ERRCODE = 'RX001';
        END IF;
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    // Attach (idempotent): the trigger name is shared with the original guard migration, so
    // re-create it explicitly. lock_timeout above bounds the ACCESS EXCLUSIVE wait.
    await q.query(`DROP TRIGGER IF EXISTS "TRG_fin_journal_entries_guard_posted" ON "fin_journal_entries"`);
    await q.query(`
      CREATE TRIGGER "TRG_fin_journal_entries_guard_posted"
        BEFORE UPDATE OR DELETE ON "fin_journal_entries"
        FOR EACH ROW EXECUTE FUNCTION fin_guard_posted_entry()
    `);

    // 4. Period states (OPEN, SOFT_LOCKED, ADJUSTMENT, HARD_CLOSED)
    await q.query(`
      CREATE TABLE IF NOT EXISTS "fin_accounting_periods" (
        "id" SERIAL NOT NULL,
        "tenant_id" uuid NOT NULL,
        "fiscal_year_id" integer,
        "code" varchar(32) NOT NULL,
        "name" varchar(64) NOT NULL,
        "calendar_type" varchar(16) NOT NULL DEFAULT 'GREGORIAN',
        "period_start" date NOT NULL,
        "period_end" date NOT NULL,
        "is_adjustment" boolean NOT NULL DEFAULT false,
        "state" varchar(16) NOT NULL DEFAULT 'OPEN',
        "allowed_roles" text[] NOT NULL DEFAULT '{}',
        "locked_by" varchar(64),
        "locked_at" timestamptz,
        "lock_reason" text,
        "hard_closed_by" varchar(64),
        "hard_closed_at" timestamptz,
        "hard_close_reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fin_accounting_periods_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fin_accounting_periods_range" CHECK ("period_start" <= "period_end"),
        CONSTRAINT "CHK_fin_accounting_periods_state" CHECK ("state" IN ('OPEN', 'SOFT_LOCKED', 'ADJUSTMENT', 'HARD_CLOSED'))
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_accounting_periods_tenant_code"
        ON "fin_accounting_periods" ("tenant_id", "code")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_accounting_periods_tenant_dates"
        ON "fin_accounting_periods" ("tenant_id", "period_start", "period_end")
    `);
    await enableTenantRls(q, 'fin_accounting_periods');

    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_fin_journal_entries_accounting_period'
        ) THEN
          ALTER TABLE "fin_journal_entries"
            ADD CONSTRAINT "FK_fin_journal_entries_accounting_period"
            FOREIGN KEY ("accounting_period_id")
            REFERENCES "fin_accounting_periods" ("id")
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await q.query(`
      CREATE OR REPLACE FUNCTION fin_guard_accounting_period_hard_close() RETURNS trigger AS $$
      BEGIN
        IF OLD.state = 'HARD_CLOSED' THEN
          RAISE EXCEPTION 'hard-closed accounting period % (%) is irreversible', OLD.id, OLD.code
            USING ERRCODE = 'RX007';
        END IF;
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await q.query(`
      CREATE TRIGGER "TRG_fin_accounting_periods_guard_hard_close"
        BEFORE UPDATE OR DELETE ON "fin_accounting_periods"
        FOR EACH ROW EXECUTE FUNCTION fin_guard_accounting_period_hard_close()
    `);

    // 5. Control account flag on Chart of Accounts
    await q.query(
      `ALTER TABLE "fin_chart_of_accounts" ADD COLUMN IF NOT EXISTS "is_control_account" boolean NOT NULL DEFAULT false`,
    );

    // 6. Master-data change log
    await q.query(`
      CREATE TABLE IF NOT EXISTS "fin_master_data_change_logs" (
        "id" SERIAL NOT NULL,
        "tenant_id" uuid NOT NULL,
        "entity_type" varchar(64) NOT NULL,
        "entity_id" varchar(64) NOT NULL,
        "field_name" varchar(64) NOT NULL,
        "old_value" text,
        "new_value" text,
        "changed_by" varchar(64) NOT NULL,
        "changed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fin_master_data_change_logs_id" PRIMARY KEY ("id")
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_master_data_change_logs_tenant_entity"
        ON "fin_master_data_change_logs" ("tenant_id", "entity_type", "entity_id", "changed_at")
    `);
    await enableTenantRls(q, 'fin_master_data_change_logs');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'fin_master_data_change_logs');
    await q.query(`DROP INDEX IF EXISTS "IDX_fin_master_data_change_logs_tenant_entity"`);
    await q.query(`DROP TABLE IF EXISTS "fin_master_data_change_logs"`);

    await q.query(
      `ALTER TABLE "fin_chart_of_accounts" DROP COLUMN IF EXISTS "is_control_account"`,
    );

    await q.query(
      `DROP TRIGGER IF EXISTS "TRG_fin_accounting_periods_guard_hard_close" ON "fin_accounting_periods"`,
    );
    await q.query(`DROP FUNCTION IF EXISTS fin_guard_accounting_period_hard_close()`);
    await disableTenantRls(q, 'fin_accounting_periods');
    await q.query(`DROP INDEX IF EXISTS "IDX_fin_accounting_periods_tenant_dates"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_fin_accounting_periods_tenant_code"`);
    await q.query(
      `ALTER TABLE "fin_journal_entries" DROP CONSTRAINT IF EXISTS "FK_fin_journal_entries_accounting_period"`,
    );
    await q.query(`DROP TABLE IF EXISTS "fin_accounting_periods"`);

    await q.query(`
      CREATE OR REPLACE FUNCTION fin_guard_posted_entry() RETURNS trigger AS $$
      BEGIN
        IF OLD.status = 'POSTED' THEN
          RAISE EXCEPTION 'posted journal entry % is immutable; post a reversing entry', OLD.id
            USING ERRCODE = 'RX001';
        END IF;
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await q.query(`DROP TRIGGER IF EXISTS "TRG_fin_journal_entries_guard_posted" ON "fin_journal_entries"`);
    await q.query(`
      CREATE TRIGGER "TRG_fin_journal_entries_guard_posted"
        BEFORE UPDATE OR DELETE ON "fin_journal_entries"
        FOR EACH ROW EXECUTE FUNCTION fin_guard_posted_entry()
    `);

    await disableTenantRls(q, 'fin_gl_sequencers');
    await q.query(`DROP TABLE IF EXISTS "fin_gl_sequencers"`);

    await q.query(
      `DROP INDEX IF EXISTS "UQ_fin_journal_entries_tenant_gl_audit_number"`,
    );
    await q.query(
      `ALTER TABLE "fin_journal_entries" DROP COLUMN IF EXISTS "accounting_period_id"`,
    );
    await q.query(
      `ALTER TABLE "fin_journal_entries" DROP COLUMN IF EXISTS "posted_at_utc"`,
    );
    await q.query(
      `ALTER TABLE "fin_journal_entries" DROP COLUMN IF EXISTS "chain_hash"`,
    );
    await q.query(
      `ALTER TABLE "fin_journal_entries" DROP COLUMN IF EXISTS "prev_chain_hash"`,
    );
    await q.query(
      `ALTER TABLE "fin_journal_entries" DROP COLUMN IF EXISTS "gl_audit_number"`,
    );
  }
}
