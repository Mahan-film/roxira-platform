import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves the legacy cheque accounts (1110 / 1120 / 2110) to the new cheque codes
 * (1021 / 1023 / 2011).
 *
 * An account is only treated as a legacy cheque account when BOTH its code and the
 * exact legacy seeded cheque name match (cheque.constants.ts on main). On tenants where
 * those codes are other accounts (1110 = land, 1120 = accumulated depreciation,
 * 2110 = long-term loans in the default chart) nothing is touched.
 * Accounts are never deleted: the chart has no active/archived column, so a fully
 * migrated legacy account stays in place with zero lines.
 */
const LEGACY = [
  { legacy: '1110', legacyName: 'اسناد دریافتنی نزد صندوق', target: '1021', targetName: 'اسناد دریافتنی', type: 'ASSET', role: 'cheques_receivable' },
  { legacy: '1120', legacyName: 'اسناد دریافتنی در جریان وصول', target: '1023', targetName: 'اسناد در جریان وصول', type: 'ASSET', role: 'cheques_in_collection' },
  { legacy: '2110', legacyName: 'اسناد پرداختنی', target: '2011', targetName: 'اسناد پرداختنی', type: 'LIABILITY', role: 'cheques_payable' },
] as const;

const LINES_GUARD = 'TRG_fin_journal_entry_lines_guard_posted';

/** Re-pointing a line to another account never changes amounts; allow it on posted entries (as AddBranchDimension does). */
const setLinesGuard = (queryRunner: QueryRunner, action: 'DISABLE' | 'ENABLE') =>
  queryRunner.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${LINES_GUARD}') THEN
        ALTER TABLE "fin_journal_entry_lines" ${action} TRIGGER "${LINES_GUARD}";
      END IF;
    END $$;
  `);

export class MigrateLegacyChequeAccounts1789900010200 implements MigrationInterface {
  name = 'MigrateLegacyChequeAccounts1789900010200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await setLinesGuard(queryRunner, 'DISABLE');
    for (const m of LEGACY) {
      // 1. The new target account exists for every tenant, independent of legacy accounts
      //    (posting-roles.ts defaults to these codes).
      await queryRunner.query(`
        INSERT INTO "fin_chart_of_accounts" ("tenant_id", "code", "name", "account_type", "level", "currency", "balance")
        SELECT DISTINCT a."tenant_id", '${m.target}', '${m.targetName}', '${m.type}'::accounttype, 'MOEIN', 'IRR', 0
        FROM "fin_chart_of_accounts" a
        ON CONFLICT ("tenant_id", "code") DO NOTHING
      `);

      // 2. Re-point journal lines only from a legacy-named cheque account.
      await queryRunner.query(`
        UPDATE "fin_journal_entry_lines" l
        SET "account_id" = target."id"
        FROM "fin_chart_of_accounts" a,
             "fin_chart_of_accounts" target
        WHERE l."account_id" = a."id"
          AND a."tenant_id" = l."tenant_id"
          AND a."code" = '${m.legacy}'
          AND a."name" = '${m.legacyName}'
          AND target."tenant_id" = l."tenant_id"
          AND target."code" = '${m.target}';
      `);

      // 3. Posting role maps follow only on tenants whose legacy account is the cheque one.
      await queryRunner.query(`
        UPDATE "fin_posting_role_maps" m
        SET "account_code" = '${m.target}'
        WHERE m."role" = '${m.role}' AND m."account_code" = '${m.legacy}'
          AND EXISTS (
            SELECT 1 FROM "fin_chart_of_accounts" a
            WHERE a."tenant_id" = m."tenant_id"
              AND a."code" = '${m.legacy}'
              AND a."name" = '${m.legacyName}'
          );
      `);
    }

    // 4. Recalculate cached balances for the targets and for the legacy-named accounts left behind.
    await queryRunner.query(`
      UPDATE "fin_chart_of_accounts" a
      SET "balance" = COALESCE((
        SELECT SUM(l."debit" - l."credit")
        FROM "fin_journal_entry_lines" l
        WHERE l."account_id" = a."id"
      ), 0)
      WHERE a."code" IN ('1021', '1023', '2011')
         OR (a."code" = '1110' AND a."name" = 'اسناد دریافتنی نزد صندوق')
         OR (a."code" = '1120' AND a."name" = 'اسناد دریافتنی در جریان وصول')
         OR (a."code" = '2110' AND a."name" = 'اسناد پرداختنی');
    `);
    await setLinesGuard(queryRunner, 'ENABLE');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate legacy chart accounts (never overwriting a renamed account) and re-link lines.
    // Lines only move into an account that carries the legacy cheque name.
    await setLinesGuard(queryRunner, 'DISABLE');
    for (const m of LEGACY) {
      await queryRunner.query(`
        INSERT INTO "fin_chart_of_accounts" ("tenant_id", "code", "name", "account_type", "level", "currency", "balance")
        SELECT DISTINCT a."tenant_id", '${m.legacy}', '${m.legacyName}', '${m.type}'::accounttype, 'MOEIN', 'IRR', 0
        FROM "fin_chart_of_accounts" a
        WHERE a."code" = '${m.target}'
        ON CONFLICT ("tenant_id", "code") DO NOTHING;

        UPDATE "fin_journal_entry_lines" l
        SET "account_id" = target."id"
        FROM "fin_chart_of_accounts" a,
             "fin_chart_of_accounts" target
        WHERE l."account_id" = a."id"
          AND a."tenant_id" = l."tenant_id"
          AND a."code" = '${m.target}'
          AND target."tenant_id" = l."tenant_id"
          AND target."code" = '${m.legacy}'
          AND target."name" = '${m.legacyName}';

        UPDATE "fin_posting_role_maps"
        SET "account_code" = '${m.legacy}'
        WHERE "role" = '${m.role}' AND "account_code" = '${m.target}';
      `);
    }

    await queryRunner.query(`
      UPDATE "fin_chart_of_accounts" a
      SET "balance" = COALESCE((
        SELECT SUM(l."debit" - l."credit")
        FROM "fin_journal_entry_lines" l
        WHERE l."account_id" = a."id"
      ), 0)
      WHERE a."code" IN ('1110', '1120', '2110');
    `);
    await setLinesGuard(queryRunner, 'ENABLE');
  }
}
