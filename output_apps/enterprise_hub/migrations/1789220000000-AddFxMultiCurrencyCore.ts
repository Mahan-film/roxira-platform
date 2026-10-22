import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * هسته حسابداری چندارزی (Multi-Currency Accounting Core).
 *
 * مبنای موردنیاز ورود بسته ERP: سطرهای سند دفتر روزنامه باید ارز، مبلغ ارزی
 * (`amount_fx`)، نرخ تبدیل (`fx_rate`) و کد طرف/تفضیلی (`party_code`) را نگه
 * دارند و فاکتورها نیز معادل ارزی و نرخ تبدیل را ثبت کنند. مانده اسناد
 * همچنان بر مبنای ریال (ارز پایه گزارش) کنترل می‌شود.
 *
 * طبق Contract-First Synchronization (AGENTS.md بخش ۲.۴) اسکیمای جدید صریحاً
 * از طریق Migration و بدون تکیه بر synchronize اعمال می‌شود. ستون `tenant_id`
 * این جداول پیش‌تر افزوده شده است. هیچ‌جا `transaction = false` استفاده
 * نمی‌شود؛ Migration داخل تراکنش پیش‌فرض اجرا می‌گردد.
 */
export class AddFxMultiCurrencyCore1789220000000
  implements MigrationInterface
{
  name = 'AddFxMultiCurrencyCore1789220000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ==================================================================
    // حسابداری — fin_journal_entry_lines (سطرهای بدهکار/بستانکار چندارزی)
    // ==================================================================
    await queryRunner.query(
      `ALTER TABLE "fin_journal_entry_lines" ADD COLUMN IF NOT EXISTS "currency" character varying(8) NOT NULL DEFAULT 'IRR'`,
    );
    await queryRunner.query(
      `ALTER TABLE "fin_journal_entry_lines" ADD COLUMN IF NOT EXISTS "amount_fx" numeric(24,6)`,
    );
    await queryRunner.query(
      `ALTER TABLE "fin_journal_entry_lines" ADD COLUMN IF NOT EXISTS "fx_rate" numeric(24,6)`,
    );
    await queryRunner.query(
      `ALTER TABLE "fin_journal_entry_lines" ADD COLUMN IF NOT EXISTS "party_code" character varying(64)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_journal_entry_lines_tenant_currency" ON "fin_journal_entry_lines" ("tenant_id", "currency")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_journal_entry_lines_tenant_party" ON "fin_journal_entry_lines" ("tenant_id", "party_code")`,
    );

    // ==================================================================
    // صدور فاکتور — invoices (معادل ارزی و نرخ تبدیل)
    // ==================================================================
    // ستون `currency` در محیط‌های موجود از پیش هست (varchar(3)) و در پایگاه
    // داده تازه ساخته می‌شود؛ در هر دو حالت به varchar(8) توسعه می‌یابد تا
    // کدهای گسترده‌تر (مثل MULTI) پذیرفته شوند.
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "currency" character varying(8) NOT NULL DEFAULT 'IRR'`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ALTER COLUMN "currency" TYPE character varying(8)`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "fx_rate" numeric(24,6) NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "amount_fx" numeric(24,6)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN IF EXISTS "amount_fx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN IF EXISTS "fx_rate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ALTER COLUMN "currency" TYPE character varying(3)`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_fin_journal_entry_lines_tenant_party"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_fin_journal_entry_lines_tenant_currency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fin_journal_entry_lines" DROP COLUMN IF EXISTS "party_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fin_journal_entry_lines" DROP COLUMN IF EXISTS "fx_rate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fin_journal_entry_lines" DROP COLUMN IF EXISTS "amount_fx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fin_journal_entry_lines" DROP COLUMN IF EXISTS "currency"`,
    );
  }
}
