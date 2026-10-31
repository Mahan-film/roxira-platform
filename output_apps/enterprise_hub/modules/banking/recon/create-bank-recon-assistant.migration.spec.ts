import { CreateBankReconAssistant1789372000000 } from '../../../migrations/1789372000000-CreateBankReconAssistant';

describe('CreateBankReconAssistant migration', () => {
  const run = async () => {
    const queries: string[] = [];
    await new CreateBankReconAssistant1789372000000().up({ query: async (sql: string) => void queries.push(sql) } as never);
    return queries;
  };

  it('every table has a tenant column and a tenant-leading index', async () => {
    const queries = await run();
    const tables = queries.filter((q) => q.includes('CREATE TABLE')).map((q) => /"(fin_bank_recon_\w+)"/.exec(q)![1]);
    expect(tables).toHaveLength(9);
    for (const table of tables) {
      const create = queries.find((q) => q.includes(`CREATE TABLE IF NOT EXISTS "${table}"`))!;
      expect(create).toContain('"tenant_id" uuid');
      if (table !== 'fin_bank_recon_settings') {
        expect(queries.join('\n')).toMatch(new RegExp(`ON "${table}" \\("tenant_id"`));
      }
    }
  });

  it('stores money as BIGINT, guards double matching and keeps the audit log append-only', async () => {
    const sql = (await run()).join('\n');
    expect(sql).toContain('"withdrawal" bigint');
    expect(sql).toContain('"amount" bigint NOT NULL');
    expect(sql).toContain('ON "fin_bank_recon_matches" ("tenant_id", "journal_line_id") WHERE "status" = \'confirmed\'');
    expect(sql).toContain('ON "fin_bank_recon_drafts" ("tenant_id", "item_id") WHERE "status" IN');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "fin_bank_recon_audit"');
  });
});
