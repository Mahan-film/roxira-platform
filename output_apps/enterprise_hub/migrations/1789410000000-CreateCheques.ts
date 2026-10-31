import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cheque register (received and issued) and its append-only event history.
 *
 * Both tables carry `tenant_id`; the repository scopes every query by it
 * (AGENTS.md §4). The Sayad number is unique per tenant when present. Purely
 * additive and runs inside the default migration transaction.
 *
 * - `fin_cheque_events.cheque_id` -> cheque (RESTRICT: history is never cascaded away).
 * - `fin_cheque_events.journal_entry_id` -> journal entry (SET NULL if an entry is deleted).
 */
export class CreateCheques1789410000000 implements MigrationInterface {
  name = 'CreateCheques1789410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "fin_cheques" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "direction" character varying(16) NOT NULL,
        "sayad_number" character varying(16),
        "sayad_verified" boolean NOT NULL DEFAULT false,
        "cheque_number" character varying(32) NOT NULL,
        "bank_name" character varying(64),
        "amount" numeric(18,2) NOT NULL,
        "issue_date" date NOT NULL,
        "due_date" date NOT NULL,
        "party_name" character varying(128) NOT NULL,
        "party_code" character varying(64),
        "spent_to_name" character varying(128),
        "status" character varying(16) NOT NULL DEFAULT 'registered',
        "description" character varying(512),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_fin_cheques_direction" CHECK ("direction" IN ('received','issued')),
        CONSTRAINT "CHK_fin_cheques_status" CHECK ("status" IN ('registered','deposited','cleared','bounced','returned','spent')),
        CONSTRAINT "CHK_fin_cheques_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_fin_cheques_sayad" CHECK ("sayad_number" IS NULL OR "sayad_number" ~ '^[0-9]{16}$')
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_cheques_tenant_sayad" ON "fin_cheques" ("tenant_id", "sayad_number") WHERE "sayad_number" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_cheques_tenant_due" ON "fin_cheques" ("tenant_id", "status", "due_date")`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "fin_cheque_events" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "cheque_id" integer NOT NULL,
        "from_status" character varying(16),
        "to_status" character varying(16) NOT NULL,
        "event_date" date NOT NULL,
        "journal_entry_id" integer,
        "note" character varying(512),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_fin_cheque_events_cheque" FOREIGN KEY ("cheque_id")
          REFERENCES "fin_cheques"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_fin_cheque_events_journal_entry" FOREIGN KEY ("journal_entry_id")
          REFERENCES "fin_journal_entries"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_cheque_events_tenant_cheque" ON "fin_cheque_events" ("tenant_id", "cheque_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "fin_cheque_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fin_cheques"`);
  }
}
