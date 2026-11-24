import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T181 Dimensions v2:
 * 1. Allow extensible dimension kinds on fin_dimensions (beyond DETAIL, COST_CENTER, PROJECT).
 * 2. Add JSONB dimensions column on fin_journal_entry_lines for multi-dimension tagging.
 * 3. Create fin_dimension_rules table for required-dimension rules with FORCE RLS.
 * 4. Create fin_dimension_label_history table for effective-dated dimension renaming with FORCE RLS.
 */
export class CreateDimensionsV21789900038000 implements MigrationInterface {
  name = 'CreateDimensionsV21789900038000';

  public async up(q: QueryRunner): Promise<void> {
    const tenantMatch = `"tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid`;

    // 1. Expand fin_dimensions kind constraint
    await q.query(`ALTER TABLE "fin_dimensions" DROP CONSTRAINT IF EXISTS "CHK_fin_dimensions_kind"`);
    await q.query(
      `ALTER TABLE "fin_dimensions" ADD CONSTRAINT "CHK_fin_dimensions_kind" CHECK ("kind" ~ '^[A-Z0-9_]{2,32}$')`,
    );

    // 2. Add dynamic dimensions column to journal entry lines
    await q.query(
      `ALTER TABLE "fin_journal_entry_lines" ADD COLUMN IF NOT EXISTS "dimensions" jsonb NOT NULL DEFAULT '{}'::jsonb`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_journal_entry_lines_dimensions" ON "fin_journal_entry_lines" USING gin ("dimensions")`,
    );

    // 3. Create dimension rules table
    await q.query(`
      CREATE TABLE IF NOT EXISTS "fin_dimension_rules" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "name" character varying(128) NOT NULL,
        "account_type" character varying(32),
        "account_code" character varying(32),
        "when_dimension_kind" character varying(32),
        "when_dimension_code" character varying(32),
        "requires_dimension_kind" character varying(32) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_dimension_rules_tenant" ON "fin_dimension_rules" ("tenant_id", "active")`,
    );
    await q.query(`ALTER TABLE "fin_dimension_rules" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "fin_dimension_rules" FORCE ROW LEVEL SECURITY`);
    await q.query(
      `CREATE POLICY "fin_dimension_rules_tenant" ON "fin_dimension_rules" USING (${tenantMatch}) WITH CHECK (${tenantMatch})`,
    );

    // 4. Create dimension label history table
    await q.query(`
      CREATE TABLE IF NOT EXISTS "fin_dimension_label_history" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "dimension_id" integer NOT NULL,
        "code" character varying(32) NOT NULL,
        "name" character varying(128) NOT NULL,
        "effective_from" date NOT NULL,
        "effective_to" date,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "FK_fin_dim_label_history_dimension"
          FOREIGN KEY ("tenant_id", "dimension_id")
          REFERENCES "fin_dimensions" ("tenant_id", "id") ON DELETE CASCADE
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_dim_labels_lookup" ON "fin_dimension_label_history" ("tenant_id", "dimension_id", "effective_from", "effective_to")`,
    );
    await q.query(`ALTER TABLE "fin_dimension_label_history" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "fin_dimension_label_history" FORCE ROW LEVEL SECURITY`);
    await q.query(
      `CREATE POLICY "fin_dimension_label_history_tenant" ON "fin_dimension_label_history" USING (${tenantMatch}) WITH CHECK (${tenantMatch})`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    const [{ count: newKindCount }] = (await q.query(
      `SELECT count(*)::int AS count FROM "fin_dimensions" WHERE "kind" NOT IN ('DETAIL','COST_CENTER','PROJECT')`,
    )) as Array<{ count: number }>;
    if (newKindCount > 0) {
      throw new Error(
        `Cannot revert CreateDimensionsV2: ${newKindCount} fin_dimensions rows use v2 kinds. Migrate or remove them before rollback.`,
      );
    }

    await q.query(`DROP POLICY IF EXISTS "fin_dimension_label_history_tenant" ON "fin_dimension_label_history"`);
    await q.query(`DROP TABLE IF EXISTS "fin_dimension_label_history"`);

    await q.query(`DROP POLICY IF EXISTS "fin_dimension_rules_tenant" ON "fin_dimension_rules"`);
    await q.query(`DROP TABLE IF EXISTS "fin_dimension_rules"`);

    await q.query(`DROP INDEX IF EXISTS "IDX_fin_journal_entry_lines_dimensions"`);
    await q.query(`ALTER TABLE "fin_journal_entry_lines" DROP COLUMN IF EXISTS "dimensions"`);

    await q.query(`ALTER TABLE "fin_dimensions" DROP CONSTRAINT IF EXISTS "CHK_fin_dimensions_kind"`);
    await q.query(
      `ALTER TABLE "fin_dimensions" ADD CONSTRAINT "CHK_fin_dimensions_kind" CHECK ("kind" IN ('DETAIL','COST_CENTER','PROJECT'))`,
    );
  }
}
