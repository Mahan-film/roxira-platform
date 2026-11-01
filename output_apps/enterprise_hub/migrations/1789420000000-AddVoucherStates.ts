import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Manual voucher states: DRAFT (work in progress, may be unbalanced), TEMPORARY (balanced and
 * checked, still editable), POSTED (final, immutable; unchanged from before).
 *
 *  - `status` gets a CHECK so a typo cannot create a fourth state.
 *  - The deferred balance trigger on lines now skips DRAFT entries (tenant mixing is still
 *    refused), because a draft is allowed to be unbalanced while it is being typed.
 *  - Moving an entry out of DRAFT is refused by the database unless it has at least two lines and
 *    balances exactly and is not dated inside a locked period, so the service check has a backstop.
 *
 * Existing entries are all POSTED and are not touched.
 *
 * Revert: `down()` restores the previous line trigger function and drops the transition guard and
 * the CHECK. Run it only when no DRAFT or TEMPORARY entry exists (they would become invalid).
 */
export class AddVoucherStates1789420000000 implements MigrationInterface {
  name = 'AddVoucherStates1789420000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "fin_journal_entries"
        ADD CONSTRAINT "CHK_fin_journal_entries_status"
        CHECK ("status" IN ('DRAFT','TEMPORARY','POSTED','VOID'))
    `);

    await q.query(`
      CREATE OR REPLACE FUNCTION fin_assert_entry_consistent() RETURNS trigger AS $$
      DECLARE
        diff numeric;
        bad integer;
        entry_status text;
      BEGIN
        IF NEW.id <> (SELECT max(id) FROM fin_journal_entry_lines WHERE journal_entry_id = NEW.journal_entry_id) THEN
          RETURN NULL;
        END IF;
        SELECT status INTO entry_status FROM fin_journal_entries WHERE id = NEW.journal_entry_id;
        IF entry_status IS DISTINCT FROM 'DRAFT' THEN
          SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) INTO diff
            FROM fin_journal_entry_lines WHERE journal_entry_id = NEW.journal_entry_id;
          IF diff <> 0 THEN
            RAISE EXCEPTION 'journal entry % is not balanced (debit - credit = %)', NEW.journal_entry_id, diff
              USING ERRCODE = 'RX004';
          END IF;
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

    await q.query(`
      CREATE OR REPLACE FUNCTION fin_guard_voucher_transition() RETURNS trigger AS $$
      DECLARE
        diff numeric;
        line_count integer;
      BEGIN
        IF OLD.status = 'DRAFT' AND NEW.status <> 'DRAFT' AND NEW.status <> 'VOID' THEN
          SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0), count(*) INTO diff, line_count
            FROM fin_journal_entry_lines WHERE journal_entry_id = OLD.id;
          IF line_count < 2 OR diff <> 0 THEN
            RAISE EXCEPTION 'journal entry % cannot leave DRAFT unless it has two or more lines and balances', OLD.id
              USING ERRCODE = 'RX004';
          END IF;
        END IF;
        IF NEW.status = 'POSTED' AND OLD.status <> 'POSTED' THEN
          IF EXISTS (
            SELECT 1 FROM fin_period_locks l
             WHERE l.tenant_id = NEW.tenant_id
               AND l.unlocked_at IS NULL
               AND NEW.date::date BETWEEN l.period_start AND l.period_end
          ) THEN
            RAISE EXCEPTION 'date % is inside a locked period', NEW.date::date
              USING ERRCODE = 'RX003';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await q.query(`
      CREATE TRIGGER "TRG_fin_journal_entries_voucher_transition"
        BEFORE UPDATE OF "status", "date" ON "fin_journal_entries"
        FOR EACH ROW EXECUTE FUNCTION fin_guard_voucher_transition()
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP TRIGGER IF EXISTS "TRG_fin_journal_entries_voucher_transition" ON "fin_journal_entries"`,
    );
    await q.query(`DROP FUNCTION IF EXISTS fin_guard_voucher_transition()`);
    await q.query(`
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
    await q.query(
      `ALTER TABLE "fin_journal_entries" DROP CONSTRAINT IF EXISTS "CHK_fin_journal_entries_status"`,
    );
  }
}
