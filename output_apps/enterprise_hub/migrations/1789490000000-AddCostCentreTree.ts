import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cost centres form a tree (E3.2): a cost centre may sit under another cost centre of the same
 * organisation, so the trial balance by cost centre can roll a department up into its division.
 * The parent link is a composite (tenant_id, parent_id) foreign key, so a centre can never hang under
 * another organisation's centre; a CHECK keeps the link to cost centres only and off the row itself.
 * Deeper cycles are refused by the service (a parent must exist before its child is created).
 *
 * Revert: `down()` drops the column; the tree is lost, centres and line tags stay.
 */
export class AddCostCentreTree1789490000000 implements MigrationInterface {
  name = 'AddCostCentreTree1789490000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "fin_dimensions" ADD COLUMN "parent_id" integer`);
    await q.query(`
      ALTER TABLE "fin_dimensions"
        ADD CONSTRAINT "FK_fin_dimensions_parent"
        FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "fin_dimensions" ("tenant_id", "id")
        ON DELETE RESTRICT`);
    await q.query(`
      ALTER TABLE "fin_dimensions"
        ADD CONSTRAINT "CHK_fin_dimensions_parent"
        CHECK ("parent_id" IS NULL OR ("kind" = 'COST_CENTER' AND "parent_id" <> "id"))`);
    await q.query(
      `CREATE INDEX "IDX_fin_dimensions_parent" ON "fin_dimensions" ("tenant_id", "parent_id") WHERE "parent_id" IS NOT NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "IDX_fin_dimensions_parent"`);
    await q.query(`ALTER TABLE "fin_dimensions" DROP CONSTRAINT "CHK_fin_dimensions_parent"`);
    await q.query(`ALTER TABLE "fin_dimensions" DROP CONSTRAINT "FK_fin_dimensions_parent"`);
    await q.query(`ALTER TABLE "fin_dimensions" DROP COLUMN "parent_id"`);
  }
}
