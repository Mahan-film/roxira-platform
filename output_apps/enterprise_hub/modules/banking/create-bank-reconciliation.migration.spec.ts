import { CreateBankReconciliation1789280000000 } from '../../migrations/1789280000000-CreateBankReconciliation';

const createRunner = () => {
  const queries: string[] = [];
  const runner = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return undefined;
    }),
  };
  return { runner, queries };
};

describe('CreateBankReconciliation migration', () => {
  it('uses a timestamp in the reserved range', () => {
    const migration = new CreateBankReconciliation1789280000000();
    expect(migration.name).toBe('CreateBankReconciliation1789280000000');
    const timestamp = Number(migration.name.replace(/\D/g, ''));
    expect(timestamp).toBeGreaterThanOrEqual(1789280000000);
    expect(timestamp).toBeLessThanOrEqual(1789289999999);
  });

  it('creates both tables with a tenant column and tenant-leading indexes', async () => {
    const { runner, queries } = createRunner();
    await new CreateBankReconciliation1789280000000().up(runner as never);
    const sql = queries.join('\n');

    for (const table of ['fin_bank_accounts', 'fin_bank_statement_lines']) {
      const create = queries.find((query) => query.includes(`CREATE TABLE IF NOT EXISTS "${table}"`));
      expect(create).toContain('"tenant_id" uuid NOT NULL');
    }
    expect(sql).toContain('ON "fin_bank_accounts" ("tenant_id", "account_number")');
    expect(sql).toContain('ON "fin_bank_statement_lines" ("tenant_id", "bank_account_id", "txn_date")');
    expect(sql).toContain(
      'ON "fin_bank_statement_lines" ("tenant_id", "matched_journal_line_id") WHERE "matched_journal_line_id" IS NOT NULL',
    );
    expect(sql).toContain('REFERENCES "fin_journal_entry_lines"("id") ON DELETE SET NULL');
  });

  it('does not disable the migration transaction', () => {
    const migration = new CreateBankReconciliation1789280000000() as unknown as { transaction?: boolean };
    expect(migration.transaction).not.toBe(false);
  });

  it('down() drops the lines table before the accounts table', async () => {
    const { runner, queries } = createRunner();
    await new CreateBankReconciliation1789280000000().down(runner as never);
    expect(queries).toEqual([
      'DROP TABLE IF EXISTS "fin_bank_statement_lines"',
      'DROP TABLE IF EXISTS "fin_bank_accounts"',
    ]);
  });
});
