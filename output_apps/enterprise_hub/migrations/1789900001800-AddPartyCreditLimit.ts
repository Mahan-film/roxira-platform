import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add credit_limit to erp_parties (#584 item 7).
 * Default 0 indicates no custom limit (falls back to tenant policy default).
 */
export class AddPartyCreditLimit1789900001800 implements MigrationInterface {
  name = 'AddPartyCreditLimit1789900001800';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "erp_parties" ADD COLUMN IF NOT EXISTS "credit_limit" bigint NOT NULL DEFAULT 0`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "erp_parties" DROP COLUMN IF EXISTS "credit_limit"`);
  }
}
