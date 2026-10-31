import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ledger hardening, part 1 of 2 (additive; no existing column is touched).
 *
 *  - `fin_period_locks`: tenant-scoped period locks with an audit trail. A row is never deleted:
 *    unlocking stamps `unlocked_at/by/reason`, re-locking inserts a new row.
 *  - `fin_journal_entries.reverses_entry_id` (+ unique partial index): a posted entry can be
 *    reversed at most once, and a reversal can itself not be reversed. Replaces the old
 *    "<number>-REV" string convention, which broke on long entry numbers.
 *  - DB triggers protecting POSTED rows:
 *      * POSTED headers cannot be updated or deleted; lines of a POSTED entry cannot be
 *        updated or deleted (corrections are reversing entries).
 *      * a new entry cannot be dated inside an actively locked period (backstop to the service
 *        check, which runs under an advisory lock so lock/post cannot race).
 *      * deferred constraint trigger: at COMMIT every entry balances exactly and every line's
 *        tenant matches both its entry and its account.
 *
 * Revert: `down()` drops the triggers, functions, index, column and table in reverse order. The
 * lock history in `fin_period_locks` is lost on revert (take a dump first if it must be kept).
 */
export class LedgerPeriodLocksAndGuards1789320000000
  implements MigrationInterface
{
  name = 'LedgerPeriodLocksAndGuards1789320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fin_period_locks" (
        "id" SERIAL NOT NULL,
        "tenant_id" uuid NOT NULL,
        "period_start" date NOT NULL,
        "period_end" date NOT NULL,
        "reason" text,
        "locked_by" varchar(64) NOT NULL,
        "locked_at" timestamptz NOT NULL DEFAULT now(),
        "unlocked_at" timestamptz,
        "unlocked_by" varchar(64),
        "unlock_reason" text,
        CONSTRAINT "PK_fin_period_locks_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fin_period_locks_range" CHECK ("period_start" <= "period_end"),
        CONSTRAINT "CHK_fin_period_locks_unlock" CHECK (("unlocked_at" IS NULL) = ("unlocked_by" IS NULL))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_period_locks_tenant_active"
        ON "fin_period_locks" ("tenant_id", "period_start", "period_end")
        WHERE "unlocked_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_period_locks_tenant"
        ON "fin_period_locks" ("tenant_id", "locked_at")
    `);

    // Audit rows are append-only: only the unlock columns may change, never a delete.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fin_guard_period_locks() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'period lock history cannot be deleted' USING ERRCODE = 'RX002';
        END IF;
        IF OLD.unlocked_at IS NOT NULL
           OR NEW.id IS DISTINCT FROM OLD.id
           OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
           OR NEW.period_start IS DISTINCT FROM OLD.period_start
           OR NEW.period_end IS DISTINCT FROM OLD.period_end
           OR NEW.reason IS DISTINCT FROM OLD.reason
           OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
           OR NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN
          RAISE EXCEPTION 'period lock history is append-only' USING ERRCODE = 'RX002';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_fin_period_locks_guard"
        BEFORE UPDATE OR DELETE ON "fin_period_locks"
        FOR EACH ROW EXECUTE FUNCTION fin_guard_period_locks()
    `);

    await queryRunner.query(
      `ALTER TABLE "fin_journal_entries" ADD COLUMN IF NOT EXISTS "reverses_entry_id" integer`,
    );
    await queryRunner.query(`
      ALTER TABLE "fin_journal_entries"
        ADD CONSTRAINT "FK_fin_journal_entries_reverses"
        FOREIGN KEY ("reverses_entry_id") REFERENCES "fin_journal_entries"("id") ON DELETE RESTRICT
    `);
    // Backfill the old "<number>-REV" convention (same tenant only).
    await queryRunner.query(`
      UPDATE "fin_journal_entries" r
         SET "reverses_entry_id" = o."id"
        FROM "fin_journal_entries" o
       WHERE r."tenant_id" = o."tenant_id"
         AND r."entry_number" = o."entry_number" || '-REV'
         AND r."reverses_entry_id" IS NULL
         AND r."id" <> o."id"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_journal_entries_tenant_reverses"
        ON "fin_journal_entries" ("tenant_id", "reverses_entry_id")
        WHERE "reverses_entry_id" IS NOT NULL
    `);

    await queryRunner.query(`
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
    await queryRunner.query(`
      CREATE TRIGGER "TRG_fin_journal_entries_guard_posted"
        BEFORE UPDATE OR DELETE ON "fin_journal_entries"
        FOR EACH ROW EXECUTE FUNCTION fin_guard_posted_entry()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fin_guard_posted_lines() RETURNS trigger AS $$
      BEGIN
        -- During a cascade delete of a non-posted entry the parent row is already gone.
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
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_fin_journal_entry_lines_guard_posted"
        BEFORE UPDATE OR DELETE ON "fin_journal_entry_lines"
        FOR EACH ROW EXECUTE FUNCTION fin_guard_posted_lines()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fin_guard_locked_period() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM fin_period_locks l
           WHERE l.tenant_id = NEW.tenant_id
             AND l.unlocked_at IS NULL
             AND NEW.date::date BETWEEN l.period_start AND l.period_end
        ) THEN
          RAISE EXCEPTION 'date % is inside a locked period', NEW.date::date
            USING ERRCODE = 'RX003';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_fin_journal_entries_guard_locked_period"
        BEFORE INSERT ON "fin_journal_entries"
        FOR EACH ROW EXECUTE FUNCTION fin_guard_locked_period()
    `);

    // Checked once per entry (on its highest line id) at COMMIT, when all lines are present.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fin_assert_entry_consistent() RETURNS trigger AS $$
      DECLARE
        diff numeric;
        bad integer;
      BEGIN
        IF NEW.id <> (SELECT max(id) FROM fin_journal_entry_lines WHERE journal_entry_id = NEW.journal_entry_id) THEN
          RETURN NULL;
        END IF;
        SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) INTO diff
          FROM fin_journal_entry_lines WHERE journal_entry_id = NEW.journal_entry_id;
        IF diff <> 0 THEN
          RAISE EXCEPTION 'journal entry % is not balanced (debit - credit = %)', NEW.journal_entry_id, diff
            USING ERRCODE = 'RX004';
        END IF;
        SELECT count(*) INTO bad
          FROM fin_journal_entry_lines l
          JOIN fin_journal_entries e ON e.id = l.journal_entry_id
          JOIN fin_chart_of_accounts a ON a.id = l.account_id
         WHERE l.journal_entry_id = NEW.journal_entry_id
           AND (l.tenant_id <> e.tenant_id OR l.tenant_id <> a.tenant_id);
        IF bad > 0 THEN
          RAISE EXCEPTION 'journal entry % mixes tenants', NEW.journal_entry_id
            USING ERRCODE = 'RX005';
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER "TRG_fin_journal_entry_lines_consistent"
        AFTER INSERT ON "fin_journal_entry_lines"
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION fin_assert_entry_consistent()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_fin_journal_entry_lines_consistent" ON "fin_journal_entry_lines"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS fin_assert_entry_consistent()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_fin_journal_entries_guard_locked_period" ON "fin_journal_entries"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS fin_guard_locked_period()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_fin_journal_entry_lines_guard_posted" ON "fin_journal_entry_lines"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS fin_guard_posted_lines()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_fin_journal_entries_guard_posted" ON "fin_journal_entries"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS fin_guard_posted_entry()`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_fin_journal_entries_tenant_reverses"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fin_journal_entries" DROP CONSTRAINT IF EXISTS "FK_fin_journal_entries_reverses"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fin_journal_entries" DROP COLUMN IF EXISTS "reverses_entry_id"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_fin_period_locks_guard" ON "fin_period_locks"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS fin_guard_period_locks()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fin_period_locks"`);
  }
}
