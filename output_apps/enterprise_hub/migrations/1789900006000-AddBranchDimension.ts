import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Task T122: Add branch dimension across financial and operational modules.
 * Adds nullable `branch_id` to invoices, POS sales (settlements), journal entry lines, and employees,
 * indexed on (tenant_id, branch_id), with backfill to each tenant's default branch in tenant_branches.
 */
export class AddBranchDimension1789900006000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ensure every existing tenant has at least one default branch in tenant_branches
    await queryRunner.query(`
      INSERT INTO "tenant_branches" ("id", "tenant_id", "name", "code", "created_at")
      SELECT gen_random_uuid(), t."id", 'شعبه مرکزی', 'MAIN', NOW()
      FROM "tenants" t
      WHERE NOT EXISTS (
        SELECT 1 FROM "tenant_branches" b WHERE b."tenant_id" = t."id"
      );
    `);

    // 2. Add branch_id to "invoices"
    await queryRunner.query(`
      ALTER TABLE "invoices"
      ADD COLUMN IF NOT EXISTS "branch_id" uuid NULL,
      ADD CONSTRAINT "FK_invoices_branch"
        FOREIGN KEY ("branch_id") REFERENCES "tenant_branches"("id") ON DELETE SET NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_invoices_tenant_branch"
        ON "invoices" ("tenant_id", "branch_id");
    `);

    // 3. Add branch_id to "fin_pos_settlements"
    await queryRunner.query(`
      ALTER TABLE "fin_pos_settlements"
      ADD COLUMN IF NOT EXISTS "branch_id" uuid NULL,
      ADD CONSTRAINT "FK_fin_pos_settlements_branch"
        FOREIGN KEY ("branch_id") REFERENCES "tenant_branches"("id") ON DELETE SET NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_pos_settlements_tenant_branch"
        ON "fin_pos_settlements" ("tenant_id", "branch_id");
    `);

    // 4. Add branch_id to "fin_journal_entry_lines"
    await queryRunner.query(`
      ALTER TABLE "fin_journal_entry_lines"
      ADD COLUMN IF NOT EXISTS "branch_id" uuid NULL,
      ADD CONSTRAINT "FK_fin_journal_entry_lines_branch"
        FOREIGN KEY ("branch_id") REFERENCES "tenant_branches"("id") ON DELETE SET NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_journal_entry_lines_tenant_branch"
        ON "fin_journal_entry_lines" ("tenant_id", "branch_id");
    `);

    // 5. Add branch_id to "hr_employees"
    await queryRunner.query(`
      ALTER TABLE "hr_employees"
      ADD COLUMN IF NOT EXISTS "branch_id" uuid NULL,
      ADD CONSTRAINT "FK_hr_employees_branch"
        FOREIGN KEY ("branch_id") REFERENCES "tenant_branches"("id") ON DELETE SET NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_hr_employees_tenant_branch"
        ON "hr_employees" ("tenant_id", "branch_id");
    `);

    // 6. Backfill existing records to the tenant's default (earliest) branch
    await queryRunner.query(`
      UPDATE "invoices" i
      SET "branch_id" = (
        SELECT b."id" FROM "tenant_branches" b
        WHERE b."tenant_id" = i."tenant_id"
        ORDER BY b."created_at" ASC, b."id" ASC
        LIMIT 1
      )
      WHERE i."branch_id" IS NULL;
    `);

    await queryRunner.query(`
      UPDATE "fin_pos_settlements" p
      SET "branch_id" = (
        SELECT b."id" FROM "tenant_branches" b
        WHERE b."tenant_id" = p."tenant_id"
        ORDER BY b."created_at" ASC, b."id" ASC
        LIMIT 1
      )
      WHERE p."branch_id" IS NULL;
    `);

    await queryRunner.query(`
      UPDATE "fin_journal_entry_lines" l
      SET "branch_id" = (
        SELECT b."id" FROM "tenant_branches" b
        WHERE b."tenant_id" = l."tenant_id"
        ORDER BY b."created_at" ASC, b."id" ASC
        LIMIT 1
      )
      WHERE l."branch_id" IS NULL;
    `);

    await queryRunner.query(`
      UPDATE "hr_employees" e
      SET "branch_id" = (
        SELECT b."id" FROM "tenant_branches" b
        WHERE b."tenant_id" = e."tenant_id"
        ORDER BY b."created_at" ASC, b."id" ASC
        LIMIT 1
      )
      WHERE e."branch_id" IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_hr_employees_tenant_branch";`);
    await queryRunner.query(`ALTER TABLE "hr_employees" DROP CONSTRAINT IF EXISTS "FK_hr_employees_branch";`);
    await queryRunner.query(`ALTER TABLE "hr_employees" DROP COLUMN IF EXISTS "branch_id";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fin_journal_entry_lines_tenant_branch";`);
    await queryRunner.query(`ALTER TABLE "fin_journal_entry_lines" DROP CONSTRAINT IF EXISTS "FK_fin_journal_entry_lines_branch";`);
    await queryRunner.query(`ALTER TABLE "fin_journal_entry_lines" DROP COLUMN IF EXISTS "branch_id";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fin_pos_settlements_tenant_branch";`);
    await queryRunner.query(`ALTER TABLE "fin_pos_settlements" DROP CONSTRAINT IF EXISTS "FK_fin_pos_settlements_branch";`);
    await queryRunner.query(`ALTER TABLE "fin_pos_settlements" DROP COLUMN IF EXISTS "branch_id";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_invoices_tenant_branch";`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "FK_invoices_branch";`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "branch_id";`);
  }
}
