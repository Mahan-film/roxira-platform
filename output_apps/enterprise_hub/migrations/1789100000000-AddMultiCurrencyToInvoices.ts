import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * افزودن پشتیبانی چندارزی به جدول invoices (ماژول Smart Invoicing).
 *
 * طبق Contract-First Synchronization (AGENTS.md بخش ۲.۴) اسکیمای جدید
 * صریحاً از طریق Migration و بدون تکیه بر synchronize ایجاد می‌شود.
 *
 * ستون‌های اضافه‌شده:
 *   currency        ارز اصلی فاکتور (IRR/USD/EUR/AED)
 *   exchangeRate    نرخ تبدیل به ارز پایه (واحد ارز پایه به‌ازای ۱ واحد فاکتور)
 *   baseCurrency    ارز پایه تجمیع بین‌المللی (USD)
 *   baseTotalAmount جمع ناخالص معادل ارز پایه
 *   baseTotalTax    جمع مالیات معادل ارز پایه
 *   baseFinalPayable مبلغ نهایی معادل ارز پایه
 */
export class AddMultiCurrencyToInvoices1789100000000
  implements MigrationInterface
{
  name = 'AddMultiCurrencyToInvoices1789100000000';

  /** نرخ مرجع پیش‌فرض ریال به دلار برای Backfill داده‌های موجود. */
  private static readonly IRR_PER_USD = 920000;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "currency" character varying(3) NOT NULL DEFAULT 'IRR'`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "exchangeRate" numeric(18,8) NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "baseCurrency" character varying(3) NOT NULL DEFAULT 'USD'`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "baseTotalAmount" numeric(18,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "baseTotalTax" numeric(18,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "baseFinalPayable" numeric(18,2) NOT NULL DEFAULT 0`,
    );

    // Backfill: فاکتورهای موجود ریالی هستند و نرخ اعمال‌شده ۱/۹۲۰۰۰۰ است.
    await queryRunner.query(
      `UPDATE "invoices"
         SET "exchangeRate" = 1.0 / ${AddMultiCurrencyToInvoices1789100000000.IRR_PER_USD},
             "baseTotalAmount" = ROUND("totalAmount" / ${AddMultiCurrencyToInvoices1789100000000.IRR_PER_USD}, 2),
             "baseTotalTax" = ROUND("totalTax" / ${AddMultiCurrencyToInvoices1789100000000.IRR_PER_USD}, 2),
             "baseFinalPayable" = ROUND("finalPayable" / ${AddMultiCurrencyToInvoices1789100000000.IRR_PER_USD}, 2)`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_invoices_currency" ON "invoices" ("currency")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_invoices_currency"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "baseFinalPayable"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "baseTotalTax"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "baseTotalAmount"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "baseCurrency"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "exchangeRate"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "currency"`);
  }
}
