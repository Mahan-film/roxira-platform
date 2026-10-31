import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ledger hardening, part 2 of 2: `fin_chart_of_accounts.balance` double precision -> numeric(18,2),
 * the same exact type the journal lines already use.
 *
 * Lock plan (non-destructive, fail-fast):
 *  1. One transaction. `lock_timeout = 5s` so the migration gives up instead of queueing behind a
 *     long transaction and blocking every ledger read/write behind it; a failed attempt rolls back
 *     completely and can simply be re-run.
 *  2. `LOCK TABLE fin_chart_of_accounts IN ACCESS EXCLUSIVE MODE` is taken explicitly (the type
 *     change rewrites the table anyway; it holds one row per account, i.e. milliseconds) and
 *     `fin_journal_entry_lines IN SHARE MODE` freezes postings so the reconciliation below sees one
 *     consistent state. Posting is blocked only for the duration of this transaction.
 *     Run in a quiet window; a deadlock with a concurrent posting aborts the migration cleanly.
 *  3. The old value is kept in `balance_legacy_double` (nothing is dropped until a later, separate
 *     migration) and any drift is written to `fin_balance_reconciliation_log`.
 *  4. Reconciliation: balance is a cache of SUM(debit - credit) over the account's lines. Rows that
 *     drifted (float accumulation) are logged and set to the exact line sum.
 *
 * Revert: `down()` converts the column back to double precision (keeping the reconciled values) and
 * drops the legacy column and the log table. Take a dump first if the log must be kept.
 */
export class LedgerBalanceNumeric1789330000000 implements MigrationInterface {
  name = 'LedgerBalanceNumeric1789330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `LOCK TABLE "fin_chart_of_accounts" IN ACCESS EXCLUSIVE MODE`,
    );
    await queryRunner.query(
      `LOCK TABLE "fin_journal_entry_lines" IN SHARE MODE`,
    );

    await queryRunner.query(
      `ALTER TABLE "fin_chart_of_accounts" ADD COLUMN IF NOT EXISTS "balance_legacy_double" double precision`,
    );
    await queryRunner.query(
      `UPDATE "fin_chart_of_accounts" SET "balance_legacy_double" = "balance" WHERE "balance_legacy_double" IS NULL`,
    );

    await queryRunner.query(`
      ALTER TABLE "fin_chart_of_accounts"
        ALTER COLUMN "balance" DROP DEFAULT,
        ALTER COLUMN "balance" TYPE numeric(18,2) USING round("balance"::numeric, 2),
        ALTER COLUMN "balance" SET DEFAULT 0
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fin_balance_reconciliation_log" (
        "id" SERIAL NOT NULL,
        "tenant_id" uuid NOT NULL,
        "account_id" integer NOT NULL,
        "balance_before" numeric(18,2) NOT NULL,
        "balance_from_lines" numeric(18,2) NOT NULL,
        "reconciled_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fin_balance_reconciliation_log_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "fin_balance_reconciliation_log"
        ("tenant_id", "account_id", "balance_before", "balance_from_lines")
      SELECT a."tenant_id", a."id", a."balance", COALESCE(s."total", 0)
        FROM "fin_chart_of_accounts" a
        LEFT JOIN (
          SELECT "account_id", SUM("debit" - "credit") AS "total"
            FROM "fin_journal_entry_lines" GROUP BY "account_id"
        ) s ON s."account_id" = a."id"
       WHERE a."balance" <> COALESCE(s."total", 0)
    `);
    await queryRunner.query(`
      UPDATE "fin_chart_of_accounts" a
         SET "balance" = COALESCE(s."total", 0)
        FROM "fin_chart_of_accounts" b
        LEFT JOIN (
          SELECT "account_id", SUM("debit" - "credit") AS "total"
            FROM "fin_journal_entry_lines" GROUP BY "account_id"
        ) s ON s."account_id" = b."id"
       WHERE a."id" = b."id" AND a."balance" <> COALESCE(s."total", 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "fin_chart_of_accounts"
        ALTER COLUMN "balance" DROP DEFAULT,
        ALTER COLUMN "balance" TYPE double precision USING "balance"::double precision,
        ALTER COLUMN "balance" SET DEFAULT 0
    `);
    await queryRunner.query(
      `ALTER TABLE "fin_chart_of_accounts" DROP COLUMN IF EXISTS "balance_legacy_double"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "fin_balance_reconciliation_log"`,
    );
  }
}
