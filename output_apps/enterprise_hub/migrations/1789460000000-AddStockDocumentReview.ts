import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Review marker for draft stock documents (the opening-balance flow): who looked at the
 * summary of the lines and when. Editing the lines clears it, so a post always follows a review
 * of exactly the lines being posted. Additive.
 */
export class AddStockDocumentReview1789460000000 implements MigrationInterface {
  name = 'AddStockDocumentReview1789460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "erp_stock_documents"
         ADD COLUMN IF NOT EXISTS "reviewed_by" character varying(64),
         ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "erp_stock_documents"
         DROP COLUMN IF EXISTS "reviewed_at",
         DROP COLUMN IF EXISTS "reviewed_by"`,
    );
  }
}
