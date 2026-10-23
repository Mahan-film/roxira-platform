import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * حساب‌های بانکی و سطرهای صورتحساب بانک (مغایرت‌گیری بانکی، فاز ۲).
 *
 * هر دو جدول ستون `tenant_id` دارند و دسترسی در لایه Repository به مستأجر
 * محدود می‌شود (AGENTS.md §4). Migration کاملاً افزایشی است و داخل تراکنش
 * پیش‌فرض اجرا می‌شود.
 *
 * - `fin_bank_accounts.ledger_account_id` → حساب دفتر کل (RESTRICT).
 * - `fin_bank_statement_lines.matched_journal_line_id` → سطر سند (SET NULL: حذف سند،
 *   تطبیق را باز می‌کند). ایندکس یکتای جزئی تضمین می‌کند هر سطر سند حداکثر با
 *   یک سطر بانک تطبیق بخورد.
 */
export class CreateBankReconciliation1789280000000 implements MigrationInterface {
  name = 'CreateBankReconciliation1789280000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "fin_bank_accounts" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "name" character varying(128) NOT NULL,
        "bank_code" character varying(32) NOT NULL DEFAULT 'other',
        "account_number" character varying(64) NOT NULL,
        "iban" character varying(34),
        "ledger_account_id" integer NOT NULL,
        "currency" character varying(8) NOT NULL DEFAULT 'IRR',
        "opening_balance" numeric(18,2) NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_fin_bank_accounts_ledger_account" FOREIGN KEY ("ledger_account_id")
          REFERENCES "fin_chart_of_accounts"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_fin_bank_accounts_tenant_number" ON "fin_bank_accounts" ("tenant_id", "account_number")`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "fin_bank_statement_lines" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "bank_account_id" integer NOT NULL,
        "txn_date" date NOT NULL,
        "description" text,
        "withdrawal" numeric(18,2) NOT NULL DEFAULT 0,
        "deposit" numeric(18,2) NOT NULL DEFAULT 0,
        "balance" numeric(18,2),
        "reference" character varying(64),
        "dedupe_key" character varying(255) NOT NULL,
        "matched_journal_line_id" integer,
        "match_method" character varying(16),
        "matched_at" TIMESTAMP,
        "created_journal_entry_id" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_fin_bank_statement_lines_account" FOREIGN KEY ("bank_account_id")
          REFERENCES "fin_bank_accounts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_fin_bank_statement_lines_journal_line" FOREIGN KEY ("matched_journal_line_id")
          REFERENCES "fin_journal_entry_lines"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_bank_statement_lines_tenant_account_date" ON "fin_bank_statement_lines" ("tenant_id", "bank_account_id", "txn_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_bank_statement_lines_tenant_dedupe" ON "fin_bank_statement_lines" ("tenant_id", "dedupe_key")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_bank_statement_lines_journal_line" ON "fin_bank_statement_lines" ("tenant_id", "matched_journal_line_id") WHERE "matched_journal_line_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "fin_bank_statement_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fin_bank_accounts"`);
  }
}
