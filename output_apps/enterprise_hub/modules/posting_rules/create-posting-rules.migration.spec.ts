import { CreatePostingRules1789510000000 } from '../../migrations/1789510000000-CreatePostingRules';

const createRunner = () => {
  const queries: string[] = [];
  return { queries, runner: { query: jest.fn(async (sql: string) => void queries.push(sql)) } };
};

describe('CreatePostingRules migration', () => {
  it('creates both tenant tables with unique keys and FORCE RLS', async () => {
    const { runner, queries } = createRunner();
    await new CreatePostingRules1789510000000().up(runner as never);
    const sql = queries.join('\n');
    for (const table of ['fin_posting_role_maps', 'fin_posting_sources']) {
      expect(queries.find((q) => q.includes(`CREATE TABLE IF NOT EXISTS "${table}"`))).toContain('"tenant_id" uuid NOT NULL');
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY "${table}_tenant" ON "${table}"`);
    }
    expect(sql).toContain('ON "fin_posting_role_maps" ("tenant_id", "doc_type", "role")');
    expect(sql).toContain('ON "fin_posting_sources" ("tenant_id", "source_type", "source_id")');
  });

  it('down() removes policies before dropping the tables', async () => {
    const { runner, queries } = createRunner();
    await new CreatePostingRules1789510000000().down(runner as never);
    expect(queries[queries.length - 1]).toBe('DROP TABLE IF EXISTS "fin_posting_role_maps"');
    expect(queries.findIndex((q) => q.includes('DROP POLICY'))).toBeLessThan(queries.findIndex((q) => q.startsWith('DROP TABLE')));
  });
});
