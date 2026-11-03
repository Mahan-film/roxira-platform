import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fixed asset register and monthly depreciation. An asset names its three ledger accounts
 * (asset, accumulated depreciation, depreciation expense); a depreciation line ties one asset-month
 * to the journal entry that booked it, and the unique key makes a month impossible to charge twice.
 * Both tables carry forced tenant RLS as a second wall behind the repository.
 *
 * Revert: `down()` drops both tables; the journal entries already posted stay in the ledger.
 */
export class CreateFixedAssets1789450000000 implements MigrationInterface {
  name = 'CreateFixedAssets1789450000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "fin_fixed_assets" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "name" character varying(128) NOT NULL,
        "category" character varying(32) NOT NULL,
        "acquisition_date" date NOT NULL,
        "cost" numeric(18,2) NOT NULL,
        "salvage_value" numeric(18,2) NOT NULL DEFAULT 0,
        "method" character varying(20) NOT NULL,
        "life_months" integer,
        "annual_rate" numeric(8,6),
        "rate_source" text,
        "rate_verified" boolean NOT NULL DEFAULT false,
        "asset_account_code" character varying(32) NOT NULL,
        "accumulated_account_code" character varying(32) NOT NULL,
        "expense_account_code" character varying(32) NOT NULL,
        "accumulated_depreciation" numeric(18,2) NOT NULL DEFAULT 0,
        "months_depreciated" integer NOT NULL DEFAULT 0,
        "next_period_index" integer NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'ACTIVE',
        "created_by" character varying(64) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_fin_fixed_assets_method" CHECK ("method" IN ('STRAIGHT_LINE','DECLINING_BALANCE')),
        CONSTRAINT "CHK_fin_fixed_assets_status" CHECK ("status" IN ('ACTIVE','FULLY_DEPRECIATED','DISPOSED')),
        CONSTRAINT "CHK_fin_fixed_assets_cost" CHECK ("cost" > 0 AND "salvage_value" >= 0 AND "salvage_value" < "cost"),
        CONSTRAINT "CHK_fin_fixed_assets_accumulated" CHECK ("accumulated_depreciation" >= 0 AND "accumulated_depreciation" <= "cost" - "salvage_value"),
        CONSTRAINT "CHK_fin_fixed_assets_terms" CHECK (
          ("method" = 'STRAIGHT_LINE' AND "life_months" IS NOT NULL AND "life_months" > 0)
          OR ("method" = 'DECLINING_BALANCE' AND "annual_rate" IS NOT NULL AND "annual_rate" > 0 AND "annual_rate" <= 1))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_fin_fixed_assets_tenant_code" ON "fin_fixed_assets" ("tenant_id", "code")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_fin_fixed_assets_tenant_id" ON "fin_fixed_assets" ("tenant_id", "id")`);
    await q.query(`
      CREATE TABLE "fin_depreciation_lines" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "asset_id" integer NOT NULL,
        "period_year" integer NOT NULL,
        "period_month" integer NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "journal_entry_id" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_fin_depreciation_lines_month" CHECK ("period_month" BETWEEN 1 AND 12),
        CONSTRAINT "CHK_fin_depreciation_lines_amount" CHECK ("amount" > 0),
        CONSTRAINT "FK_fin_depreciation_lines_asset" FOREIGN KEY ("tenant_id", "asset_id")
          REFERENCES "fin_fixed_assets" ("tenant_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "FK_fin_depreciation_lines_entry" FOREIGN KEY ("journal_entry_id")
          REFERENCES "fin_journal_entries" ("id") ON DELETE RESTRICT
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_fin_depreciation_lines_month" ON "fin_depreciation_lines" ("tenant_id", "asset_id", "period_year", "period_month")`,
    );
    const tenantMatch = `"tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid`;
    for (const table of ['fin_fixed_assets', 'fin_depreciation_lines']) {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await q.query(`CREATE POLICY "${table}_tenant" ON "${table}" USING (${tenantMatch}) WITH CHECK (${tenantMatch})`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "fin_depreciation_lines"`);
    await q.query(`DROP TABLE "fin_fixed_assets"`);
  }
}
