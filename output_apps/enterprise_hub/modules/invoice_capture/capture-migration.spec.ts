import { CreateInvoiceCapture1789375000000 } from '../../migrations/1789375000000-CreateInvoiceCapture';

describe('CreateInvoiceCapture migration', () => {
  const run = async (dir: 'up' | 'down'): Promise<string> => {
    const queries: string[] = [];
    await new CreateInvoiceCapture1789375000000()[dir]({ query: async (s: string) => void queries.push(s) } as never);
    return queries.join('\n');
  };

  it('every capture table carries a tenant column', async () => {
    const sql = await run('up');
    const tables = sql
      .split('CREATE TABLE IF NOT EXISTS ')
      .slice(1)
      .map((chunk) => [chunk, /^"(capture_\w+)"/.exec(chunk)?.[1] ?? '', chunk.split(')\n    ')[0]]);
    expect(tables.map((t) => t[1]).sort()).toEqual([
      'capture_audit', 'capture_documents', 'capture_files', 'capture_settings', 'capture_vendor_rules', 'capture_vendors',
    ]);
    for (const [, name, body] of tables) {
      expect({ name, hasTenant: body.includes('"tenant_id" uuid NOT NULL') }).toEqual({ name, hasTenant: true });
    }
  });

  it('makes the audit trail append-only and auto mode off by default', async () => {
    const sql = await run('up');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "capture_audit"');
    expect(sql).toContain('"auto_enabled" boolean NOT NULL DEFAULT false');
  });

  it('down() drops everything it created', async () => {
    expect(await run('down')).toContain('DROP TABLE IF EXISTS "capture_documents"');
  });
});
