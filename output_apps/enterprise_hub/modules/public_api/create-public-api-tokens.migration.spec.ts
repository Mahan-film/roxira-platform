import { CreatePublicApiTokens1789500000000 } from '../../migrations/1789500000000-CreatePublicApiTokens';

describe('CreatePublicApiTokens migration', () => {
  const run = async (dir: 'up' | 'down') => {
    const queries: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => void queries.push(sql)) };
    await new CreatePublicApiTokens1789500000000()[dir](runner as never);
    return queries.join('\n');
  };

  it('up(): tenant_id NOT NULL, hash-only storage, tenant-leading unique index, FORCE RLS', async () => {
    const sql = await run('up');
    expect(sql).toContain('"tenant_id" uuid NOT NULL');
    expect(sql).toContain('"token_hash" character(64) NOT NULL');
    expect(sql).not.toMatch(/"token" /);
    expect(sql).toContain('ON "public_api_tokens" ("tenant_id", "token_hash")');
    expect(sql).toContain('ALTER TABLE "public_api_tokens" FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY "public_api_tokens_tenant"');
  });

  it('down(): removes the policy and the table', async () => {
    const sql = await run('down');
    expect(sql).toContain('DROP POLICY IF EXISTS "public_api_tokens_tenant"');
    expect(sql).toContain('DROP TABLE IF EXISTS "public_api_tokens"');
  });
});
