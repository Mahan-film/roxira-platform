import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Dual-amount ledger (expand + backfill) and FX rates table (Task T138 / WAVE 15 / R4 Decision 3):
 *
 * 1. Expand fin_journal_entry_lines with nullable dual-amount columns:
 *    - tx_currency_code (varchar(8))
 *    - fx_rate_applied (numeric(24, 6))
 *    - tx_debit (numeric(18, 2))
 *    - tx_credit (numeric(18, 2))
 *    - book_debit (numeric(18, 2))
 *    - book_credit (numeric(18, 2))
 *    - is_rounding (boolean)
 * 2. Backfill existing lines: book = tx = current amounts, rate = 1.0.
 * 3. Bi-directional sync trigger on fin_journal_entry_lines so legacy and new writers stay synchronized.
 * 4. Create fx_rates table keyed by (tenant, base, quote, date, rate_type) with FORCE RLS.
 * 5. Update posting triggers (fin_assert_entry_consistent, fin_guard_voucher_transition):
 *    - Enforce SUM(book) balance.
 *    - Enforce SUM(tx) balance when entry has a single transaction currency.
 *    - Exclude is_rounding line from tx currency balance.
 */
export class DualAmountLedgerExpandBackfill1789900009000 implements MigrationInterface {
  name = 'DualAmountLedgerExpandBackfill1789900009000';

  private readonly tableLines = 'fin_journal_entry_lines';
  private readonly tableFxRates = 'fx_rates';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Add dual-amount columns to fin_journal_entry_lines
    await q.query(`
      ALTER TABLE "${this.tableLines}"
        ADD COLUMN IF NOT EXISTS "tx_currency_code" varchar(8),
        ADD COLUMN IF NOT EXISTS "fx_rate_applied" numeric(24, 6),
        ADD COLUMN IF NOT EXISTS "tx_debit" numeric(18, 2),
        ADD COLUMN IF NOT EXISTS "tx_credit" numeric(18, 2),
        ADD COLUMN IF NOT EXISTS "book_debit" numeric(18, 2),
        ADD COLUMN IF NOT EXISTS "book_credit" numeric(18, 2),
        ADD COLUMN IF NOT EXISTS "is_rounding" boolean NOT NULL DEFAULT false
    `);

