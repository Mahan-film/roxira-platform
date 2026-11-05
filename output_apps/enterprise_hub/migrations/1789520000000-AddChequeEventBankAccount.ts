import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CHK-01 follow-up: remember which bank account a cheque clearing / partial payment posted its
 * bank-side line to. Null means the legacy default (1010), so old events keep reconciling as before.
 *
 * Purely additive on `fin_cheque_events`, which already has FORCE RLS (1789430000000), so no new
 * policy is needed. Reversible: down() drops the column.
 */
export class AddChequeEventBankAccount1789520000000 implements MigrationInterface {
  name = 'AddChequeEventBankAccount1789520000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "fin_cheque_events"
      ADD COLUMN IF NOT EXISTS "bank_account_id" integer`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "fin_cheque_events" DROP COLUMN IF EXISTS "bank_account_id"`);
  }
}
