import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * حوزه قضایی/مالیاتی صورتحساب (Invoice Jurisdiction).
 *
 * صورتحساب‌های داخلی (IR) با تاریخ جلالی و مبالغ ریالی/تومانی و VAT پیش‌فرض
 * ۱۰٪ صادر می‌شوند؛ صورتحساب‌های بین‌المللی (INTL) مبالغ را به ارز خودِ
 * صورتحساب نگه می‌دارند و VAT پیش‌فرض آن‌ها صفر است. این Migration صرفاً و
 * به‌صورت افزایشی ستون `jurisdiction` را با پیش‌فرض «IR» اضافه می‌کند تا
 * داده‌های موجود دست‌نخورده بمانند.
 *
 * هیچ‌جا `transaction = false` استفاده نمی‌شود؛ Migration داخل تراکنش پیش‌فرض
 * اجرا می‌گردد (AGENTS.md بخش ۲.۴).
 */
export class AddInvoiceJurisdiction1789260000000
  implements MigrationInterface
{
  name = 'AddInvoiceJurisdiction1789260000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "jurisdiction" character varying(8) NOT NULL DEFAULT 'IR'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN IF EXISTS "jurisdiction"`,
    );
  }
}
