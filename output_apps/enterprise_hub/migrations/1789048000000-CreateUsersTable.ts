import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ایجاد جدول users منطبق بر UserEntity
 * (ماژول Auth & Kavenegar OTP - auth).
 *
 * طبق قاعده Contract-First Synchronization (AGENTS.md بخش ۲.۴) اسکیمای
 * پایگاه‌داده صریحاً از طریق Migration ایجاد می‌شود و هرگز به
 * synchronize=true در محیط production تکیه نمی‌گردد.
 */
export class CreateUsersTable1789048000000 implements MigrationInterface {
  name = 'CreateUsersTable1789048000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('USER', 'LAWYER', 'ADMIN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_serviceDomain_enum" AS ENUM('ROXIRA', 'GHAZI')`,
    );

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "phone" character varying(11) NOT NULL,
        "displayName" character varying(120),
        "email" character varying(150),
        "role" "public"."users_role_enum" NOT NULL DEFAULT 'USER',
        "serviceDomain" "public"."users_serviceDomain_enum" NOT NULL DEFAULT 'ROXIRA',
        "isActive" boolean NOT NULL DEFAULT true,
        "lastLoginAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_users_phone" ON "users" ("phone")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_role" ON "users" ("role")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_serviceDomain" ON "users" ("serviceDomain")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_users_serviceDomain"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_users_role"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_users_phone"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_serviceDomain_enum"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
  }
}
