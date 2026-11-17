import { CreateBankStatementImport1789900011500 } from '../../migrations/1789900011500-CreateBankStatementImport';
import { CreateBankStatementMatches1789900011510 } from '../../migrations/1789900011510-CreateBankStatementMatches';

const runner = () => {
  const queries: string[] = [];
  return { queries, q: { query: jest.fn(async (sql: string) => void queries.push(sql)) } };
};

describe('T184 bank statement migrations', () => {
  it('11500: both tables carry tenant_id, the unique bank txn key and FORCE row level security', async () => {
    const { q, queries } = runner();
    await new CreateBankStatementImport1789900011500().up(q as never);
    const sql = queries.join('\n');
    for (const table of ['fin_bank_stmt_imports', 'fin_bank_stmt_lines']) {
      expect(queries.find((x) => x.includes(`CREATE TABLE IF NOT EXISTS "${table}"`))).toContain('"tenant_id" uuid NOT NULL');
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY "${table}_tenant"`);
    }
    expect(sql).toContain('UNIQUE ("tenant_id", "bank_account_id", "bank_txn_id")');
  });

  it('11510: match tables carry tenant_id, one match per line and FORCE row level security', async () => {
    const { q, queries } = runner();
    await new CreateBankStatementMatches1789900011510().up(q as never);
    const sql = queries.join('\n');
    for (const table of ['fin_bank_stmt_matches', 'fin_bank_stmt_match_allocations']) {
      expect(queries.find((x) => x.includes(`CREATE TABLE IF NOT EXISTS "${table}"`))).toContain('"tenant_id" uuid NOT NULL');
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY "${table}_tenant"`);
    }
    expect(sql).toContain('CONSTRAINT "UQ_fin_bank_stmt_matches_line" UNIQUE ("line_id")');
  });

  it('down() removes policies and drops the tables in reverse order', async () => {
    const a = runner();
    await new CreateBankStatementMatches1789900011510().down(a.q as never);
    expect(a.queries.join('\n')).toMatch(/DROP TABLE IF EXISTS "fin_bank_stmt_match_allocations"[\s\S]*DROP TABLE IF EXISTS "fin_bank_stmt_matches"/);
    const b = runner();
    await new CreateBankStatementImport1789900011500().down(b.q as never);
    expect(b.queries.join('\n')).toMatch(/DROP POLICY IF EXISTS "fin_bank_stmt_lines_tenant"[\s\S]*DROP TABLE IF EXISTS "fin_bank_stmt_imports"/);
  });
});
