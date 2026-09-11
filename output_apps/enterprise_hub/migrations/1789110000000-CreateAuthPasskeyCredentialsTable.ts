import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ایجاد جدول auth_passkey_credentials منطبق بر PasskeyCredentialEntity
 * (ماژول Auth — WebAuthn / Passkey).
 *
 * طبق Contract-First Synchronization (AGENTS.md بخش ۲.۴) اسکیمای
 * پایگاه‌داده صریحاً از طریق Migration ایجاد می‌شود و هرگز به
 * synchronize=true در محیط production تکیه نمی‌گردد.
 */
export class CreateAuthPasskeyCredentialsTable1789110000000
  implements MigrationInterface
{
  name = 'CreateAuthPasskeyCredentialsTable1789110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE "auth_passkey_credentials" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "credential_id" text NOT NULL,
        "public_key" text NOT NULL,
        "public_key_alg" integer NOT NULL,
        "sign_count" integer NOT NULL DEFAULT 0,
        "transports" character varying(255),
        "device_type" character varying(32),
        "backed_up" boolean NOT NULL DEFAULT false,
        "label" character varying(120),
        "last_used_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auth_passkey_credentials_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_auth_passkey_credentials_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_auth_passkey_credentials_credential_id" ON "auth_passkey_credentials" ("credential_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_passkey_credentials_user_id" ON "auth_passkey_credentials" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_auth_passkey_credentials_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_auth_passkey_credentials_credential_id"`,
    );
    await queryRunner.query(`DROP TABLE "auth_passkey_credentials"`);
  }
}
