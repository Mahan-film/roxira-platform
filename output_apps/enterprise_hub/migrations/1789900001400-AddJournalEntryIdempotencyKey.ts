import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `idempotency_key` to `fin_journal_entries` (#555 / T3 in #592 MASTER QUEUE):
 *   - Allows clients to provide an idempotency key (via DTO or Idempotency-Key HTTP header)
 *     on manual voucher creation.
 *   - A retried POST returns the same voucher rather than duplicating postings or failing with 500.
 *   - `idempotency_fingerprint` (sha256 of the normalised request body) lets a replay with the same
 *     key but a different body be refused with 409 instead of silently returning the old voucher.
 *   - Scoped per tenant with partial unique index `UQ_fin_journal_entries_tenant_idempotency`.
 *
 * Purely additive. Reversible `down()`.
 */
export class AddJournalEntryIdempotencyKey1789900001400 implements MigrationInterface {
  name = 'AddJournalEntryIdempotencyKey1789900001400';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "fin_journal_entries"
        ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(128) NULL,
        ADD COLUMN IF NOT EXISTS "idempotency_fingerprint" varchar(64) NULL
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_journal_entries_tenant_idempotency"
        ON "fin_journal_entries" ("tenant_id", "idempotency_key")
        WHERE "idempotency_key" IS NOT NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP INDEX IF EXISTS "UQ_fin_journal_entries_tenant_idempotency"
    `);
    await q.query(`
      ALTER TABLE "fin_journal_entries"
        DROP COLUMN IF EXISTS "idempotency_fingerprint",
        DROP COLUMN IF EXISTS "idempotency_key"
    `);
  }
}
