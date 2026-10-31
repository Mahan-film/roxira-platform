import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Accounts an organisation creates for its own staff (username + password set by
 * an owner/admin). `managed_by_tenant_id` names the organisation that may reset
 * the password; it is NULL for everyone who signed up themselves, so an admin can
 * never take over a personal account.
 */
export class AddManagedUsers1789360000000 implements MigrationInterface {
  name = 'AddManagedUsers1789360000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "managed_by_tenant_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_users_managed_by_tenant" ON "users" ("managed_by_tenant_id") WHERE "managed_by_tenant_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_managed_by_tenant"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "managed_by_tenant_id"`);
  }
}
