import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ایجاد جداول دسته‌های ورود داده (AI Import Batch) — فاز ۱ سوت کسب‌وکار.
 *
 * - `data_import_batches`: سرصفحه هر بار commit (موجودیت، نام فایل، تعداد
 *   درج، وضعیت undo) با ستون `tenant_id`.
 * - `data_import_batch_items`: نگاشت هر ردیف درج‌شده به شناسه ردیف جدول ماژول
 *   مالک (`owner_id`) تا undo بتواند دقیقاً همان ردیف‌ها را برای همان مستأجر
 *   حذف کند.
 *
 * طبق Rule #4 AGENTS.md، schema صریحاً از طریق Migration ایجاد می‌شود و هرگز به
 * synchronize=true تکیه نمی‌کنیم.
 */
export class CreateDataImportBatches1789200000000
  implements MigrationInterface
{
  name = 'CreateDataImportBatches1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "data_import_batches" (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "entity" character varying(64) NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "inserted" integer NOT NULL DEFAULT 0,
        "undone" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_data_import_batches_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_data_import_batches_tenant_created" ON "data_import_batches" ("tenant_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "data_import_batch_items" (
        "id" SERIAL NOT NULL,
        "tenant_id" uuid NOT NULL,
        "batch_id" uuid NOT NULL,
        "entity" character varying(64) NOT NULL,
        "owner_id" integer NOT NULL,
        "row_number" integer NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_data_import_batch_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_data_import_batch_items_batch"
          FOREIGN KEY ("batch_id")
          REFERENCES "data_import_batches"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_data_import_batch_items_tenant_batch" ON "data_import_batch_items" ("tenant_id", "batch_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_data_import_batch_items_tenant_owner" ON "data_import_batch_items" ("tenant_id", "entity", "owner_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_data_import_batch_items_tenant_owner"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_data_import_batch_items_tenant_batch"`,
    );
    await queryRunner.query(`DROP TABLE "data_import_batch_items"`);

    await queryRunner.query(
      `DROP INDEX "public"."IDX_data_import_batches_tenant_created"`,
    );
    await queryRunner.query(`DROP TABLE "data_import_batches"`);
  }
}
