import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Task T147: Universal entity search.
 * Adds pg_trgm extension and GIN trigram indexes across:
 * - erp_parties (name, code, national_id)
 * - erp_stock_items (name, sku, barcode)
 * - invoices (tax_invoice_number)
 * - fin_cheques (cheque_number, sayad_number, party_name)
 * - fin_chart_of_accounts (code, name)
 */
export class AddUniversalSearchTrgmIndexes1789900007000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

    // 1. erp_parties
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_erp_parties_name_trgm"
        ON "erp_parties" USING gin ("name" gin_trgm_ops);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_erp_parties_code_trgm"
        ON "erp_parties" USING gin ("code" gin_trgm_ops);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_erp_parties_national_id_trgm"
        ON "erp_parties" USING gin ("national_id" gin_trgm_ops);
    `);

    // 2. erp_stock_items
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_erp_stock_items_name_trgm"
        ON "erp_stock_items" USING gin ("name" gin_trgm_ops);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_erp_stock_items_sku_trgm"
        ON "erp_stock_items" USING gin ("sku" gin_trgm_ops);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_erp_stock_items_barcode_trgm"
        ON "erp_stock_items" USING gin ("barcode" gin_trgm_ops);
    `);

    // 3. invoices
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_invoices_tax_number_trgm"
        ON "invoices" USING gin ("taxInvoiceNumber" gin_trgm_ops);
    `);

    // 4. fin_cheques
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_cheques_cheque_num_trgm"
        ON "fin_cheques" USING gin ("cheque_number" gin_trgm_ops);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_cheques_sayad_trgm"
        ON "fin_cheques" USING gin ("sayad_number" gin_trgm_ops);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_cheques_party_trgm"
        ON "fin_cheques" USING gin ("party_name" gin_trgm_ops);
    `);

    // 5. fin_chart_of_accounts
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_coa_code_trgm"
        ON "fin_chart_of_accounts" USING gin ("code" gin_trgm_ops);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_coa_name_trgm"
        ON "fin_chart_of_accounts" USING gin ("name" gin_trgm_ops);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fin_coa_name_trgm";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fin_coa_code_trgm";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fin_cheques_party_trgm";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fin_cheques_sayad_trgm";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fin_cheques_cheque_num_trgm";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_invoices_tax_number_trgm";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_erp_stock_items_barcode_trgm";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_erp_stock_items_sku_trgm";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_erp_stock_items_name_trgm";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_erp_parties_national_id_trgm";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_erp_parties_code_trgm";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_erp_parties_name_trgm";`);
  }
}
