import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T342: Store accepted terms & privacy policy versions and timestamps per user at sign-up.
 */
export class AddUserTermsAndPrivacyAcceptance1789900041000
  implements MigrationInterface
{
  name = 'AddUserTermsAndPrivacyAcceptance1789900041000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "terms_accepted_version" varchar(64),
        ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamp,
        ADD COLUMN IF NOT EXISTS "privacy_accepted_version" varchar(64),
        ADD COLUMN IF NOT EXISTS "privacy_accepted_at" timestamp
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "privacy_accepted_at",
        DROP COLUMN IF EXISTS "privacy_accepted_version",
        DROP COLUMN IF EXISTS "terms_accepted_at",
        DROP COLUMN IF EXISTS "terms_accepted_version"
    `);
  }
}
