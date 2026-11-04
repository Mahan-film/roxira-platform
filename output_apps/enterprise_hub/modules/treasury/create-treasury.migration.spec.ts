import { CreateTreasury1789500000000 } from '../../migrations/1789500000000-CreateTreasury';

const runner = () => {
  const queries: string[] = [];
  return { queries, q: { query: jest.fn(async (sql: string) => void queries.push(sql)) } };
};
const TABLES = ['fin_treasury_settings', 'fin_treasury_documents', 'fin_treasury_document_lines', 'fin_treasury_allocations'];

describe('CreateTreasury migration', () => {
  it('creates every table with tenant_id and FORCE row level security', async () => {
    const { q, queries } = runner();
    await new CreateTreasury1789500000000().up(q as never);
    const sql = queries.join('\n');
    for (const table of TABLES) {
      expect(queries.find((x) => x.includes(`CREATE TABLE IF NOT EXISTS "${table}"`))).toContain('"tenant_id" uuid');
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY "${table}_tenant"`);
    }
    expect(sql).toContain('"total" > 0');
    expect(sql).toContain('UNIQUE INDEX IF NOT EXISTS "UQ_fin_treasury_documents_number" ON "fin_treasury_documents" ("tenant_id", "kind", "doc_number")');
  });

  it('down() removes policies and drops children before parents', async () => {
    const { q, queries } = runner();
    await new CreateTreasury1789500000000().down(q as never);
    const drops = queries.filter((x) => x.startsWith('DROP TABLE'));
    expect(drops).toEqual([
      'DROP TABLE IF EXISTS "fin_treasury_allocations"',
      'DROP TABLE IF EXISTS "fin_treasury_document_lines"',
      'DROP TABLE IF EXISTS "fin_treasury_documents"',
      'DROP TABLE IF EXISTS "fin_treasury_settings"',
    ]);
    for (const table of TABLES) expect(queries.join('\n')).toContain(`DROP POLICY IF EXISTS "${table}_tenant"`);
  });
});
