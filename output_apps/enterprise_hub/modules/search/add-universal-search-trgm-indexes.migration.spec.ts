import { AddUniversalSearchTrgmIndexes1789900010300 } from '../../migrations/1789900010300-AddUniversalSearchTrgmIndexes';

const createRunner = () => {
  const queries: string[] = [];
  return { queries, runner: { query: jest.fn(async (sql: string) => void queries.push(sql)) } };
};

describe('AddUniversalSearchTrgmIndexes migration (1789900010300)', () => {
  it('up() creates pg_trgm extension and GIN trigram indexes across search entities', async () => {
    const { runner, queries } = createRunner();
    await new AddUniversalSearchTrgmIndexes1789900010300().up(runner as never);
    const sql = queries.join('\n');

    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

    // erp_parties
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_erp_parties_name_trgm"');
    expect(sql).toContain('ON "erp_parties" USING gin ("name" gin_trgm_ops)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_erp_parties_code_trgm"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_erp_parties_national_id_trgm"');

    // erp_stock_items
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_erp_stock_items_name_trgm"');
    expect(sql).toContain('ON "erp_stock_items" USING gin ("name" gin_trgm_ops)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_erp_stock_items_sku_trgm"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_erp_stock_items_barcode_trgm"');

    // invoices
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_invoices_tax_number_trgm"');
    expect(sql).toContain('ON "invoices" USING gin ("taxInvoiceNumber" gin_trgm_ops)');

    // fin_cheques
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_fin_cheques_cheque_num_trgm"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_fin_cheques_sayad_trgm"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_fin_cheques_party_trgm"');

    // fin_chart_of_accounts
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_fin_coa_code_trgm"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_fin_coa_name_trgm"');
  });

  it('down() safely drops all created trigram indexes', async () => {
    const { runner, queries } = createRunner();
    await new AddUniversalSearchTrgmIndexes1789900010300().down(runner as never);
    const sql = queries.join('\n');

    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_erp_parties_name_trgm"');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_erp_parties_code_trgm"');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_erp_parties_national_id_trgm"');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_erp_stock_items_name_trgm"');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_erp_stock_items_sku_trgm"');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_erp_stock_items_barcode_trgm"');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_invoices_tax_number_trgm"');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_fin_cheques_cheque_num_trgm"');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_fin_cheques_sayad_trgm"');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_fin_cheques_party_trgm"');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_fin_coa_code_trgm"');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_fin_coa_name_trgm"');
  });
});
