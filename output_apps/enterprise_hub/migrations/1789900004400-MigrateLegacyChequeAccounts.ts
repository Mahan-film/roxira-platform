import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrateLegacyChequeAccounts1789900004400 implements MigrationInterface {
  name = 'MigrateLegacyChequeAccounts1789900004400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ensure 1021 ('اسناد دریافتنی') exists for tenants having legacy 1110 named 'اسناد دریافتنی'
    await queryRunner.query(`
      INSERT INTO "fin_chart_of_accounts" ("tenant_id", "code", "name", "account_type", "level", "currency", "balance")
      SELECT DISTINCT a."tenant_id", '1021', 'اسناد دریافتنی', 'ASSET', 'moein', 'IRR', 0
      FROM "fin_chart_of_accounts" a
      WHERE a."code" = '1110' AND a."name" = 'اسناد دریافتنی'
        AND NOT EXISTS (
          SELECT 1 FROM "fin_chart_of_accounts" x
          WHERE x."tenant_id" = a."tenant_id" AND x."code" = '1021'
        );
    `);

    // 2. Re-point journal entry lines from legacy 1110 ('اسناد دریافتنی') to 1021
    await queryRunner.query(`
      UPDATE "fin_journal_entry_lines" l
      SET "account_code" = '1021',
          "account_id" = (
            SELECT target."id"
            FROM "fin_chart_of_accounts" target
            WHERE target."tenant_id" = l."tenant_id" AND target."code" = '1021'
            LIMIT 1
          )
      FROM "fin_chart_of_accounts" a
      WHERE l."tenant_id" = a."tenant_id"
        AND l."account_code" = '1110'
        AND a."code" = '1110'
        AND a."name" = 'اسناد دریافتنی';
    `);

    // 3. Delete legacy 1110 if it was created solely as 'اسناد دریافتنی'
    await queryRunner.query(`
      DELETE FROM "fin_chart_of_accounts"
      WHERE "code" = '1110' AND "name" = 'اسناد دریافتنی';
    `);

    // 4. Ensure 1023 ('اسناد در جریان وصول') exists for tenants having legacy 1120 named 'اسناد در جریان وصول'
    await queryRunner.query(`
      INSERT INTO "fin_chart_of_accounts" ("tenant_id", "code", "name", "account_type", "level", "currency", "balance")
      SELECT DISTINCT a."tenant_id", '1023', 'اسناد در جریان وصول', 'ASSET', 'moein', 'IRR', 0
      FROM "fin_chart_of_accounts" a
      WHERE a."code" = '1120' AND a."name" = 'اسناد در جریان وصول'
        AND NOT EXISTS (
          SELECT 1 FROM "fin_chart_of_accounts" x
          WHERE x."tenant_id" = a."tenant_id" AND x."code" = '1023'
        );
    `);

    // 5. Re-point journal entry lines from legacy 1120 ('اسناد در جریان وصول') to 1023
    await queryRunner.query(`
      UPDATE "fin_journal_entry_lines" l
      SET "account_code" = '1023',
          "account_id" = (
            SELECT target."id"
            FROM "fin_chart_of_accounts" target
            WHERE target."tenant_id" = l."tenant_id" AND target."code" = '1023'
            LIMIT 1
          )
      FROM "fin_chart_of_accounts" a
      WHERE l."tenant_id" = a."tenant_id"
        AND l."account_code" = '1120'
        AND a."code" = '1120'
        AND a."name" = 'اسناد در جریان وصول';
    `);

    // 6. Delete legacy 1120 if it was created solely as 'اسناد در جریان وصول'
    await queryRunner.query(`
      DELETE FROM "fin_chart_of_accounts"
      WHERE "code" = '1120' AND "name" = 'اسناد در جریان وصول';
    `);

    // 7. Ensure 2011 ('اسناد پرداختنی') exists for tenants having legacy 2110 named 'اسناد پرداختنی'
    await queryRunner.query(`
      INSERT INTO "fin_chart_of_accounts" ("tenant_id", "code", "name", "account_type", "level", "currency", "balance")
      SELECT DISTINCT a."tenant_id", '2011', 'اسناد پرداختنی', 'LIABILITY', 'moein', 'IRR', 0
      FROM "fin_chart_of_accounts" a
      WHERE a."code" = '2110' AND a."name" = 'اسناد پرداختنی'
        AND NOT EXISTS (
          SELECT 1 FROM "fin_chart_of_accounts" x
          WHERE x."tenant_id" = a."tenant_id" AND x."code" = '2011'
        );
    `);

    // 8. Re-point journal entry lines from legacy 2110 ('اسناد پرداختنی') to 2011
    await queryRunner.query(`
      UPDATE "fin_journal_entry_lines" l
      SET "account_code" = '2011',
          "account_id" = (
            SELECT target."id"
            FROM "fin_chart_of_accounts" target
            WHERE target."tenant_id" = l."tenant_id" AND target."code" = '2011'
            LIMIT 1
          )
      FROM "fin_chart_of_accounts" a
      WHERE l."tenant_id" = a."tenant_id"
        AND l."account_code" = '2110'
        AND a."code" = '2110'
        AND a."name" = 'اسناد پرداختنی';
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
        WHERE l."tenant_id" = a."tenant_id" AND l."account_code" = a."code"
      ), 0)
      WHERE a."code" IN ('1021', '1023', '2011');
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Non-destructive: down does not recreate legacy collisions with fixed assets
  }
}
