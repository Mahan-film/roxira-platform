import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ایجاد جدول damage_calculations منطبق بر DamageCalculationEntity
 * (ماژول Damages - enterprise-hub/damages).
 * پیاده‌سازی طبق قاعده Contract-First Synchronization (AGENTS.md بخش ۲.۴):
 * schema پیش از هرگونه تعامل کلاینت با API باید صریحاً از طریق Migration ایجاد شود
 * و هرگز به synchronize=true در محیط production تکیه نمی‌شود.
 */
export class CreateDamageCalculationsTable1789036084586
  implements MigrationInterface
{
  name = 'CreateDamageCalculationsTable1789036084586';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TYPE "public"."damage_calculations_calculationmethod_enum" AS ENUM('CPI_INDEX', 'ANNUAL_RATE')`,
    );

    await queryRunner.query(`
      CREATE TABLE "damage_calculations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "principalAmount" numeric(18,2) NOT NULL,
        "dueDate" date NOT NULL,
        "paymentDate" date NOT NULL,
        "calculationMethod" "public"."damage_calculations_calculationmethod_enum" NOT NULL,
        "delayedDays" integer NOT NULL,
        "damageAmount" numeric(18,2) NOT NULL,
        "totalPayable" numeric(18,2) NOT NULL,
        "legalBasis" character varying(512) NOT NULL,
        "contractReferenceNumber" character varying(64),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_damage_calculations_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_damage_calculations_contractReferenceNumber" ON "damage_calculations" ("contractReferenceNumber")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_damage_calculations_contractReferenceNumber"`,
    );
    await queryRunner.query(`DROP TABLE "damage_calculations"`);
    await queryRunner.query(
      `DROP TYPE "public"."damage_calculations_calculationmethod_enum"`,
    );
  }
}
