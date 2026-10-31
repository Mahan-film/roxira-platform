import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Username/email + password sign-in and server-side refresh tokens.
 *
 *  - users.phone becomes NULLable (accounts created with email have no phone).
 *  - users.username / login_email / password_hash / password_updated_at.
 *    Unique indexes are on dedicated columns, not on the legacy `email` column,
 *    so existing duplicate data cannot make this migration fail.
 *  - auth_refresh_tokens: hashed, rotating refresh tokens (owner: user_id,
 *    tenant: tenant_id). Logout and password reset revoke them.
 *
 * down() refuses to restore NOT NULL on phone while phone-less users exist,
 * instead of deleting accounts.
 */
export class AddPasswordAuth1789340000000 implements MigrationInterface {
  name = 'AddPasswordAuth1789340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "username" character varying(32)`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "login_email" character varying(254)`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "password_hash" text`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "password_updated_at" TIMESTAMP`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_users_username" ON "users" ("username")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_users_login_email" ON "users" ("login_email")`,
    );
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "CHK_users_has_identifier"
      CHECK ("phone" IS NOT NULL OR "username" IS NOT NULL OR "login_email" IS NOT NULL)
    `);

    await queryRunner.query(`
      CREATE TABLE "auth_refresh_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "tenant_id" uuid,
        "token_hash" character(64) NOT NULL,
        "family_id" uuid NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "revoked_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auth_refresh_tokens_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_auth_refresh_tokens_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_auth_refresh_tokens_hash" ON "auth_refresh_tokens" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_refresh_tokens_user" ON "auth_refresh_tokens" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_refresh_tokens_tenant" ON "auth_refresh_tokens" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_refresh_tokens_family" ON "auth_refresh_tokens" ("family_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const phoneless = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM "users" WHERE "phone" IS NULL`,
    )) as Array<{ n: number }>;
    if (phoneless[0]?.n > 0) {
      throw new Error(
        `Cannot revert: ${phoneless[0].n} user(s) have no phone. Remove or assign phones first; this migration never deletes accounts.`,
      );
    }
    await queryRunner.query(`DROP TABLE "auth_refresh_tokens"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_has_identifier"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_users_login_email"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_users_username"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password_updated_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password_hash"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "login_email"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "username"`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL`);
  }
}
