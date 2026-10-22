import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * پیوند رویدادی صورتحساب به انبار و دفتر کل (Suite Events Posting).
 *
 * ستون‌های افزوده‌شده (همه nullable و صرفاً افزایشی):
 *   • journal_entry_id            شناسه سند حسابداری صدور.
 *   • paid_journal_entry_id       شناسه سند حسابداری تسویه.
 *   • reversal_journal_entry_id   شناسه سند حسابداری ابطال.
 *   • posting_error               آخرین خطای ثبت خودکار برای نمایش روی صورتحساب.
 *
 * این ستون‌ها نشانگر ایدمپوتنسی هستند: وجود شناسه سند به‌معنای «قبلاً ثبت
 * شده» است و از ثبت دوبارهٔ گردش انبار/دفاتر جلوگیری می‌کند. طبق
 * Contract-First Synchronization (AGENTS.md بخش ۲.۴) اسکیمای جدید صریحاً از
 * طریق Migration و بدون تکیه بر synchronize اعمال می‌شود.
 */
export class AddInvoiceSuitePosting1789250000000
  implements MigrationInterface
{
  name = 'AddInvoiceSuitePosting1789250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "journal_entry_id" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "paid_journal_entry_id" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "reversal_journal_entry_id" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "posting_error" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN IF EXISTS "posting_error"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN IF EXISTS "reversal_journal_entry_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN IF EXISTS "paid_journal_entry_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN IF EXISTS "journal_entry_id"`,
    );
  }
}
