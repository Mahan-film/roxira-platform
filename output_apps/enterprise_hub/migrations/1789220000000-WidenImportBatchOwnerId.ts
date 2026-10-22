import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * پهن‌تر کردن ستون `owner_id` جدول `data_import_batch_items`.
 *
 * مهاجرت بستهٔ دیتابیس، صورتحساب‌ها را با کلید UUID درج می‌کند؛ بنابراین
 * نگاشت ردیف‌های دسته باید هر دو شناسهٔ عددی و رشته‌ای (UUID) را نگه دارد.
 * سایر موجودیت‌ها همچنان شناسهٔ عددی دارند و به‌صورت رشته ذخیره/بازیابی
 * می‌شوند.
 */
export class WidenImportBatchOwnerId1789220000000
  implements MigrationInterface
{
  name = 'WidenImportBatchOwnerId1789220000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "data_import_batch_items" ALTER COLUMN "owner_id" TYPE character varying(64) USING "owner_id"::text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "data_import_batch_items" ALTER COLUMN "owner_id" TYPE integer USING "owner_id"::integer`,
    );
  }
}
