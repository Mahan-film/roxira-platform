import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrateLegacyChequeAccounts1789900004400 implements MigrationInterface {
  name = 'MigrateLegacyChequeAccounts1789900004400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ensure 1021 ('اسناد دریافتنی') exists for tenants having legacy 1110 named 'اسناد دریافتنی'
    await queryRunner.query(`
      INSERT INTO "fin_chart_of_accounts" ("tenant_id", "code", "name", "account_type", "level", "currency", "balance")
      SELECT DISTINCT a."tenant_id", '1021', 'اسناد دریافتنی', 'ASSET'::accounttype, 'MOEIN', 'IRR', 0
      FROM "fin_chart_of_accounts" a
      WHERE a."code" = '1110' AND a."name" = 'اسناد دریافتنی'
      ON CONFLICT ("tenant_id", "code") DO UPDATE
      SET "name" = EXCLUDED."name";
    `);

    // 2. Re-point journal entry lines from legacy 1110 ('اسناد دریافتنی') to 1021
    await queryRunner.query(`
      UPDATE "fin_journal_entry_lines" l
      SET "account_id" = target."id"
      FROM "fin_chart_of_accounts" a,
           "fin_chart_of_accounts" target
      WHERE l."account_id" = a."id"
        AND a."tenant_id" = l."tenant_id"
        AND a."code" = '1110'
        AND a."name" = 'اسناد دریافتنی'
        AND target."tenant_id" = l."tenant_id"
        AND target."code" = '1021';
    `);

    // 3. Delete legacy 1110 if it was created solely as 'اسناد دریافتنی'
    await queryRunner.query(`
      DELETE FROM "fin_chart_of_accounts"
      WHERE "code" = '1110' AND "name" = 'اسناد دریافتنی';
    `);

    // 4. Ensure 1023 ('اسناد در جریان وصول') exists for tenants having legacy 1120 named 'اسناد در جریان وصول'
    await queryRunner.query(`
      INSERT INTO "fin_chart_of_accounts" ("tenant_id", "code", "name", "account_type", "level", "currency", "balance")
      SELECT DISTINCT a."tenant_id", '1023', 'اسناد در جریان وصول', 'ASSET'::accounttype, 'MOEIN', 'IRR', 0
      FROM "fin_chart_of_accounts" a
      WHERE a."code" = '1120' AND a."name" = 'اسناد در جریان وصول'
      ON CONFLICT ("tenant_id", "code") DO UPDATE
      SET "name" = EXCLUDED."name";
    `);

    // 5. Re-point journal entry lines from legacy 1120 ('اسناد در جریان وصول') to 1023
    await queryRunner.query(`
      UPDATE "fin_journal_entry_lines" l
      SET "account_id" = target."id"
      FROM "fin_chart_of_accounts" a,
           "fin_chart_of_accounts" target
      WHERE l."account_id" = a."id"
        AND a."tenant_id" = l."tenant_id"
        AND a."code" = '1120'
        AND a."name" = 'اسناد در جریان وصول'
        AND target."tenant_id" = l."tenant_id"
        AND target."code" = '1023';
    `);

    // 6. Delete legacy 1120 if it was created solely as 'اسناد در جریان وصول'
    await queryRunner.query(`
      DELETE FROM "fin_chart_of_accounts"
      WHERE "code" = '1120' AND "name" = 'اسناد در جریان وصول';
    `);

    // 7. Ensure 2011 ('اسناد پرداختنی') exists for tenants having legacy 2110 named 'اسناد پرداختنی'
    await queryRunner.query(`
      INSERT INTO "fin_chart_of_accounts" ("tenant_id", "code", "name", "account_type", "level", "currency", "balance")
      SELECT DISTINCT a."tenant_id", '2011', 'اسناد پرداختنی', 'LIABILITY'::accounttype, 'MOEIN', 'IRR', 0
      FROM "fin_chart_of_accounts" a
      WHERE a."code" = '2110' AND a."name" = 'اسناد پرداختنی'
      ON CONFLICT ("tenant_id", "code") DO UPDATE
      SET "name" = EXCLUDED."name";
    `);

    // 8. Re-point journal entry lines from legacy 2110 ('اسناد پرداختنی') to 2011
    await queryRunner.query(`
      UPDATE "fin_journal_entry_lines" l
      SET "account_id" = target."id"
      FROM "fin_chart_of_accounts" a,
           "fin_chart_of_accounts" target
      WHERE l."account_id" = a."id"
        AND a."tenant_id" = l."tenant_id"
        AND a."code" = '2110'
        AND a."name" = 'اسناد پرداختنی'
        AND target."tenant_id" = l."tenant_id"
        AND target."code" = '2011';
    `);

    // 9. Delete legacy 2110 if it was created solely as 'اسناد پرداختنی'
    await queryRunner.query(`
      DELETE FROM "fin_chart_of_accounts"
      WHERE "code" = '2110' AND "name" = 'اسناد پرداختنی';
    `);

    // 10. Update posting role mappings if explicitly set to legacy codes
    await queryRunner.query(`
      UPDATE "fin_posting_role_maps"
      SET "account_code" = '1021'
      WHERE "role" = 'cheques_receivable' AND "account_code" = '1110';

      UPDATE "fin_posting_role_maps"
      SET "account_code" = '1023'
      WHERE "role" = 'cheques_in_collection' AND "account_code" = '1120';

      UPDATE "fin_posting_role_maps"
      SET "account_code" = '2011'
      WHERE "role" = 'cheques_payable' AND "account_code" = '2110';
    `);

    // 11. Recalculate cached balances for updated accounts
    await queryRunner.query(`
      UPDATE "fin_chart_of_accounts" a
      SET "balance" = COALESCE((
        SELECT SUM(l."debit" - l."credit")
        FROM "fin_journal_entry_lines" l
        WHERE l."account_id" = a."id"
      ), 0)
      WHERE a."code" IN ('1021', '1023', '2011');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate legacy chart accounts and re-link lines in rollback
    await queryRunner.query(`
      INSERT INTO "fin_chart_of_accounts" ("tenant_id", "code", "name", "account_type", "level", "currency", "balance")
      SELECT DISTINCT a."tenant_id", '1110', 'اسناد دریافتنی', 'ASSET'::accounttype, 'MOEIN', 'IRR', 0
      FROM "fin_chart_of_accounts" a
      WHERE a."code" = '1021'
      ON CONFLICT ("tenant_id", "code") DO UPDATE
      SET "name" = EXCLUDED."name";

      UPDATE "fin_journal_entry_lines" l
      SET "account_id" = target."id"
      FROM "fin_chart_of_accounts" a,
           "fin_chart_of_accounts" target
      WHERE l."account_id" = a."id"
        AND a."tenant_id" = l."tenant_id"
        AND a."code" = '1021'
        AND target."tenant_id" = l."tenant_id"
        AND target."code" = '1110';

      INSERT INTO "fin_chart_of_accounts" ("tenant_id", "code", "name", "account_type", "level", "currency", "balance")
      SELECT DISTINCT a."tenant_id", '1120', 'اسناد در جریان وصول', 'ASSET'::accounttype, 'MOEIN', 'IRR', 0
      FROM "fin_chart_of_accounts" a
      WHERE a."code" = '1023'
      ON CONFLICT ("tenant_id", "code") DO UPDATE
      SET "name" = EXCLUDED."name";

      UPDATE "fin_journal_entry_lines" l
      SET "account_id" = target."id"
      FROM "fin_chart_of_accounts" a,
           "fin_chart_of_accounts" target
      WHERE l."account_id" = a."id"
        AND a."tenant_id" = l."tenant_id"
        AND a."code" = '1023'
        AND target."tenant_id" = l."tenant_id"
        AND target."code" = '1120';

      INSERT INTO "fin_chart_of_accounts" ("tenant_id", "code", "name", "account_type", "level", "currency", "balance")
      SELECT DISTINCT a."tenant_id", '2110', 'اسناد پرداختنی', 'LIABILITY'::accounttype, 'MOEIN', 'IRR', 0
      FROM "fin_chart_of_accounts" a
      WHERE a."code" = '2011'
      ON CONFLICT ("tenant_id", "code") DO UPDATE
      SET "name" = EXCLUDED."name";

      UPDATE "fin_journal_entry_lines" l
      SET "account_id" = target."id"
      FROM "fin_chart_of_accounts" a,
           "fin_chart_of_accounts" target
      WHERE l."account_id" = a."id"
        AND a."tenant_id" = l."tenant_id"
        AND a."code" = '2011'
        AND target."tenant_id" = l."tenant_id"
        AND target."code" = '2110';

      UPDATE "fin_posting_role_maps"
      SET "account_code" = '1110'
      WHERE "role" = 'cheques_receivable' AND "account_code" = '1021';

      UPDATE "fin_posting_role_maps"
      SET "account_code" = '1120'
      WHERE "role" = 'cheques_in_collection' AND "account_code" = '1023';

      UPDATE "fin_posting_role_maps"
      SET "account_code" = '2110'
      WHERE "role" = 'cheques_payable' AND "account_code" = '2011';

      UPDATE "fin_chart_of_accounts" a
      SET "balance" = COALESCE((
        SELECT SUM(l."debit" - l."credit")
        FROM "fin_journal_entry_lines" l
        WHERE l."account_id" = a."id"
      ), 0)
      WHERE a."code" IN ('1110', '1120', '2110');
    `);
  }
}

