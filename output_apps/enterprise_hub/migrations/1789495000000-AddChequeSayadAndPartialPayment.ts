import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CHK-01: Sayad fields (declared registration status, who/when verified, receiver national id),
 * endorsement details, partial-payment tracking and the issued-cheque `delivered` status.
 *
 * Purely additive on existing tenant tables (`fin_cheques`, `fin_cheque_events`), which already have
 * FORCE RLS (1789430000000), so no new policy is needed. The status CHECK is replaced to admit
 * 'delivered'. Reversible.
 */
export class AddChequeSayadAndPartialPayment1789495000000 implements MigrationInterface {
  name = 'AddChequeSayadAndPartialPayment1789495000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "fin_cheques"
      ADD COLUMN IF NOT EXISTS "sayad_registration_status" character varying(16) NOT NULL DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS "sayad_verified_by" character varying(128),
      ADD COLUMN IF NOT EXISTS "sayad_verified_at" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "receiver_national_id" character varying(11),
      ADD COLUMN IF NOT EXISTS "spent_to_code" character varying(64),
      ADD COLUMN IF NOT EXISTS "spent_to_national_id" character varying(11),
      ADD COLUMN IF NOT EXISTS "settled_amount" numeric(18,2) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "fin_cheque_events" ADD COLUMN IF NOT EXISTS "amount" numeric(18,2)`);
    // Existing verified rows have no recorded verifier; keep them verified and mark the source.
    await q.query(`UPDATE "fin_cheques" SET "sayad_verified_by" = 'legacy', "sayad_verified_at" = "updated_at"
      WHERE "sayad_verified" = true AND "sayad_verified_by" IS NULL`);
    await q.query(`ALTER TABLE "fin_cheques" DROP CONSTRAINT IF EXISTS "CHK_fin_cheques_status"`);
    await q.query(`ALTER TABLE "fin_cheques" ADD CONSTRAINT "CHK_fin_cheques_status"
      CHECK ("status" IN ('registered','delivered','deposited','cleared','bounced','returned','spent'))`);
    await q.query(`ALTER TABLE "fin_cheques" ADD CONSTRAINT "CHK_fin_cheques_sayad_registration"
      CHECK ("sayad_registration_status" IN ('unknown','registered','unregistered'))`);
    await q.query(`ALTER TABLE "fin_cheques" ADD CONSTRAINT "CHK_fin_cheques_national_ids"
      CHECK (("receiver_national_id" IS NULL OR "receiver_national_id" ~ '^([0-9]{10}|[0-9]{11})$')
         AND ("spent_to_national_id" IS NULL OR "spent_to_national_id" ~ '^([0-9]{10}|[0-9]{11})$'))`);
    await q.query(`ALTER TABLE "fin_cheques" ADD CONSTRAINT "CHK_fin_cheques_settled"
      CHECK ("settled_amount" >= 0 AND "settled_amount" <= "amount")`);
    await q.query(`ALTER TABLE "fin_cheques" ADD CONSTRAINT "CHK_fin_cheques_verified_audit"
      CHECK ("sayad_verified" = false OR ("sayad_verified_by" IS NOT NULL AND "sayad_verified_at" IS NOT NULL))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE "fin_cheques" SET "status" = 'registered' WHERE "status" = 'delivered'`);
    await q.query(`ALTER TABLE "fin_cheques" DROP CONSTRAINT IF EXISTS "CHK_fin_cheques_verified_audit"`);
    await q.query(`ALTER TABLE "fin_cheques" DROP CONSTRAINT IF EXISTS "CHK_fin_cheques_settled"`);
    await q.query(`ALTER TABLE "fin_cheques" DROP CONSTRAINT IF EXISTS "CHK_fin_cheques_national_ids"`);
    await q.query(`ALTER TABLE "fin_cheques" DROP CONSTRAINT IF EXISTS "CHK_fin_cheques_sayad_registration"`);
    await q.query(`ALTER TABLE "fin_cheques" DROP CONSTRAINT IF EXISTS "CHK_fin_cheques_status"`);
    await q.query(`ALTER TABLE "fin_cheques" ADD CONSTRAINT "CHK_fin_cheques_status"
      CHECK ("status" IN ('registered','deposited','cleared','bounced','returned','spent'))`);
    await q.query(`ALTER TABLE "fin_cheque_events" DROP COLUMN IF EXISTS "amount"`);
    await q.query(`ALTER TABLE "fin_cheques"
      DROP COLUMN IF EXISTS "settled_amount", DROP COLUMN IF EXISTS "spent_to_national_id",
      DROP COLUMN IF EXISTS "spent_to_code", DROP COLUMN IF EXISTS "receiver_national_id",
      DROP COLUMN IF EXISTS "sayad_verified_at", DROP COLUMN IF EXISTS "sayad_verified_by",
      DROP COLUMN IF EXISTS "sayad_registration_status"`);
  }
}
