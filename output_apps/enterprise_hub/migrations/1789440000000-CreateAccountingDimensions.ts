import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Analysis dimensions on journal lines: floating detail accounts (tafsili shenavar), cost centres
 * and project centres. They live in one table, told apart by `kind`, and a line points at up to
 * one of each through composite (tenant_id, id) foreign keys, so a line can never reference
 * another organisation's dimension. The table carries forced tenant RLS as a second wall behind
 * the repository. Existing lines keep all three columns NULL.
 *
 * Revert: `down()` drops the three line columns and the table; dimension tags on lines are lost.
 */
export class CreateAccountingDimensions1789440000000 implements MigrationInterface {
  name = 'CreateAccountingDimensions1789440000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "fin_dimensions" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "kind" character varying(12) NOT NULL,
        "code" character varying(32) NOT NULL,
        "name" character varying(128) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_fin_dimensions_kind" CHECK ("kind" IN ('DETAIL','COST_CENTER','PROJECT'))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_fin_dimensions_tenant_kind_code" ON "fin_dimensions" ("tenant_id", "kind", "code")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_fin_dimensions_tenant_id" ON "fin_dimensions" ("tenant_id", "id")`);
    const tenantMatch = `"tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid`;
    await q.query(`ALTER TABLE "fin_dimensions" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "fin_dimensions" FORCE ROW LEVEL SECURITY`);
    await q.query(`CREATE POLICY "fin_dimensions_tenant" ON "fin_dimensions" USING (${tenantMatch}) WITH CHECK (${tenantMatch})`);

    for (const [column, name] of [
      ['detail_id', 'detail'],
      ['cost_center_id', 'cost_center'],
      ['project_id', 'project'],
    ]) {
      await q.query(`ALTER TABLE "fin_journal_entry_lines" ADD COLUMN "${column}" integer`);
      await q.query(`
        ALTER TABLE "fin_journal_entry_lines"
          ADD CONSTRAINT "FK_fin_journal_entry_lines_${name}"
          FOREIGN KEY ("tenant_id", "${column}") REFERENCES "fin_dimensions" ("tenant_id", "id")
          ON DELETE RESTRICT`);
      await q.query(
        `CREATE INDEX "IDX_fin_journal_entry_lines_${name}" ON "fin_journal_entry_lines" ("tenant_id", "${column}") WHERE "${column}" IS NOT NULL`,
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const column of ['detail_id', 'cost_center_id', 'project_id']) {
      await q.query(`ALTER TABLE "fin_journal_entry_lines" DROP COLUMN "${column}"`);
    }
    await q.query(`DROP TABLE "fin_dimensions"`);
  }
}
