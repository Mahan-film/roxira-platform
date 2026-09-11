import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ایجاد جداول ماژول «تطبیق سامانه مودیان و امضای الکترونیک صورتحساب‌ها».
 *
 * - `tax_signing_keys`: زوج‌کلیدهای RSA مالیاتی و CSRهای متناظر.
 * - `tax_invoice_signatures`: بسته امضاشده هر صورتحساب به‌همراه TaxID
 *   ۲۲ رقمی، هش داده، امضای JWS و وضعیت ارسال به سامانه مودیان.
 *
 * طبق Rule #4 AGENTS.md (Contract-First Synchronization) schema صریحاً از
 * طریق Migration ایجاد می‌شود و هرگز به synchronize=true تکیه نمی‌کنیم.
 */
export class CreateTaxComplianceTables1789080000000
  implements MigrationInterface
{
  name = 'CreateTaxComplianceTables1789080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ------------------------------------------------------------------
    // کلیدهای امضای مالیاتی (RSA)
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "tax_signing_keys" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key_id" character varying(96) NOT NULL,
        "public_key_pem" text NOT NULL,
        "private_key_pem" text NOT NULL,
        "certificate_request_pem" text,
        "algorithm" character varying(16) NOT NULL DEFAULT 'RS256',
        "modulus_length" integer NOT NULL DEFAULT 2048,
        "key_fingerprint" character varying(128) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tax_signing_keys_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_tax_signing_keys_key_id" ON "tax_signing_keys" ("key_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tax_signing_keys_is_active" ON "tax_signing_keys" ("is_active")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tax_signing_keys_key_fingerprint" ON "tax_signing_keys" ("key_fingerprint")`,
    );

    // ------------------------------------------------------------------
    // بسته‌های امضاشده مالیاتی
    // ------------------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "public"."tax_invoice_signatures_status_enum" AS ENUM('SIGNED', 'SENT', 'ACCEPTED', 'REJECTED')`,
    );

    await queryRunner.query(`
      CREATE TABLE "tax_invoice_signatures" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "invoice_id" uuid NOT NULL,
        "tax_invoice_number" character varying(64) NOT NULL,
        "tax_id" character varying(32) NOT NULL,
        "hash_algorithm" character varying(16) NOT NULL,
        "data_hash" character varying(128) NOT NULL,
        "signature_algorithm" character varying(16) NOT NULL,
        "jws_signature" text NOT NULL,
        "key_id" character varying(96) NOT NULL,
        "key_fingerprint" character varying(128) NOT NULL,
        "status" "public"."tax_invoice_signatures_status_enum" NOT NULL DEFAULT 'SIGNED',
        "reference_number" character varying(64),
        "error_message" text,
        "signed_packet" jsonb NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tax_invoice_signatures_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tax_invoice_signatures_invoice"
          FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_tax_invoice_signatures_invoice_id" ON "tax_invoice_signatures" ("invoice_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_tax_invoice_signatures_tax_id" ON "tax_invoice_signatures" ("tax_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tax_invoice_signatures_tax_invoice_number" ON "tax_invoice_signatures" ("tax_invoice_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tax_invoice_signatures_key_id" ON "tax_invoice_signatures" ("key_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tax_invoice_signatures_status" ON "tax_invoice_signatures" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tax_invoice_signatures_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tax_invoice_signatures_key_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tax_invoice_signatures_tax_invoice_number"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tax_invoice_signatures_tax_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tax_invoice_signatures_invoice_id"`,
    );
    await queryRunner.query(`DROP TABLE "tax_invoice_signatures"`);
    await queryRunner.query(
      `DROP TYPE "public"."tax_invoice_signatures_status_enum"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_tax_signing_keys_key_fingerprint"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tax_signing_keys_is_active"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tax_signing_keys_key_id"`,
    );
    await queryRunner.query(`DROP TABLE "tax_signing_keys"`);
  }
}
