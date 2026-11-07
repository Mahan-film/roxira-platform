import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Optimistic edit lock for vouchers. Every content or status update of a non-final voucher
 * increments `version`, and an update may require the version it read (`expectedVersion`): the
 * UPDATE carries `WHERE ... AND version = expected` and touches zero rows when another user
 * saved first, which the service maps to 409. Existing rows start at 1.
 *
 * Purely additive: the ledger RLS policy and the triggers are untouched. A POSTED row is still
 * immutable at the database level (any UPDATE is refused), so its version only moves while the
 * voucher is a draft or temporary.
 */
export class AddJournalEntryVersion1789900000000 implements MigrationInterface {
  name = 'AddJournalEntryVersion1789900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "fin_journal_entries"
        ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "fin_journal_entries" DROP COLUMN IF EXISTS "version"`,
    );
  }
}
