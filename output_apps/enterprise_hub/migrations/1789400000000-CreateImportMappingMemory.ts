import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * حافظهٔ نگاشت ورود داده برای هر مستأجر: اگر کاربر یک بار نگاشت ستون‌های یک فایل را تأیید کرد، دفعهٔ بعد
 * فایل با همان سربرگ‌ها از پیش نگاشت می‌شود. ستون `tenant_id` اجباری است و همهٔ کوئری‌ها در لایهٔ
 * Repository به آن محدودند (AGENTS.md §4). فقط نام ستون‌ها و نام فیلدها ذخیره می‌شود، نه مقدار داده.
 * Migration افزایشی است.
 */
export class CreateImportMappingMemory1789400000000 implements MigrationInterface {
  name = 'CreateImportMappingMemory1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "data_import_mapping_memory" (
        "id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "signature" character varying(64) NOT NULL,
        "entity" character varying(64) NOT NULL,
        "mapping" jsonb NOT NULL,
        "uses" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_import_mapping_memory_tenant_signature" ON "data_import_mapping_memory" ("tenant_id", "signature")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "data_import_mapping_memory"`);
  }
}
