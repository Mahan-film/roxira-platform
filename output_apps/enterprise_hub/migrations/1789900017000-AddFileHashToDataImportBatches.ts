import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * افزودن ستون هش فایل (`file_hash`) به جدول دسته‌های ورود (`data_import_batches`)
 * جهت پشتیبانی از ورود مجدد تکرارناپذیر (Idempotent Re-import).
 * در صورتی که فایلی با همان هش محتوا مجدداً برای یک مستأجر ارسال شود، هیچ ردیف جدیدی
 * ایجاد نمی‌شود و گزارش اجرای قبلی بازگردانده می‌شود.
 */
export class AddFileHashToDataImportBatches1789900017000
  implements MigrationInterface
{
  name = 'AddFileHashToDataImportBatches1789900017000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "data_import_batches"
      ADD COLUMN "file_hash" character varying(128) NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_data_import_batches_tenant_file_hash"
      ON "data_import_batches" ("tenant_id", "file_hash")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_data_import_batches_tenant_file_hash"`,
    );
    await queryRunner.query(`
      ALTER TABLE "data_import_batches"
      DROP COLUMN "file_hash"
    `);
  }
}
