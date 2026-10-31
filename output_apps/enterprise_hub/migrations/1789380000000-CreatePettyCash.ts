import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Petty cash (tankhah): funds with a custodian, and their charges, expenses and returns. A fund's
 * balance is never stored here: it is its ledger account. Both tables carry tenant RLS as a second
 * wall behind the repository.
 */
export class CreatePettyCash1789380000000 implements MigrationInterface {
  name = 'CreatePettyCash1789380000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "fin_petty_cash_funds" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "name" character varying(128) NOT NULL,
        "custodian_name" character varying(128) NOT NULL,
        "custodian_user_id" uuid,
        "ledger_account_id" integer NOT NULL,
        "imprest_amount" numeric(18,2) NOT NULL,
        "status" character varying(8) NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_fin_petty_cash_funds_status" CHECK ("status" IN ('ACTIVE','CLOSED')),
        CONSTRAINT "CHK_fin_petty_cash_funds_imprest" CHECK ("imprest_amount" > 0),
        CONSTRAINT "FK_fin_petty_cash_funds_account" FOREIGN KEY ("ledger_account_id")
          REFERENCES "fin_chart_of_accounts"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_fin_petty_cash_funds_tenant_name" ON "fin_petty_cash_funds" ("tenant_id", "name")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_fin_petty_cash_funds_tenant_account" ON "fin_petty_cash_funds" ("tenant_id", "ledger_account_id")`);
    await q.query(`
      CREATE TABLE "fin_petty_cash_transactions" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "fund_id" integer NOT NULL,
        "kind" character varying(8) NOT NULL,
        "status" character varying(8) NOT NULL,
        "date" date NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "account_code" character varying(32) NOT NULL,
        "description" text NOT NULL,
        "receipt_number" character varying(64),
        "journal_entry_id" integer,
        "created_by" character varying(64) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_fin_petty_cash_tx_kind" CHECK ("kind" IN ('CHARGE','RETURN','EXPENSE')),
        CONSTRAINT "CHK_fin_petty_cash_tx_status" CHECK ("status" IN ('PENDING','SETTLED','POSTED','VOID')),
        CONSTRAINT "CHK_fin_petty_cash_tx_amount" CHECK ("amount" > 0),
        CONSTRAINT "FK_fin_petty_cash_tx_fund" FOREIGN KEY ("fund_id")
          REFERENCES "fin_petty_cash_funds"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_fin_petty_cash_tx_entry" FOREIGN KEY ("journal_entry_id")
          REFERENCES "fin_journal_entries"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE INDEX "IDX_fin_petty_cash_tx_tenant_fund" ON "fin_petty_cash_transactions" ("tenant_id", "fund_id", "date")`);
    const tenantMatch = `"tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid`;
    for (const table of ['fin_petty_cash_funds', 'fin_petty_cash_transactions']) {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await q.query(`CREATE POLICY "${table}_tenant" ON "${table}" USING (${tenantMatch}) WITH CHECK (${tenantMatch})`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "fin_petty_cash_transactions"`);
    await q.query(`DROP TABLE "fin_petty_cash_funds"`);
  }
}