    // 2. Backfill existing journal entry lines (temporarily bypass posted-line immutability trigger)
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_trigger
           WHERE tgname = 'TRG_fin_journal_entry_lines_guard_posted'
             AND tgrelid = '${this.tableLines}'::regclass
        ) THEN
          ALTER TABLE "${this.tableLines}" DISABLE TRIGGER "TRG_fin_journal_entry_lines_guard_posted";
        END IF;
      END $$;
    `);
    try {
      await q.query(`
        UPDATE "${this.tableLines}"
           SET "tx_currency_code" = COALESCE("currency", 'IRR'),
               "fx_rate_applied" = COALESCE("fx_rate", 1.0),
               "tx_debit" = "debit",
               "tx_credit" = "credit",
               "book_debit" = "debit",
               "book_credit" = "credit",
               "is_rounding" = false
         WHERE "book_debit" IS NULL
      `);
    } finally {
      await q.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_trigger
             WHERE tgname = 'TRG_fin_journal_entry_lines_guard_posted'
               AND tgrelid = '${this.tableLines}'::regclass
          ) THEN
            ALTER TABLE "${this.tableLines}" ENABLE TRIGGER "TRG_fin_journal_entry_lines_guard_posted";
          END IF;
        END $$;
      `);
    }

    // 3. Sync trigger for backward-compatibility during expand phase
    await q.query(`
      CREATE OR REPLACE FUNCTION fin_sync_journal_entry_line_dual_amounts() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF (NEW.debit IS NULL OR NEW.debit = 0) AND COALESCE(NEW.book_debit, 0) <> 0 THEN
            NEW.debit := NEW.book_debit;
          END IF;
          IF (NEW.credit IS NULL OR NEW.credit = 0) AND COALESCE(NEW.book_credit, 0) <> 0 THEN
            NEW.credit := NEW.book_credit;
          END IF;
          IF NEW.book_debit IS NULL AND NEW.debit IS NOT NULL THEN
            NEW.book_debit := NEW.debit;
          END IF;
          IF NEW.book_credit IS NULL AND NEW.credit IS NOT NULL THEN
            NEW.book_credit := NEW.credit;
          END IF;
        ELSE
          IF NEW.book_debit IS DISTINCT FROM OLD.book_debit AND NEW.debit IS NOT DISTINCT FROM OLD.debit THEN
            NEW.debit := NEW.book_debit;
          ELSIF NEW.debit IS DISTINCT FROM OLD.debit AND NEW.book_debit IS NOT DISTINCT FROM OLD.book_debit THEN
            NEW.book_debit := NEW.debit;
          END IF;
          IF NEW.book_credit IS DISTINCT FROM OLD.book_credit AND NEW.credit IS NOT DISTINCT FROM OLD.credit THEN
            NEW.credit := NEW.book_credit;
          ELSIF NEW.credit IS DISTINCT FROM OLD.credit AND NEW.book_credit IS NOT DISTINCT FROM OLD.book_credit THEN
            NEW.book_credit := NEW.credit;
          END IF;
        END IF;

        IF NEW.tx_debit IS NULL THEN
          NEW.tx_debit := COALESCE(NEW.book_debit, NEW.debit, 0);
        END IF;
        IF NEW.tx_credit IS NULL THEN
          NEW.tx_credit := COALESCE(NEW.book_credit, NEW.credit, 0);
        END IF;

        IF NEW.tx_currency_code IS NULL THEN
          NEW.tx_currency_code := COALESCE(NEW.currency, 'IRR');
        END IF;
        IF TG_OP = 'INSERT' THEN
          IF (NEW.currency IS NULL OR NEW.currency = 'IRR') AND NEW.tx_currency_code IS NOT NULL AND NEW.tx_currency_code <> 'IRR' THEN
            NEW.currency := NEW.tx_currency_code;
          ELSIF NEW.currency IS NULL THEN
            NEW.currency := NEW.tx_currency_code;
          END IF;
        ELSE
          IF NEW.tx_currency_code IS DISTINCT FROM OLD.tx_currency_code AND NEW.currency IS NOT DISTINCT FROM OLD.currency THEN
            NEW.currency := NEW.tx_currency_code;
          ELSIF NEW.currency IS DISTINCT FROM OLD.currency AND NEW.tx_currency_code IS NOT DISTINCT FROM OLD.tx_currency_code THEN
            NEW.tx_currency_code := NEW.currency;
          END IF;
        END IF;

        IF NEW.fx_rate_applied IS NULL THEN
          NEW.fx_rate_applied := COALESCE(NEW.fx_rate, 1.0);
        END IF;
        IF TG_OP = 'INSERT' THEN
          IF (NEW.fx_rate IS NULL OR NEW.fx_rate = 1) AND NEW.fx_rate_applied IS NOT NULL AND NEW.fx_rate_applied <> 1 THEN
            NEW.fx_rate := NEW.fx_rate_applied;
          ELSIF NEW.fx_rate IS NULL THEN
            NEW.fx_rate := NEW.fx_rate_applied;
          END IF;
        ELSE
          IF NEW.fx_rate_applied IS DISTINCT FROM OLD.fx_rate_applied AND NEW.fx_rate IS NOT DISTINCT FROM OLD.fx_rate THEN
            NEW.fx_rate := NEW.fx_rate_applied;
          ELSIF NEW.fx_rate IS DISTINCT FROM OLD.fx_rate AND NEW.fx_rate_applied IS NOT DISTINCT FROM OLD.fx_rate_applied THEN
            NEW.fx_rate_applied := NEW.fx_rate;
          END IF;
        END IF;

        IF NEW.is_rounding IS NULL THEN
          NEW.is_rounding := false;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await q.query(`
      DROP TRIGGER IF EXISTS "TRG_fin_journal_entry_lines_dual_sync" ON "${this.tableLines}"
    `);
    await q.query(`
      CREATE TRIGGER "TRG_fin_journal_entry_lines_dual_sync"
        BEFORE INSERT OR UPDATE ON "${this.tableLines}"
        FOR EACH ROW EXECUTE FUNCTION fin_sync_journal_entry_line_dual_amounts()
    `);

    // 4. Create fx_rates table
    await q.query(`
      CREATE TABLE IF NOT EXISTS "${this.tableFxRates}" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "base_currency" varchar(8) NOT NULL,
        "quote_currency" varchar(8) NOT NULL,
        "rate_date" date NOT NULL,
        "rate_type" varchar(20) NOT NULL,
        "rate" numeric(24, 6) NOT NULL,
        "source" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fx_rates" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fx_rates_rate_type" CHECK ("rate_type" IN ('SPOT', 'TAX_OFFICIAL', 'CLOSING')),
        CONSTRAINT "CHK_fx_rates_rate_positive" CHECK ("rate" > 0),
        CONSTRAINT "UQ_fx_rates_tenant_pair_date_type" UNIQUE ("tenant_id", "base_currency", "quote_currency", "rate_date", "rate_type")
      )
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fx_rates_tenant_lookup"
        ON "${this.tableFxRates}" ("tenant_id", "base_currency", "quote_currency", "rate_date")
    `);

    // 5. Enable and force RLS on fx_rates
    await enableTenantRls(q, this.tableFxRates);

    // 6. Grant to roxira_app role if present
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roxira_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${this.tableFxRates}" TO roxira_app;
        END IF;
      END $$;
    `);

    // 7. Update balance trigger fin_assert_entry_consistent
    await q.query(`
      CREATE OR REPLACE FUNCTION fin_assert_entry_consistent() RETURNS trigger AS $$
      DECLARE
        book_diff numeric;
        tx_diff numeric;
        tx_curr_count integer;
        bad integer;
        entry_status text;
        target_entry_id integer;
      BEGIN
        target_entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
        IF TG_OP <> 'DELETE' THEN
          IF NEW.id <> (SELECT max(id) FROM fin_journal_entry_lines WHERE journal_entry_id = target_entry_id) THEN
            RETURN NULL;
          END IF;
        END IF;

        SELECT status INTO entry_status FROM fin_journal_entries WHERE id = target_entry_id;
        IF entry_status IS DISTINCT FROM 'DRAFT' THEN
          -- 1. Check book currency balance (SUM(book_debit) == SUM(book_credit))
          SELECT COALESCE(SUM(COALESCE(book_debit, debit, 0)), 0) - COALESCE(SUM(COALESCE(book_credit, credit, 0)), 0)
            INTO book_diff
            FROM fin_journal_entry_lines
           WHERE journal_entry_id = target_entry_id;

          IF book_diff <> 0 THEN
            RAISE EXCEPTION 'journal entry % is not balanced in book currency (debit - credit = %)', target_entry_id, book_diff
              USING ERRCODE = 'RX004';
          END IF;

          -- 2. Check transaction currency balance when entry has a single transaction currency
          -- Non-rounding lines must share single currency to check tx balance
          SELECT COUNT(DISTINCT COALESCE(tx_currency_code, currency, 'IRR'))
            INTO tx_curr_count
            FROM fin_journal_entry_lines
           WHERE journal_entry_id = target_entry_id
             AND (is_rounding IS NOT TRUE);

          IF tx_curr_count = 1 THEN
            SELECT COALESCE(SUM(COALESCE(tx_debit, debit, 0)), 0) - COALESCE(SUM(COALESCE(tx_credit, credit, 0)), 0)
              INTO tx_diff
              FROM fin_journal_entry_lines
             WHERE journal_entry_id = target_entry_id
               AND (is_rounding IS NOT TRUE);

            IF tx_diff <> 0 THEN
              RAISE EXCEPTION 'journal entry % is not balanced in transaction currency (debit - credit = %)', target_entry_id, tx_diff
                USING ERRCODE = 'RX004';
            END IF;
          END IF;
        END IF;

        SELECT count(*) INTO bad
          FROM fin_journal_entry_lines l
          JOIN fin_journal_entries e ON e.id = l.journal_entry_id
          JOIN fin_chart_of_accounts a ON a.id = l.account_id
         WHERE l.journal_entry_id = target_entry_id
           AND (l.tenant_id <> e.tenant_id OR l.tenant_id <> a.tenant_id);
        IF bad > 0 THEN
          RAISE EXCEPTION 'journal entry % mixes tenants', target_entry_id
            USING ERRCODE = 'RX005';
        END IF;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);

    // 8. Update fin_guard_voucher_transition
    await q.query(`
      CREATE OR REPLACE FUNCTION fin_guard_voucher_transition() RETURNS trigger AS $$
      DECLARE
        book_diff numeric;
        tx_diff numeric;
        tx_curr_count integer;
        line_count integer;
      BEGIN
        IF OLD.status = 'DRAFT' AND NEW.status <> 'DRAFT' AND NEW.status <> 'VOID' THEN
          SELECT COALESCE(SUM(COALESCE(book_debit, debit, 0)), 0) - COALESCE(SUM(COALESCE(book_credit, credit, 0)), 0), count(*)
            INTO book_diff, line_count
            FROM fin_journal_entry_lines WHERE journal_entry_id = OLD.id;

          IF line_count < 2 OR book_diff <> 0 THEN
            RAISE EXCEPTION 'journal entry % cannot leave DRAFT unless it has two or more lines and balances', OLD.id
              USING ERRCODE = 'RX004';
          END IF;

          -- Check single transaction currency balance
          SELECT COUNT(DISTINCT COALESCE(tx_currency_code, currency, 'IRR'))
            INTO tx_curr_count
            FROM fin_journal_entry_lines
           WHERE journal_entry_id = OLD.id
             AND (is_rounding IS NOT TRUE);

          IF tx_curr_count = 1 THEN
            SELECT COALESCE(SUM(COALESCE(tx_debit, debit, 0)), 0) - COALESCE(SUM(COALESCE(tx_credit, credit, 0)), 0)
              INTO tx_diff
              FROM fin_journal_entry_lines
             WHERE journal_entry_id = OLD.id
               AND (is_rounding IS NOT TRUE);

            IF tx_diff <> 0 THEN
              RAISE EXCEPTION 'journal entry % is not balanced in transaction currency (debit - credit = %)', OLD.id, tx_diff
                USING ERRCODE = 'RX004';
            END IF;
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
  }

  public async down(q: QueryRunner): Promise<void> {
    // Revert fin_guard_voucher_transition
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

    // Revert fin_assert_entry_consistent
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

    // Drop sync trigger
    await q.query(`
      DROP TRIGGER IF EXISTS "TRG_fin_journal_entry_lines_dual_sync" ON "${this.tableLines}"
    `);
    await q.query(`
      DROP FUNCTION IF EXISTS fin_sync_journal_entry_line_dual_amounts()
    `);

    // Drop fx_rates table and RLS
    await disableTenantRls(q, this.tableFxRates);
    await q.query(`DROP TABLE IF EXISTS "${this.tableFxRates}"`);

    // Drop dual-amount columns
    await q.query(`
      ALTER TABLE "${this.tableLines}"
        DROP COLUMN IF EXISTS "is_rounding",
        DROP COLUMN IF EXISTS "book_credit",
        DROP COLUMN IF EXISTS "book_debit",
        DROP COLUMN IF EXISTS "tx_credit",
        DROP COLUMN IF EXISTS "tx_debit",
        DROP COLUMN IF EXISTS "fx_rate_applied",
        DROP COLUMN IF EXISTS "tx_currency_code"
    `);
  }
}
