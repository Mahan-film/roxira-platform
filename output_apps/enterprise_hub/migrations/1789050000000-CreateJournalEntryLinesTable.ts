import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ایجاد جدول سطرهای سند دوطرفه `fin_journal_entry_lines` و بذرگذاری اولیه
 * حساب‌های استاندارد دفتر کل.
 *
 * چرا Migration جداگانه؟
 * جداول `fin_chart_of_accounts` و `fin_journal_entries` پیش‌تر توسط لایه مالی
 * پایتونی ایجاد شده‌اند و تنها سرصفحه سند را نگه می‌دارند. برای حسابداری
 * دوطرفه واقعی، سطرهای بدهکار/بستانکار در جدول خطوط نگهداری می‌شوند.
 * طبق Rule #4 AGENTS.md (Contract-First Synchronization) این تغییر صریحاً از
 * طریق Migration اعمال می‌شود و هرگز به synchronize=true تکیه نمی‌کنیم.
 */
export class CreateJournalEntryLinesTable1789050000000
  implements MigrationInterface
{
  name = 'CreateJournalEntryLinesTable1789050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "fin_journal_entry_lines" (
        "id" SERIAL NOT NULL,
        "journal_entry_id" integer NOT NULL,
        "account_id" integer NOT NULL,
        "debit" numeric(18,2) NOT NULL DEFAULT 0,
        "credit" numeric(18,2) NOT NULL DEFAULT 0,
        "description" text,
        CONSTRAINT "PK_fin_journal_entry_lines_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_fin_journal_entry_lines_entry"
          FOREIGN KEY ("journal_entry_id")
          REFERENCES "fin_journal_entries"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_fin_journal_entry_lines_account"
          FOREIGN KEY ("account_id")
          REFERENCES "fin_chart_of_accounts"("id")
          ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_fin_journal_entry_lines_entry" ON "fin_journal_entry_lines" ("journal_entry_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fin_journal_entry_lines_account" ON "fin_journal_entry_lines" ("account_id")`,
    );

    await queryRunner.query(`
      INSERT INTO "fin_chart_of_accounts" ("code", "name", "account_type", "currency", "balance")
      VALUES
        ('1010', 'موجودی نقد و بانک', 'ASSET', 'IRR', 0),
        ('1020', 'حساب‌های دریافتنی تجاری', 'ASSET', 'IRR', 0),
        ('1030', 'موجودی کالا', 'ASSET', 'IRR', 0),
        ('2010', 'حساب‌های پرداختنی تجاری', 'LIABILITY', 'IRR', 0),
        ('2020', 'مالیات بر ارزش افزوده پرداختنی', 'LIABILITY', 'IRR', 0),
        ('3010', 'سرمایه', 'EQUITY', 'IRR', 0),
        ('4010', 'درآمد فروش خدمات', 'REVENUE', 'IRR', 0),
        ('4020', 'درآمد فروش کالا', 'REVENUE', 'IRR', 0),
        ('5010', 'هزینه حقوق و دستمزد', 'EXPENSE', 'IRR', 0),
        ('5020', 'هزینه اجاره', 'EXPENSE', 'IRR', 0),
        ('5030', 'هزینه‌های عمومی و اداری', 'EXPENSE', 'IRR', 0)
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "fin_chart_of_accounts" WHERE "code" IN ('1010','1020','1030','2010','2020','3010','4010','4020','5010','5020','5030') AND "balance" = 0`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fin_journal_entry_lines_account"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fin_journal_entry_lines_entry"`,
    );
    await queryRunner.query(`DROP TABLE "fin_journal_entry_lines"`);
  }
}